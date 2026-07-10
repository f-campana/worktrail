import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { WorktrailDatabase } from "../src/db/database.js";
import {
  insertSyntheticThread,
  syntheticId,
} from "./helpers/synthetic-corpus.js";

const cli = resolve("node_modules/.bin/tsx");
const since = "2026-07-07T00:00:00Z";
const until = "2026-07-08T00:00:00Z";

test("attention CLI emits clean v1 JSON with safe actions for active work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-cli-attention-"));
  const dbPath = join(directory, "worktrail.db");
  const codexHome = join(directory, "codex");
  const id = syntheticId(501);
  const rolloutPath = join(
    codexHome,
    "sessions",
    "2026",
    "07",
    "07",
    `rollout-2026-07-07T12-00-00-${id}.jsonl`,
  );
  const database = new WorktrailDatabase(dbPath);
  try {
    await mkdir(dirname(rolloutPath), { recursive: true });
    await writeFile(rolloutPath, "{}\n", "utf8");
    insertSyntheticThread(database, {
      externalId: id,
      title: "Active attention target",
      cwd: "/safe/example",
      updatedAt: "2026-07-07T12:00:00.000Z",
      evidence: ["private transcript marker"],
      files: ["src/attention.ts"],
    });
    database.raw
      .prepare("UPDATE sources SET source_uri = ? WHERE external_id = ?")
      .run(rolloutPath, id);
    database.close();

    const result = spawnSync(
      cli,
      [
        "src/cli.ts",
        "attention",
        "--since",
        since,
        "--until",
        until,
        "--timezone",
        "Europe/Paris",
        "--db",
        dbPath,
        "--codex-home",
        codexHome,
        "--json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const digest = JSON.parse(result.stdout) as Record<string, any>;
    assert.equal(digest.schemaVersion, 1);
    assert.equal(digest.window.timezone, "Europe/Paris");
    assert.equal(digest.changedWork.length, 1);
    assert.equal(digest.changedWork[0].runs[0].sourceId, id);
    assert.equal(
      digest.changedWork[0].actions[0].value,
      `codex://threads/${id}`,
    );
    assert.deepEqual(digest.attentionItems, []);
    assert.deepEqual(digest.sourceHealth, []);
    assert.equal(digest.summary.sourceHealth, "unknown");
    assert.equal(result.stdout.includes("private transcript marker"), false);
    assert.doesNotMatch(result.stderr, /ExperimentalWarning.*SQLite/i);
  } finally {
    try {
      database.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

test("attention CLI requires JSON and validates its report window", () => {
  for (const [args, expected] of [
    [["attention", "--since", since], "supports --json only"],
    [["attention", "--json"], "attention requires --since"],
    [["attention", "--since", "not-a-date", "--json"], "valid ISO instant"],
    [
      ["attention", "--since", until, "--until", since, "--json"],
      "since before until",
    ],
  ] as const) {
    const result = spawnSync(cli, ["src/cli.ts", ...args], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(expected));
  }
});
