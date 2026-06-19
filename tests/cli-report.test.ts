import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { WorktrailDatabase } from "../src/db/database.js";
import {
  assignThread,
  createWorkstream,
  ignoreThread,
} from "../src/workstreams.js";
import {
  insertSyntheticThread,
  syntheticId,
} from "./helpers/synthetic-corpus.js";

const cli = resolve("node_modules/.bin/tsx");
const since = "2026-06-18T00:00:00Z";
const until = "2026-06-19T00:00:00Z";

test("report CLI emits stable JSON and compact evidence-free human output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-cli-report-"));
  const dbPath = join(directory, "worktrail.db");
  const database = new WorktrailDatabase(dbPath);
  const repoPath = join(directory, "repo");
  const assigned = syntheticId(101);
  const ignored = syntheticId(102);
  try {
    execFileSync("git", ["init", "-b", "report-test", repoPath]);
    execFileSync("git", ["-C", repoPath, "config", "user.name", "Test"]);
    execFileSync("git", [
      "-C",
      repoPath,
      "config",
      "user.email",
      "test@example.invalid",
    ]);
    await writeFile(join(repoPath, "report.txt"), "report\n");
    execFileSync("git", ["-C", repoPath, "add", "report.txt"]);
    execFileSync("git", ["-C", repoPath, "commit", "-m", "report change"], {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-06-18T10:00:00Z",
        GIT_COMMITTER_DATE: "2026-06-18T10:00:00Z",
      },
    });
    insertSyntheticThread(database, {
      externalId: assigned,
      title: "Assigned",
      cwd: repoPath,
      updatedAt: "2026-06-18T12:00:00.000Z",
      evidence: ["private transcript phrase"],
      files: ["src/a.ts"],
    });
    insertSyntheticThread(database, {
      externalId: ignored,
      title: "Ignored",
      cwd: "/repo",
      updatedAt: "2026-06-18T13:00:00.000Z",
      evidence: [],
      files: [],
    });
    const workstream = createWorkstream(database, "Canonical work");
    assignThread(database, assigned, workstream.id);
    ignoreThread(database, ignored);
    database.close();

    const common = [
      "src/cli.ts",
      "report",
      "--since",
      since,
      "--until",
      until,
      "--timezone",
      "Europe/Paris",
      "--db",
      dbPath,
    ];
    const jsonText = execFileSync(cli, [...common, "--json"], {
      encoding: "utf8",
    });
    const report = JSON.parse(jsonText) as Record<string, any>;
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.window.timezone, "Europe/Paris");
    assert.equal(report.activeWorkstreams[0].name, "Canonical work");
    assert.equal(report.omitted.ignoredRuns, 1);
    assert.equal(report.git.repositories[0].branch, "report-test");
    assert.equal(report.git.repositories[0].commitsInWindow.length, 1);
    assert.equal(jsonText.includes("private transcript phrase"), false);

    const human = execFileSync(cli, common, { encoding: "utf8" });
    assert.match(human, /Canonical work/);
    assert.match(human, new RegExp(`codex resume ${assigned}`));
    assert.match(human, /Ignored runs: 1/);
    assert.match(human, /Transcript-like evidence excerpts are omitted/);
    assert.match(human, /Git/);
    assert.match(human, /Branch: report-test/);
    assert.match(human, /Files in window: report.txt/);
    assert.equal(human.includes("private transcript phrase"), false);
  } finally {
    try {
      database.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

test("report CLI rejects missing, invalid, and inverted windows", () => {
  for (const [args, expected] of [
    [["report"], "report requires --since"],
    [["report", "--since", "not-a-date"], "valid ISO instant"],
    [["report", "--since", until, "--until", since], "since before until"],
  ] as const) {
    const result = spawnSync(cli, ["src/cli.ts", ...args], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(expected));
  }
});
