import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorktrailDatabase } from "../src/db/database.js";
import { findResumableTargets } from "../src/resume.js";
import {
  assignThread,
  createWorkstream,
  ignoreThread,
} from "../src/workstreams.js";
import {
  insertSyntheticThread,
  syntheticId,
} from "./helpers/synthetic-corpus.js";

test("resume ranks runs and canonical workstreams without leaking evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-resume-"));
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  const unassigned = syntheticId(201);
  const assigned = syntheticId(202);
  const ignored = syntheticId(203);
  try {
    insertSyntheticThread(database, {
      externalId: unassigned,
      title: "Daily report CLI",
      cwd: join(homedir(), "private", "worktrail"),
      updatedAt: "2026-06-19T12:00:00.000Z",
      evidence: ["private transcript daily report credential=https://x:y@host"],
      files: [join(homedir(), "private", "worktrail", "src/report.ts")],
    });
    insertSyntheticThread(database, {
      externalId: assigned,
      title: "Implement launcher contract",
      cwd: "/repo",
      updatedAt: "2026-06-18T12:00:00.000Z",
      evidence: ["control tower implementation"],
      files: ["src/control-tower.ts"],
    });
    insertSyntheticThread(database, {
      externalId: ignored,
      title: "Daily report ignored",
      cwd: "/repo",
      updatedAt: "2026-06-20T12:00:00.000Z",
      evidence: ["daily report"],
      files: [],
    });
    const workstream = createWorkstream(database, "Control Tower");
    assignThread(database, assigned, workstream.id);
    ignoreThread(database, ignored);

    const clock = () => new Date("2026-06-20T10:00:00.000Z");
    const runResult = findResumableTargets(database, {
      query: "daily report",
      clock,
    });
    assert.equal(runResult.schemaVersion, 1);
    assert.equal(runResult.generatedAt, clock().toISOString());
    assert.equal(runResult.targets[0]?.kind, "run");
    assert.equal(
      runResult.targets[0]?.resumeCommand,
      `codex resume ${unassigned}`,
    );
    assert.deepEqual(runResult.targets[0]?.command?.args, [
      "resume",
      unassigned,
    ]);
    assert.ok(runResult.targets[0]?.relatedFiles.includes("src/report.ts"));
    assert.ok(
      runResult.targets[0]?.signals.some(
        (signal) => signal.type === "title-match",
      ),
    );
    assert.equal(
      runResult.targets.some((target) => target.resumeRef === ignored),
      false,
    );
    const serialized = JSON.stringify(runResult);
    assert.equal(serialized.includes("private transcript"), false);
    assert.equal(serialized.includes(homedir()), false);
    assert.equal(serialized.includes("credential="), false);

    const canonical = findResumableTargets(database, {
      query: "control tower",
      clock,
    });
    assert.equal(canonical.targets[0]?.kind, "canonical-workstream");
    assert.equal(canonical.targets[0]?.title, "Control Tower");
    assert.ok(
      canonical.targets[0]?.signals.some(
        (signal) => signal.type === "manual-assignment",
      ),
    );
    assert.deepEqual(
      findResumableTargets(database, { query: "control tower", clock }),
      canonical,
    );
    assert.equal(
      findResumableTargets(database, { query: "absent phrase", clock }).targets
        .length,
      0,
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume bounds limits and excludes archived runs by default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-resume-"));
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    insertSyntheticThread(database, {
      externalId: syntheticId(204),
      title: "Archived safe apply",
      cwd: "/repo",
      updatedAt: "2026-06-20T12:00:00.000Z",
      evidence: ["safe apply"],
      files: [],
      archived: true,
    });
    assert.equal(
      findResumableTargets(database, { query: "safe apply", limit: 99 }).limit,
      20,
    );
    assert.equal(
      findResumableTargets(database, { query: "safe apply" }).targets.length,
      0,
    );
    assert.equal(
      findResumableTargets(database, {
        query: "safe apply",
        includeArchived: true,
      }).targets.length,
      1,
    );
    assert.throws(
      () => findResumableTargets(database, { query: "  " }),
      /requires a query/i,
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume accepts UUIDv7 references without allowing unsafe commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-resume-"));
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  const uuidV7 = "01912345-6789-7abc-8def-0123456789ab";
  const unsafeRef = "unsafe; echo exposed";
  try {
    insertSyntheticThread(database, {
      externalId: uuidV7,
      title: "Current resumable task",
      cwd: "/repo",
      updatedAt: "2026-06-20T12:00:00.000Z",
      evidence: ["current resumable task"],
      files: [],
    });
    insertSyntheticThread(database, {
      externalId: unsafeRef,
      title: "Unsafe resumable task",
      cwd: "/repo",
      updatedAt: "2026-06-19T12:00:00.000Z",
      evidence: ["unsafe resumable task"],
      files: [],
    });

    const current = findResumableTargets(database, {
      query: "current",
    });
    assert.equal(current.targets[0]?.resumeCommand, `codex resume ${uuidV7}`);
    assert.deepEqual(current.targets[0]?.command, {
      program: "codex",
      args: ["resume", uuidV7],
    });
    assert.equal(current.diagnostics.length, 0);

    const unsafe = findResumableTargets(database, {
      query: "unsafe",
    });
    assert.equal(unsafe.targets[0]?.resumeCommand, undefined);
    assert.equal(unsafe.targets[0]?.openActions[0]?.kind, "copy-id");
    assert.equal(unsafe.diagnostics[0]?.code, "unsafe-resume-ref");
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
