import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { WorktrailDatabase } from "../src/db/database.js";
import {
  insertSyntheticThread,
  syntheticId,
} from "./helpers/synthetic-corpus.js";

const cli = resolve("node_modules/.bin/tsx");

test("resume CLI validates query and renders human and JSON output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-cli-resume-"));
  const dbPath = join(directory, "worktrail.db");
  const database = new WorktrailDatabase(dbPath);
  const id = syntheticId(301);
  try {
    insertSyntheticThread(database, {
      externalId: id,
      title: "Daily report",
      cwd: "/repo",
      updatedAt: "2026-06-20T10:00:00.000Z",
      evidence: ["daily report"],
      files: ["src/report.ts"],
    });
    database.close();
    const human = spawnSync(
      cli,
      ["src/cli.ts", "resume", "daily report", "--db", dbPath],
      { encoding: "utf8" },
    );
    assert.equal(human.status, 0);
    assert.match(human.stdout, /Best resumable target/);
    assert.match(human.stdout, new RegExp(`codex resume ${id}`));
    const json = spawnSync(
      cli,
      ["src/cli.ts", "resume", "daily report", "--db", dbPath, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(JSON.parse(json.stdout).schemaVersion, 1);
    const missing = spawnSync(cli, ["src/cli.ts", "resume"], {
      encoding: "utf8",
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /requires a query/i);
  } finally {
    try {
      database.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
