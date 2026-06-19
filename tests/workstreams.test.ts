import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { CodexLocalAdapter } from "../src/adapters/codex-local.js";
import { WorktrailDatabase } from "../src/db/database.js";
import { importSources } from "../src/importer.js";
import { searchThreads } from "../src/search.js";
import { buildStateResponse } from "../src/state.js";
import {
  assignThread,
  addWorkstreamAlias,
  createWorkstream,
  ignoreThread,
  isThreadIgnored,
  listWorkstreamAliases,
  listWorkstreams,
  removeWorkstreamAlias,
  renameWorkstream,
  unassignThread,
  unignoreThread,
} from "../src/workstreams.js";

const fixtureDir = new URL("../fixtures/codex", import.meta.url).pathname;
const currentThread = "00000000-0000-4000-8000-000000000002";
const legacyThread = "00000000-0000-4000-8000-000000000001";

test("existing version-one database migrates to workstream schema", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "worktrail-migration-"));
  const path = join(temporary, "worktrail.db");
  try {
    const initialSql = await readFile(
      new URL("../src/db/migrations/001_initial.sql", import.meta.url),
      "utf8",
    );
    const previous = new DatabaseSync(path);
    previous.exec(initialSql);
    previous.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations(version, name, applied_at)
      VALUES (1, 'initial', '2026-01-01T00:00:00.000Z');
    `);
    previous.close();

    const migrated = new WorktrailDatabase(path);
    try {
      assert.equal(
        migrated.scalar(
          "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'workstreams'",
        ),
        1,
      );
      assert.equal(
        migrated.scalar(
          "SELECT count(*) FROM schema_migrations WHERE version = 3",
        ),
        1,
      );
    } finally {
      migrated.close();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("add, list, and remove workstream aliases", async () => {
  await withEmptyDatabase((database) => {
    const workstream = createWorkstream(database, "Fixture widget work");
    const added = addWorkstreamAlias(database, workstream.id, "widget repair");
    assert.equal(added.alias, "widget repair");
    assert.deepEqual(listWorkstreamAliases(database, workstream.id), [added]);
    assert.equal(
      removeWorkstreamAlias(database, workstream.id, "widget repair"),
      true,
    );
    assert.equal(
      removeWorkstreamAlias(database, workstream.id, "widget repair"),
      false,
    );
    assert.deepEqual(listWorkstreamAliases(database, workstream.id), []);
  });
});

test("create, rename, and list workstreams", async () => {
  await withEmptyDatabase((database) => {
    const created = createWorkstream(database, "Fixture widget work");
    assert.match(created.id, /^ws_[0-9a-f-]+$/);
    assert.equal(created.name, "Fixture widget work");

    const renamed = renameWorkstream(
      database,
      created.id,
      "Renamed fixture work",
    );
    assert.equal(renamed.name, "Renamed fixture work");
    assert.deepEqual(listWorkstreams(database), [renamed]);
    assert.equal(database.scalar("SELECT count(*) FROM manual_corrections"), 2);
  });
});

test("assign and unassign a source thread", async () => {
  await withFixtureDatabase((database) => {
    const workstream = createWorkstream(database, "Fixture widget work");
    const assignment = assignThread(database, currentThread, workstream.id);
    assert.equal(assignment.threadId, currentThread);
    assert.equal(assignment.workstreamId, workstream.id);
    assert.equal(listWorkstreams(database)[0]?.threadCount, 1);

    assert.equal(unassignThread(database, currentThread), true);
    assert.equal(unassignThread(database, currentThread), false);
    assert.equal(listWorkstreams(database)[0]?.threadCount, 0);
  });
});

test("manual assignment wins over deterministic candidate grouping", async () => {
  await withFixtureDatabase((database) => {
    const before = buildStateResponse(database, "widget validation");
    assert.equal(before.best?.workstream.origin, "candidate");

    const workstream = createWorkstream(database, "Canonical widget work");
    assignThread(database, currentThread, workstream.id);
    const after = buildStateResponse(database, "widget validation");

    assert.equal(after.best?.workstream.origin, "manual");
    assert.equal(after.best?.workstream.id, workstream.id);
    assert.equal(after.best?.workstream.name, "Canonical widget work");
    assert.equal(after.best?.bestThread.externalId, currentThread);
  });
});

test("ignore removes a thread from search and state; unignore restores it", async () => {
  await withFixtureDatabase((database) => {
    assert.equal(
      searchThreads(database, "widget validation")[0]?.externalId,
      currentThread,
    );

    ignoreThread(database, currentThread, "Synthetic irrelevant result");
    assert.equal(isThreadIgnored(database, currentThread), true);
    assert.equal(
      searchThreads(database, "widget validation").some(
        (result) => result.externalId === currentThread,
      ),
      false,
    );
    assert.equal(
      buildStateResponse(
        database,
        "widget validation",
      ).best?.relatedThreads.some(
        (thread) => thread.externalId === currentThread,
      ),
      false,
    );

    assert.equal(unignoreThread(database, currentThread), true);
    assert.equal(isThreadIgnored(database, currentThread), false);
    assert.equal(
      searchThreads(database, "widget validation")[0]?.externalId,
      currentThread,
    );
  });
});

test("state card returns latest evidence and related files", async () => {
  await withFixtureDatabase((database) => {
    const state = buildStateResponse(database, "widget validation");
    assert.ok(state.best);
    assert.equal(state.best.bestThread.externalId, currentThread);
    assert.ok(state.best.latestEvidence.length > 0);
    assert.ok(
      state.best.latestEvidence.some((item) => /validation/.test(item.excerpt)),
    );
    assert.ok(state.best.relatedFiles.includes("src/widget.ts"));

    for (let index = 1; index < state.best.latestEvidence.length; index += 1) {
      const previous = state.best.latestEvidence[index - 1];
      const current = state.best.latestEvidence[index];
      assert.ok(previous && current);
      assert.ok(
        previous.relevance > current.relevance ||
          (previous.relevance === current.relevance &&
            previous.occurredAt >= current.occurredAt),
      );
    }
  });
});

test("state card returns all active manually assigned threads", async () => {
  await withFixtureDatabase((database) => {
    const workstream = createWorkstream(database, "Fixture widget work");
    assignThread(database, currentThread, workstream.id);
    assignThread(database, legacyThread, workstream.id);

    const state = buildStateResponse(database, "widget validation");
    assert.equal(state.best?.workstream.id, workstream.id);
    assert.deepEqual(
      state.best?.relatedThreads.map((thread) => thread.externalId).sort(),
      [currentThread, legacyThread].sort(),
    );
    assert.deepEqual(
      state.best?.relatedThreads.map((thread) => thread.resumeRef).sort(),
      [currentThread, legacyThread].sort(),
    );
  });
});

test("state JSON has a stable top-level and card shape", async () => {
  await withFixtureDatabase((database) => {
    const workstream = createWorkstream(database, "Fixture widget work");
    assignThread(database, currentThread, workstream.id);
    const parsed = JSON.parse(
      JSON.stringify(buildStateResponse(database, "widget validation")),
    ) as Record<string, unknown>;

    assert.deepEqual(Object.keys(parsed).sort(), [
      "alternates",
      "best",
      "query",
      "version",
    ]);
    const best = parsed.best as Record<string, unknown>;
    assert.deepEqual(Object.keys(best).sort(), [
      "bestThread",
      "confidence",
      "cwd",
      "latestActivity",
      "latestEvidence",
      "relatedFiles",
      "relatedThreads",
      "score",
      "signals",
      "workstream",
    ]);
    assert.deepEqual(
      Object.keys(best.workstream as Record<string, unknown>).sort(),
      ["id", "name", "origin"],
    );
  });
});

async function withEmptyDatabase(
  operation: (database: WorktrailDatabase) => void | Promise<void>,
): Promise<void> {
  const temporary = await mkdtemp(
    join(tmpdir(), "worktrail-workstreams-empty-"),
  );
  const database = new WorktrailDatabase(join(temporary, "worktrail.db"));
  try {
    await operation(database);
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

async function withFixtureDatabase(
  operation: (database: WorktrailDatabase) => void | Promise<void>,
): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "worktrail-workstreams-"));
  const database = new WorktrailDatabase(join(temporary, "worktrail.db"));
  try {
    const adapter = new CodexLocalAdapter({ fixtureDir });
    await importSources(database, adapter, { scope: "fixtures" });
    await operation(database);
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
