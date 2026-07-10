import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
    const timed = spawnSync(
      cli,
      [
        "src/cli.ts",
        "resume",
        "daily report",
        "--db",
        dbPath,
        "--json",
        "--debug-timing",
      ],
      { encoding: "utf8" },
    );
    assert.equal(timed.status, 0);
    assert.equal(JSON.parse(timed.stdout).schemaVersion, 1);
    const timingLine = timed.stderr
      .split("\n")
      .find((line) => line.startsWith("[worktrail timing] "));
    assert.ok(timingLine);
    const timing = JSON.parse(timingLine.slice(19)) as {
      command: string;
      durationMs: number;
      phases: Record<string, number>;
    };
    assert.equal(timing.command, "resume");
    assert.ok(timing.durationMs >= 0);
    assert.ok(timing.phases["search-ranking"]! >= 0);
    assert.doesNotMatch(timingLine, /daily report/);
    assert.doesNotMatch(timingLine, new RegExp(dbPath));
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

test("read-only resume skips migration and write setup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-read-only-"));
  const dbPath = join(directory, "worktrail.db");
  const writable = new WorktrailDatabase(dbPath);
  try {
    const id = syntheticId(302);
    insertSyntheticThread(writable, {
      externalId: id,
      title: "Read-only resume",
      cwd: "/repo",
      updatedAt: "2026-06-20T10:00:00.000Z",
      evidence: ["read-only resume"],
      files: ["src/resume.ts"],
    });
  } finally {
    writable.close();
  }

  const readOnly = new WorktrailDatabase(dbPath, { readOnly: true });
  try {
    assert.equal(readOnly.scalar("PRAGMA query_only"), 1);
    assert.throws(() =>
      readOnly.raw.exec(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (99, 'forbidden', 'now')",
      ),
    );
  } finally {
    readOnly.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume honors CODEX_HOME by default and an explicit Codex home override", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-codex-home-"));
  const dbPath = join(directory, "worktrail.db");
  const codexHome = join(directory, "codex-default");
  const explicitCodexHome = join(directory, "codex-explicit");
  const database = new WorktrailDatabase(dbPath);
  const id = syntheticId(304);
  const missingPath = join(
    codexHome,
    "sessions",
    "2026",
    "06",
    "20",
    `rollout-2026-06-20T12-00-00-${id}.jsonl`,
  );
  try {
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await mkdir(join(explicitCodexHome, "sessions"), { recursive: true });
    insertSyntheticThread(database, {
      externalId: id,
      title: "Custom home resume",
      cwd: "/repo",
      updatedAt: "2026-06-20T10:00:00.000Z",
      evidence: ["custom home resume"],
      files: [],
    });
    database.raw
      .prepare("UPDATE sources SET source_uri = ? WHERE external_id = ?")
      .run(missingPath, id);
    database.close();

    const fromEnvironment = spawnSync(
      cli,
      ["src/cli.ts", "resume", "custom home resume", "--db", dbPath, "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, CODEX_HOME: codexHome },
      },
    );
    assert.equal(fromEnvironment.status, 0, fromEnvironment.stderr);
    assert.deepEqual(JSON.parse(fromEnvironment.stdout).targets, []);

    const explicitMissingPath = missingPath.replace(
      codexHome,
      explicitCodexHome,
    );
    const writable = new WorktrailDatabase(dbPath);
    writable.raw
      .prepare("UPDATE sources SET source_uri = ? WHERE external_id = ?")
      .run(explicitMissingPath, id);
    writable.close();
    const fromFlag = spawnSync(
      cli,
      [
        "src/cli.ts",
        "resume",
        "custom home resume",
        "--db",
        dbPath,
        "--codex-home",
        explicitCodexHome,
        "--json",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, CODEX_HOME: join(directory, "wrong-home") },
      },
    );
    assert.equal(fromFlag.status, 0, fromFlag.stderr);
    assert.deepEqual(JSON.parse(fromFlag.stdout).targets, []);
  } finally {
    try {
      database.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

test("read-only commands report stale and newer schemas without JSON stdout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-stale-schema-"));
  const dbPath = join(directory, "worktrail.db");
  try {
    const stale = new WorktrailDatabase(dbPath);
    stale.raw.prepare("DELETE FROM schema_migrations WHERE version = 4").run();
    stale.close();

    for (const command of [
      ["resume", "profile", "--json"],
      ["target", "validate", syntheticId(305), "--json"],
      ["attention", "--since", "2026-06-20T00:00:00Z", "--json"],
    ]) {
      const result = spawnSync(
        cli,
        ["src/cli.ts", ...command, "--db", dbPath],
        {
          encoding: "utf8",
        },
      );
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /Worktrail database needs an update/);
      assert.match(result.stderr, /worktrail index/);
      assert.doesNotMatch(
        result.stderr,
        /SQLITE_ERROR|no such table|at runResume/,
      );
    }

    const newer = new DatabaseSync(dbPath);
    newer
      .prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (4, 'project-identities', 'now')",
      )
      .run();
    newer
      .prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (5, 'future', 'now')",
      )
      .run();
    newer.close();
    const result = spawnSync(
      cli,
      ["src/cli.ts", "resume", "profile", "--json", "--db", dbPath],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /database is newer than this CLI/i);
    assert.doesNotMatch(result.stderr, /SQLITE_ERROR|stack/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("target validate CLI returns clean JSON without opening Codex", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-target-cli-"));
  const dbPath = join(directory, "worktrail.db");
  const codexHome = join(directory, "codex");
  const database = new WorktrailDatabase(dbPath);
  const id = syntheticId(303);
  const rolloutPath = join(
    codexHome,
    "sessions",
    "2026",
    "06",
    "20",
    `rollout-2026-06-20T12-00-00-${id}.jsonl`,
  );
  try {
    await mkdir(dirname(rolloutPath), { recursive: true });
    await writeFile(rolloutPath, "{}\n", "utf8");
    insertSyntheticThread(database, {
      externalId: id,
      title: "Validate CLI",
      cwd: "/repo",
      updatedAt: "2026-06-20T10:00:00.000Z",
      evidence: ["validate cli"],
      files: [],
    });
    database.raw
      .prepare("UPDATE sources SET source_uri = ? WHERE external_id = ?")
      .run(rolloutPath, id);
    database.close();

    const openable = spawnSync(
      cli,
      [
        "src/cli.ts",
        "target",
        "validate",
        id,
        "--db",
        dbPath,
        "--codex-home",
        codexHome,
        "--json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(openable.status, 0, openable.stderr);
    assert.deepEqual(JSON.parse(openable.stdout), {
      schemaVersion: 1,
      resumeRef: id,
      status: "openable",
      openUrl: `codex://threads/${id}`,
    });

    const invalid = spawnSync(
      cli,
      [
        "src/cli.ts",
        "target",
        "validate",
        "unsafe; echo nope",
        "--db",
        dbPath,
        "--json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(invalid.status, 0, invalid.stderr);
    assert.equal(JSON.parse(invalid.stdout).status, "invalid");
  } finally {
    try {
      database.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
