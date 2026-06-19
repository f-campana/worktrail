import { createHash } from "node:crypto";

import { WorktrailDatabase } from "./db/database.js";
import { TEXT_LIMITS } from "./limits.js";
import { redactAndBound } from "./redaction.js";
import { boundUtf8, contentHash } from "./text.js";
import type {
  DiscoveredSource,
  IndexStats,
  NormalizedSourceEvent,
  SourceAdapter,
} from "./types.js";

export type ImportOptions = {
  scope: "fixtures" | "local";
  force?: boolean;
  since?: string;
  maxSources?: number;
};

type ImportState = {
  sourceId: number;
  threadId?: number;
  externalId?: string;
};

export async function importSources(
  database: WorktrailDatabase,
  adapter: SourceAdapter,
  options: ImportOptions,
): Promise<IndexStats> {
  const startedAt = new Date().toISOString();
  const runResult = database.raw
    .prepare(
      `INSERT INTO indexing_runs(adapter_id, scope, started_at, status)
       VALUES (?, ?, ?, 'running')`,
    )
    .run(adapter.id, options.scope, startedAt);
  const runId = Number(runResult.lastInsertRowid);
  const stats: IndexStats = {
    runId,
    discoveredSources: 0,
    indexedSources: 0,
    skippedSources: 0,
    threads: 0,
    events: 0,
    messages: 0,
    toolCalls: 0,
    toolResults: 0,
    fileChanges: 0,
    titleEnrichments: 0,
    malformedLines: 0,
    partialLines: 0,
    unknownRecords: 0,
    diagnostics: 0,
  };
  const affectedThreadIds = new Set<number>();
  const externalIds = new Set<string>();

  try {
    for await (const source of adapter.discover({
      ...(options.since ? { since: options.since } : {}),
      ...(options.maxSources !== undefined
        ? { maxSources: options.maxSources }
        : {}),
    })) {
      stats.discoveredSources += 1;
      const previous = database.getSource(adapter.id, source.sourceUri);
      if (
        !options.force &&
        previous?.status === "indexed" &&
        previous.fingerprint === source.fingerprint
      ) {
        stats.skippedSources += 1;
        continue;
      }

      const sourceId = upsertSource(database, source);
      const state: ImportState = {
        sourceId,
        ...(source.externalId ? { externalId: source.externalId } : {}),
      };

      database.raw.exec("BEGIN IMMEDIATE");
      try {
        for await (const event of adapter.read(source)) {
          persistEvent(
            database,
            event,
            source,
            state,
            runId,
            stats,
            affectedThreadIds,
            externalIds,
          );
        }
        database.raw
          .prepare(
            `UPDATE sources
             SET status = 'indexed', indexed_at = ?, external_id = COALESCE(?, external_id)
             WHERE id = ?`,
          )
          .run(new Date().toISOString(), state.externalId ?? null, sourceId);
        database.raw.exec("COMMIT");
        stats.indexedSources += 1;
      } catch (error) {
        database.raw.exec("ROLLBACK");
        database.raw
          .prepare("UPDATE sources SET status = 'failed' WHERE id = ?")
          .run(sourceId);
        insertDiagnostic(
          database,
          runId,
          sourceId,
          state.threadId,
          "source_failed",
          error instanceof Error ? error.name : "UnknownError",
          null,
        );
        stats.diagnostics += 1;
      }
    }

    if (adapter.enrich && externalIds.size > 0) {
      const enrichments = await adapter.enrich([...externalIds]);
      for (const enrichment of enrichments) {
        const thread = database.raw
          .prepare(
            "SELECT id FROM source_threads WHERE adapter_id = ? AND external_id = ?",
          )
          .get(adapter.id, enrichment.externalId) as { id: number } | undefined;
        if (!thread) continue;

        const redactedTitle = enrichment.title
          ? redactAndBound(enrichment.title, TEXT_LIMITS.title).text
          : null;
        database.raw
          .prepare(
            `INSERT INTO thread_enrichments(thread_id, provider, title, updated_at, archived)
             VALUES (?, 'session-index', ?, ?, ?)
             ON CONFLICT(thread_id, provider) DO UPDATE SET
               title = excluded.title,
               updated_at = excluded.updated_at,
               archived = excluded.archived`,
          )
          .run(
            thread.id,
            redactedTitle,
            enrichment.updatedAt ?? null,
            enrichment.archived === undefined
              ? null
              : Number(enrichment.archived),
          );
        if (redactedTitle) {
          database.raw
            .prepare("UPDATE source_threads SET title = ? WHERE id = ?")
            .run(redactedTitle, thread.id);
        }
        affectedThreadIds.add(thread.id);
        stats.titleEnrichments += 1;
      }
    }

    for (const threadId of affectedThreadIds) {
      database.rebuildSearchDocument(threadId);
    }

    finishRun(database, stats, "completed");
    return stats;
  } catch (error) {
    finishRun(database, stats, "failed", "Indexing failed before completion.");
    throw error;
  }
}

function persistEvent(
  database: WorktrailDatabase,
  event: NormalizedSourceEvent,
  source: DiscoveredSource,
  state: ImportState,
  runId: number,
  stats: IndexStats,
  affectedThreadIds: Set<number>,
  externalIds: Set<string>,
): void {
  if (event.kind === "diagnostic") {
    insertDiagnostic(
      database,
      runId,
      state.sourceId,
      state.threadId,
      event.code,
      event.detail,
      event.evidence.recordLine,
    );
    stats.diagnostics += 1;
    if (event.code === "malformed_json") stats.malformedLines += 1;
    if (event.code === "partial_trailing_line") stats.partialLines += 1;
    if (event.code === "unknown_record") stats.unknownRecords += 1;
    return;
  }

  if (event.kind === "thread") {
    const cwd = event.cwd
      ? redactAndBound(event.cwd, TEXT_LIMITS.path).text
      : null;
    const result = database.raw
      .prepare(
        `INSERT INTO source_threads(
           source_id, adapter_id, external_id, resume_ref, source_tool,
           source_surface, cli_version, cwd, started_at, updated_at, archived
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(adapter_id, external_id) DO UPDATE SET
           source_id = excluded.source_id,
           resume_ref = excluded.resume_ref,
           source_surface = COALESCE(excluded.source_surface, source_threads.source_surface),
           cli_version = COALESCE(excluded.cli_version, source_threads.cli_version),
           cwd = COALESCE(excluded.cwd, source_threads.cwd),
           started_at = MIN(source_threads.started_at, excluded.started_at),
           updated_at = MAX(source_threads.updated_at, excluded.updated_at),
           archived = excluded.archived
         RETURNING id`,
      )
      .get(
        state.sourceId,
        source.adapterId,
        event.externalId,
        event.resumeRef,
        source.adapterId,
        event.sourceSurface ?? null,
        event.cliVersion ?? null,
        cwd,
        event.startedAt,
        event.occurredAt,
        Number(event.archived),
      ) as { id: number };

    state.threadId = result.id;
    state.externalId = event.externalId;
    externalIds.add(event.externalId);
    affectedThreadIds.add(result.id);
    stats.threads += 1;
    database.raw
      .prepare("UPDATE sources SET external_id = ?, archived = ? WHERE id = ?")
      .run(event.externalId, Number(event.archived), state.sourceId);
    return;
  }

  const externalId = event.externalId ?? state.externalId;
  if (!state.threadId && externalId) {
    const existing = database.raw
      .prepare(
        "SELECT id FROM source_threads WHERE adapter_id = ? AND external_id = ?",
      )
      .get(source.adapterId, externalId) as { id: number } | undefined;
    if (existing) state.threadId = existing.id;
  }
  if (!state.threadId || !externalId) {
    insertDiagnostic(
      database,
      runId,
      state.sourceId,
      undefined,
      "event_without_thread",
      `Ignored ${event.kind} before valid session metadata.`,
      event.evidence.recordLine,
    );
    stats.diagnostics += 1;
    return;
  }

  const turnId = event.turnId
    ? upsertTurn(database, state.threadId, event.turnId, event)
    : undefined;
  const eventKey = createEventKey(externalId, event);
  const inserted = database.raw
    .prepare(
      `INSERT OR IGNORE INTO source_events(
         source_id, thread_id, turn_id, event_key, kind, role, tool_name,
         call_id, occurred_at, source_record_type, record_line
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      state.sourceId,
      state.threadId,
      turnId ?? null,
      eventKey,
      event.kind,
      event.kind === "message" ? event.role : null,
      event.kind === "tool-call" ? event.tool : null,
      "callId" in event ? (event.callId ?? null) : null,
      event.occurredAt,
      event.evidence.sourceRecordType,
      event.evidence.recordLine,
    );

  if (Number(inserted.changes) === 0) return;
  const eventId = Number(inserted.lastInsertRowid);
  stats.events += 1;
  affectedThreadIds.add(state.threadId);

  database.raw
    .prepare(
      "UPDATE source_threads SET updated_at = MAX(updated_at, ?) WHERE id = ?",
    )
    .run(event.occurredAt, state.threadId);

  if (event.kind === "message") {
    const persisted = redactAndBound(event.text, TEXT_LIMITS.message);
    database.raw
      .prepare(
        `INSERT INTO messages(event_id, thread_id, role, phase, searchable_text, truncated)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        state.threadId,
        event.role,
        event.phase ?? null,
        persisted.text,
        Number(persisted.truncated),
      );
    insertEvidence(
      database,
      eventId,
      state.threadId,
      "message",
      persisted.text,
      persisted.truncated,
    );
    insertDetectedFiles(database, state.threadId, eventId, persisted.text);
    stats.messages += 1;
    return;
  }

  if (event.kind === "tool-call") {
    const persisted = redactAndBound(
      event.inputText ?? "",
      TEXT_LIMITS.toolInput,
    );
    if (persisted.text) {
      insertEvidence(
        database,
        eventId,
        state.threadId,
        "tool-input",
        persisted.text,
        persisted.truncated,
      );
      insertDetectedFiles(database, state.threadId, eventId, persisted.text);
    }
    stats.toolCalls += 1;
    return;
  }

  if (event.kind === "tool-result") {
    const persisted = redactAndBound(
      event.outputText ?? "",
      TEXT_LIMITS.toolOutput,
    );
    if (persisted.text) {
      insertEvidence(
        database,
        eventId,
        state.threadId,
        "tool-output",
        persisted.text,
        persisted.truncated,
      );
      insertDetectedFiles(database, state.threadId, eventId, persisted.text);
    }
    stats.toolResults += 1;
    return;
  }

  if (event.kind === "file-change") {
    const path = redactAndBound(event.path, TEXT_LIMITS.path).text;
    const persisted = redactAndBound(
      event.text ?? path,
      TEXT_LIMITS.fileChange,
    );
    insertEvidence(
      database,
      eventId,
      state.threadId,
      "file-change",
      persisted.text,
      persisted.truncated,
    );
    database.raw
      .prepare(
        `INSERT OR IGNORE INTO file_references(thread_id, event_id, path, confidence)
         VALUES (?, ?, ?, 'structured')`,
      )
      .run(state.threadId, eventId, path);
    stats.fileChanges += 1;
  }
}

function upsertSource(
  database: WorktrailDatabase,
  source: DiscoveredSource,
): number {
  const row = database.raw
    .prepare(
      `INSERT INTO sources(
         adapter_id, source_uri, external_id, archived, size_bytes,
         modified_at, fingerprint, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'discovered')
       ON CONFLICT(adapter_id, source_uri) DO UPDATE SET
         external_id = COALESCE(excluded.external_id, sources.external_id),
         archived = excluded.archived,
         size_bytes = excluded.size_bytes,
         modified_at = excluded.modified_at,
         fingerprint = excluded.fingerprint,
         status = 'discovered'
       RETURNING id`,
    )
    .get(
      source.adapterId,
      source.sourceUri,
      source.externalId ?? null,
      Number(source.archived),
      source.sizeBytes,
      source.modifiedAt,
      source.fingerprint,
    ) as { id: number };
  return row.id;
}

function upsertTurn(
  database: WorktrailDatabase,
  threadId: number,
  externalTurnId: string,
  event: NormalizedSourceEvent,
): number {
  const startedAt = event.kind === "turn-start" ? event.occurredAt : null;
  const endedAt = event.kind === "turn-end" ? event.occurredAt : null;
  const row = database.raw
    .prepare(
      `INSERT INTO source_turns(thread_id, turn_external_id, started_at, ended_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_id, turn_external_id) DO UPDATE SET
         started_at = COALESCE(source_turns.started_at, excluded.started_at),
         ended_at = COALESCE(excluded.ended_at, source_turns.ended_at)
       RETURNING id`,
    )
    .get(threadId, externalTurnId, startedAt, endedAt) as { id: number };
  return row.id;
}

function insertEvidence(
  database: WorktrailDatabase,
  eventId: number,
  threadId: number,
  kind: string,
  searchableText: string,
  truncated: boolean,
): void {
  const excerpt = boundUtf8(searchableText, TEXT_LIMITS.evidenceExcerpt);
  database.raw
    .prepare(
      `INSERT INTO evidence(
         event_id, thread_id, kind, searchable_text, excerpt, truncated, content_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      eventId,
      threadId,
      kind,
      searchableText,
      excerpt.text,
      Number(truncated || excerpt.truncated),
      contentHash(searchableText),
    );
}

function insertDetectedFiles(
  database: WorktrailDatabase,
  threadId: number,
  eventId: number,
  text: string,
): void {
  for (const path of extractFileReferences(text)) {
    database.raw
      .prepare(
        `INSERT OR IGNORE INTO file_references(thread_id, event_id, path, confidence)
         VALUES (?, ?, ?, 'detected')`,
      )
      .run(threadId, eventId, path);
  }
}

export function extractFileReferences(text: string): string[] {
  const extensions =
    "ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|mdx|py|rb|rs|go|java|kt|kts|swift|c|h|cpp|hpp|cs|php|vue|svelte|css|scss|html|sql|toml|yaml|yml|xml|sh";
  const pattern = new RegExp(
    `(?:~\\/|\\.\\.?\\/)?(?:[A-Za-z0-9_.@+-]+\\/)*[A-Za-z0-9_.@+-]+\\.(?:${extensions})\\b`,
    "gi",
  );
  const output = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const path = match[0];
    if (path && path.length <= TEXT_LIMITS.path) output.add(path);
  }
  return [...output];
}

function createEventKey(
  externalId: string,
  event: Exclude<NormalizedSourceEvent, { kind: "thread" | "diagnostic" }>,
): string {
  const discriminator =
    event.kind === "message"
      ? event.role
      : event.kind === "tool-call" || event.kind === "tool-result"
        ? event.callId
        : event.kind === "file-change"
          ? event.path
          : (event.turnId ?? "");
  return createHash("sha256")
    .update(
      `${externalId}\0${event.evidence.recordLine}\0${event.kind}\0${discriminator}`,
    )
    .digest("hex");
}

function insertDiagnostic(
  database: WorktrailDatabase,
  runId: number,
  sourceId: number,
  threadId: number | undefined,
  code: string,
  detail: string,
  recordLine: number | null,
): void {
  const boundedDetail = redactAndBound(
    detail,
    TEXT_LIMITS.evidenceExcerpt,
  ).text;
  database.raw
    .prepare(
      `INSERT INTO diagnostics(
         run_id, source_id, thread_id, code, detail, record_line, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      sourceId,
      threadId ?? null,
      code,
      boundedDetail,
      recordLine,
      new Date().toISOString(),
    );
}

function finishRun(
  database: WorktrailDatabase,
  stats: IndexStats,
  status: "completed" | "failed",
  error?: string,
): void {
  database.raw
    .prepare(
      `UPDATE indexing_runs SET
         completed_at = ?, status = ?, discovered_sources = ?, indexed_sources = ?,
         skipped_sources = ?, threads = ?, events = ?, messages = ?, tool_calls = ?,
         tool_results = ?, file_changes = ?, title_enrichments = ?, malformed_lines = ?,
         partial_lines = ?, unknown_records = ?, error = ?
       WHERE id = ?`,
    )
    .run(
      new Date().toISOString(),
      status,
      stats.discoveredSources,
      stats.indexedSources,
      stats.skippedSources,
      stats.threads,
      stats.events,
      stats.messages,
      stats.toolCalls,
      stats.toolResults,
      stats.fileChanges,
      stats.titleEnrichments,
      stats.malformedLines,
      stats.partialLines,
      stats.unknownRecords,
      error ?? null,
      stats.runId,
    );
}
