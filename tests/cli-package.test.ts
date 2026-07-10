import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { WorktrailDatabase } from "../src/db/database.js";
import {
  insertSyntheticThread,
  syntheticId,
} from "./helpers/synthetic-corpus.js";

test("build emits a directly executable CLI with runtime migrations", async () => {
  const pnpmCli = process.env.npm_execpath;
  assert.ok(pnpmCli, "pnpm CLI path must be available during pnpm test");
  execFileSync(process.execPath, [pnpmCli, "build"], {
    encoding: "utf8",
  });

  const executable = resolve("dist/cli.js");
  await access(executable, constants.X_OK);
  assert.equal(
    (await readFile(executable, "utf8")).split("\n")[0],
    "#!/usr/bin/env node",
  );
  for (const migration of [
    "001_initial.sql",
    "002_workstreams.sql",
    "003_workstream_quality.sql",
    "004_project_identities.sql",
  ]) {
    await access(resolve("dist/db/migrations", migration));
  }

  const directory = await mkdtemp(join(tmpdir(), "worktrail-package-"));
  const databasePath = join(directory, "worktrail.db");
  const database = new WorktrailDatabase(databasePath);
  try {
    insertSyntheticThread(database, {
      externalId: syntheticId(401),
      title: "Packaged CLI",
      cwd: "/repo",
      updatedAt: "2026-06-21T00:00:00.000Z",
      evidence: ["packaged cli"],
      files: ["src/cli.ts"],
    });
    database.close();

    const result = spawnSync(
      executable,
      ["resume", "packaged cli", "--db", databasePath, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).schemaVersion, 1);
    assert.doesNotMatch(result.stderr, /ExperimentalWarning.*SQLite/i);
  } finally {
    try {
      database.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
