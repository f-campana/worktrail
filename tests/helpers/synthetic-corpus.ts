import { createHash } from "node:crypto";

import { WorktrailDatabase } from "../../src/db/database.js";

export type SyntheticThread = {
  externalId: string;
  title: string;
  cwd: string;
  updatedAt: string;
  evidence: string[];
  files: string[];
  archived?: boolean;
};

export function insertSyntheticThread(
  database: WorktrailDatabase,
  thread: SyntheticThread,
): void {
  const source = database.raw
    .prepare(
      `INSERT INTO sources(
         adapter_id, source_uri, external_id, archived, size_bytes,
         modified_at, fingerprint, status, indexed_at
       ) VALUES ('codex-local', ?, ?, ?, 1, ?, ?, 'indexed', ?)
       RETURNING id`,
    )
    .get(
      `synthetic://${thread.externalId}`,
      thread.externalId,
      Number(thread.archived ?? false),
      thread.updatedAt,
      hash(thread.externalId),
      thread.updatedAt,
    ) as { id: number };
  const sourceThread = database.raw
    .prepare(
      `INSERT INTO source_threads(
         source_id, adapter_id, external_id, resume_ref, source_tool, title,
         cwd, started_at, updated_at, archived
       ) VALUES (?, 'codex-local', ?, ?, 'codex-local', ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(
      source.id,
      thread.externalId,
      thread.externalId,
      thread.title,
      thread.cwd,
      thread.updatedAt,
      thread.updatedAt,
      Number(thread.archived ?? false),
    ) as { id: number };

  const evidenceValues = thread.evidence.length > 0 ? thread.evidence : [thread.title];
  let lastEventId: number | undefined;
  for (const [index, excerpt] of evidenceValues.entries()) {
    const event = database.raw
      .prepare(
        `INSERT INTO source_events(
           source_id, thread_id, event_key, kind, occurred_at,
           source_record_type, record_line
         ) VALUES (?, ?, ?, 'message', ?, 'synthetic/message', ?)
         RETURNING id`,
      )
      .get(
        source.id,
        sourceThread.id,
        hash(`${thread.externalId}:${index}`),
        thread.updatedAt,
        index + 1,
      ) as { id: number };
    lastEventId = event.id;
    database.raw
      .prepare(
        `INSERT INTO messages(
           event_id, thread_id, role, searchable_text, truncated
         ) VALUES (?, ?, 'assistant', ?, 0)`,
      )
      .run(event.id, sourceThread.id, excerpt);
    database.raw
      .prepare(
        `INSERT INTO evidence(
           event_id, thread_id, kind, searchable_text, excerpt, truncated, content_hash
         ) VALUES (?, ?, 'message', ?, ?, 0, ?)`,
      )
      .run(event.id, sourceThread.id, excerpt, excerpt, hash(excerpt));
  }

  for (const path of thread.files) {
    database.raw
      .prepare(
        `INSERT INTO file_references(thread_id, event_id, path, confidence)
         VALUES (?, ?, ?, 'structured')`,
      )
      .run(sourceThread.id, lastEventId ?? null, path);
  }
  database.rebuildSearchDocument(sourceThread.id);
}

export function syntheticId(number: number): string {
  return `10000000-0000-4000-8000-${number.toString().padStart(12, "0")}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
