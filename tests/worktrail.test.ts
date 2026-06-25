import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { CodexLocalAdapter } from "../src/adapters/codex-local.js";
import { WorktrailDatabase } from "../src/db/database.js";
import { importSources } from "../src/importer.js";
import { TEXT_LIMITS } from "../src/limits.js";
import { redactAndBound } from "../src/redaction.js";
import { searchThreads } from "../src/search.js";
import type { DiscoveredSource, NormalizedSourceEvent } from "../src/types.js";

const fixtureDir = new URL("../fixtures/codex", import.meta.url).pathname;

test("parser handles legacy function_call and string output", async () => {
  const adapter = new CodexLocalAdapter({ fixtureDir });
  const source = await sourceNamed(adapter, "rollout-legacy-sanitized.jsonl");
  const events = await readAll(adapter, source);

  const call = events.find((event) => event.kind === "tool-call");
  const result = events.find((event) => event.kind === "tool-result");
  assert.ok(call && call.kind === "tool-call");
  assert.equal(call.tool, "exec_command");
  assert.match(call.inputText ?? "", /src\/widget\.ts/);
  assert.ok(result && result.kind === "tool-result");
  assert.match(result.outputText ?? "", /fixture-ok/);
});

test("parser handles current content-block output and structured patch changes", async () => {
  const adapter = new CodexLocalAdapter({ fixtureDir });
  const source = await sourceNamed(adapter, "rollout-current-sanitized.jsonl");
  const events = await readAll(adapter, source);

  const result = events.find((event) => event.kind === "tool-result");
  const fileChange = events.find((event) => event.kind === "file-change");
  assert.ok(result && result.kind === "tool-result");
  assert.match(result.outputText ?? "", /Patch applied/);
  assert.ok(fileChange && fileChange.kind === "file-change");
  assert.equal(
    fileChange.path,
    "/Users/example/work/sample-repo/src/widget.ts",
  );
  assert.equal(fileChange.changeType, "update");
  assert.match(fileChange.text ?? "", /valid = true/);

  const userMessages = events.filter(
    (event) => event.kind === "message" && event.role === "user",
  );
  assert.equal(
    userMessages.length,
    1,
    "response/event message mirror is deduplicated",
  );
});

test("title enrichment uses the newest session-index row", async () => {
  const adapter = new CodexLocalAdapter({ fixtureDir });
  const enrichments = await adapter.enrich([
    "00000000-0000-4000-8000-000000000002",
  ]);
  assert.equal(enrichments.length, 1);
  assert.equal(enrichments[0]?.title, "Fix widget validation and tests");
  assert.equal(enrichments[0]?.updatedAt, "2026-02-03T11:00:09.000Z");
});

test("Codex-local source state checker classifies active archived missing and unknown", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "worktrail-source-state-"));
  const codexHome = join(temporary, "codex");
  const activeId = "10000000-0000-4000-8000-000000000601";
  const archivedId = "10000000-0000-4000-8000-000000000602";
  const missingId = "10000000-0000-4000-8000-000000000603";
  const activePath = join(
    codexHome,
    "sessions",
    "2026",
    "06",
    "20",
    `rollout-2026-06-20T12-00-00-${activeId}.jsonl`,
  );
  const archivedPath = join(
    codexHome,
    "archived_sessions",
    `rollout-2026-06-20T12-00-00-${archivedId}.jsonl`,
  );
  const missingPath = join(
    codexHome,
    "sessions",
    "2026",
    "06",
    "20",
    `rollout-2026-06-20T12-00-00-${missingId}.jsonl`,
  );
  try {
    await writeStateRollout(activePath);
    await writeStateRollout(archivedPath);
    const adapter = new CodexLocalAdapter({ codexHome });
    const states = adapter.checkThreadStates(
      [
        { sourceId: activeId, resumeRef: activeId, sourceUri: activePath },
        {
          sourceId: archivedId,
          resumeRef: archivedId,
          sourceUri: archivedPath,
        },
        { sourceId: missingId, resumeRef: missingId, sourceUri: missingPath },
        {
          sourceId: "outside",
          resumeRef: "10000000-0000-4000-8000-000000000604",
          sourceUri: join(temporary, "outside.jsonl"),
        },
      ],
      { clock: () => new Date("2026-06-20T12:00:00.000Z") },
    );

    assert.deepEqual(
      states.map((state) => state.state),
      ["active", "archived", "missing", "unknown"],
    );
    assert.equal(states[0]?.observedAt, "2026-06-20T12:00:00.000Z");
    assert.deepEqual(
      adapter
        .checkThreadStates([{ sourceId: activeId, resumeRef: activeId }])
        .map((state) => state.state),
      ["active"],
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("parser diagnoses malformed, unknown, and partial trailing records without stopping", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "worktrail-parser-errors-"));
  try {
    const path = join(temporary, "rollout-errors.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify({
          timestamp: "2026-03-01T00:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "00000000-0000-4000-8000-000000000003",
            timestamp: "2026-03-01T00:00:00.000Z",
            cwd: "/Users/example/work/errors",
          },
        }),
        "{malformed complete line}",
        JSON.stringify({
          timestamp: "2026-03-01T00:00:01.000Z",
          type: "future_record_type",
          payload: {},
        }),
        '{"timestamp":"2026-03-01T00:00:02.000Z","type":"response_item"',
      ].join("\n"),
      "utf8",
    );

    const adapter = new CodexLocalAdapter({ fixtureDir: temporary });
    const source = await sourceNamed(adapter, "rollout-errors.jsonl");
    const events = await readAll(adapter, source);
    const codes = events
      .filter((event) => event.kind === "diagnostic")
      .map((event) => (event.kind === "diagnostic" ? event.code : ""));

    assert.ok(events.some((event) => event.kind === "thread"));
    assert.deepEqual(codes, [
      "malformed_json",
      "unknown_record",
      "partial_trailing_line",
    ]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("redaction masks secrets, normalizes home paths, and marks truncation", () => {
  const input = [
    "Authorization: Bearer fixture-bearer-token-123456",
    "OPENAI_API_KEY=sk-proj-fixtureabcdefghijklmnop",
    "CUSTOM_SERVICE_TOKEN=fixture-custom-token",
    "password=hunter2",
    "postgresql://fixture:secret@db.example.invalid/work",
    "https://fixture:secret@example.invalid/private",
    "Cookie: session=fixture-cookie",
    "-----BEGIN PRIVATE KEY-----\nfixture-private-material\n-----END PRIVATE KEY-----",
    "/Users/alice/work/sample-repo/src/widget.ts",
  ].join("\n");
  const result = redactAndBound(input, 4096);
  const truncated = redactAndBound("x".repeat(256), 64);

  assert.equal(result.truncated, false);
  assert.match(result.text, /\[REDACTED/);
  assert.match(result.text, /~\/work\/sample-repo/);
  assert.doesNotMatch(
    result.text,
    /hunter2|fixture-private-material|fixture-cookie|fixture-custom-token/,
  );
  assert.equal(truncated.truncated, true);
  assert.match(truncated.text, /\[truncated\]$/);
  assert.ok(Buffer.byteLength(truncated.text, "utf8") <= 64);
});

test("importer persists bounded normalized data and deduplicates re-imports", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "worktrail-import-"));
  const database = new WorktrailDatabase(join(temporary, "worktrail.db"));
  try {
    const adapter = new CodexLocalAdapter({ fixtureDir });
    await importSources(database, adapter, { scope: "fixtures" });
    const countsAfterFirst = databaseCounts(database);
    const second = await importSources(database, adapter, {
      scope: "fixtures",
      force: true,
    });
    const countsAfterSecond = databaseCounts(database);

    assert.deepEqual(countsAfterSecond, countsAfterFirst);
    assert.equal(countsAfterFirst.threads, 2);
    assert.equal(countsAfterFirst.messages, 5);
    assert.equal(countsAfterFirst.fileReferences > 0, true);
    assert.equal(second.events, 0);

    const rawFixturePathCount = database.scalar(
      "SELECT count(*) FROM messages WHERE searchable_text LIKE '%/Users/example/%'",
    );
    assert.equal(
      rawFixturePathCount,
      0,
      "persisted message paths are normalized",
    );
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("importer enforces message, tool, and file-change byte limits", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "worktrail-limits-"));
  const fixtures = join(temporary, "fixtures");
  const database = new WorktrailDatabase(join(temporary, "worktrail.db"));
  try {
    await mkdir(fixtures);
    const sessionId = "00000000-0000-4000-8000-000000000004";
    const lines = [
      {
        timestamp: "2026-04-01T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: sessionId,
          timestamp: "2026-04-01T00:00:00.000Z",
          cwd: "/Users/example/work/limits",
        },
      },
      {
        timestamp: "2026-04-01T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "m".repeat(10_000) }],
        },
      },
      {
        timestamp: "2026-04-01T00:00:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "fixture_tool",
          call_id: "limit-call",
          arguments: "i".repeat(6_000),
        },
      },
      {
        timestamp: "2026-04-01T00:00:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "limit-call",
          output: "o".repeat(6_000),
        },
      },
      {
        timestamp: "2026-04-01T00:00:04.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "limit-call",
          changes: {
            "/Users/example/work/limits/src/large.ts": {
              type: "update",
              unified_diff: "d".repeat(6_000),
            },
          },
        },
      },
    ];
    await writeFile(
      join(fixtures, "rollout-limits.jsonl"),
      `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
      "utf8",
    );

    const adapter = new CodexLocalAdapter({ fixtureDir: fixtures });
    await importSources(database, adapter, { scope: "fixtures" });

    assertPersistedLimit(database, "messages", undefined, TEXT_LIMITS.message);
    assertPersistedLimit(
      database,
      "evidence",
      "tool-input",
      TEXT_LIMITS.toolInput,
    );
    assertPersistedLimit(
      database,
      "evidence",
      "tool-output",
      TEXT_LIMITS.toolOutput,
    );
    assertPersistedLimit(
      database,
      "evidence",
      "file-change",
      TEXT_LIMITS.fileChange,
    );
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("search returns the expected evidence-backed fixture thread", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "worktrail-search-"));
  const database = new WorktrailDatabase(join(temporary, "worktrail.db"));
  try {
    const adapter = new CodexLocalAdapter({ fixtureDir });
    await importSources(database, adapter, { scope: "fixtures" });
    const results = searchThreads(database, "widget validation", 5);

    assert.ok(results.length >= 1);
    assert.equal(
      results[0]?.externalId,
      "00000000-0000-4000-8000-000000000002",
    );
    assert.equal(results[0]?.title, "Fix widget validation and tests");
    assert.equal(results[0]?.confidence, "high");
    assert.ok(
      results[0]?.evidence.some((item) => /validation/.test(item.excerpt)),
    );
    assert.ok(results[0]?.fileReferences.includes("src/widget.ts"));
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

async function sourceNamed(
  adapter: CodexLocalAdapter,
  filename: string,
): Promise<DiscoveredSource> {
  for await (const source of adapter.discover()) {
    if (source.sourceUri.endsWith(filename)) return source;
  }
  throw new Error(`Missing synthetic source: ${filename}`);
}

async function readAll(
  adapter: CodexLocalAdapter,
  source: DiscoveredSource,
): Promise<NormalizedSourceEvent[]> {
  const events: NormalizedSourceEvent[] = [];
  for await (const event of adapter.read(source)) events.push(event);
  return events;
}

function databaseCounts(database: WorktrailDatabase): {
  threads: number;
  events: number;
  messages: number;
  evidence: number;
  fileReferences: number;
} {
  return {
    threads: database.scalar("SELECT count(*) FROM source_threads"),
    events: database.scalar("SELECT count(*) FROM source_events"),
    messages: database.scalar("SELECT count(*) FROM messages"),
    evidence: database.scalar("SELECT count(*) FROM evidence"),
    fileReferences: database.scalar("SELECT count(*) FROM file_references"),
  };
}

function assertPersistedLimit(
  database: WorktrailDatabase,
  table: "messages" | "evidence",
  kind: string | undefined,
  maximumBytes: number,
): void {
  const where = kind ? "WHERE kind = ?" : "";
  const values = kind ? [kind] : [];
  const row = database.raw
    .prepare(
      `SELECT length(CAST(searchable_text AS BLOB)) AS bytes, truncated
       FROM ${table} ${where} LIMIT 1`,
    )
    .get(...values) as { bytes: number; truncated: number } | undefined;
  assert.ok(row);
  assert.ok(row.bytes <= maximumBytes);
  assert.equal(row.truncated, 1);
}

async function writeStateRollout(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{}\n", "utf8");
}
