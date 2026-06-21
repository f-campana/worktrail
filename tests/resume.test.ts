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
    assert.deepEqual(runResult.targets[0]?.openActions, [
      {
        kind: "open-codex",
        label: "Open in Codex",
        value: `codex://threads/${unassigned}`,
      },
      {
        kind: "copy-command",
        label: "Copy Codex resume command",
        value: `codex resume ${unassigned}`,
      },
    ]);
    assert.ok(runResult.targets[0]?.relatedFiles.includes("src/report.ts"));
    assert.ok(
      runResult.targets[0]?.signals.some(
        (signal) => signal.type === "title-phrase-match",
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

test("resume ranks exact titles above content and calibrates weak content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-resume-"));
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    insertSyntheticThread(database, {
      externalId: syntheticId(210),
      title: "GitHub Profile",
      cwd: "/repo/site",
      updatedAt: "2026-06-01T12:00:00.000Z",
      evidence: ["review account presentation"],
      files: [],
    });
    insertSyntheticThread(database, {
      externalId: syntheticId(211),
      title: "Recent unrelated work",
      cwd: "/repo/other",
      updatedAt: "2026-06-20T12:00:00.000Z",
      evidence: ["github profile appeared in passing"],
      files: [],
    });

    const phrase = findResumableTargets(database, { query: "github profile" });
    assert.equal(phrase.targets[0]?.title, "GitHub Profile");
    assert.equal(phrase.targets[0]?.confidence, "high");
    assert.equal(phrase.targets[1]?.confidence, "medium");
    assert.ok(
      phrase.targets[0]!.score > phrase.targets[1]!.score,
      "exact title evidence must outrank newer content-only evidence",
    );

    const broad = findResumableTargets(database, { query: "profile" });
    const contentOnly = broad.targets.find(
      (target) => target.title === "Recent unrelated work",
    );
    assert.equal(contentOnly?.confidence, "low");
    assert.ok(
      contentOnly?.signals.some(
        (signal) =>
          signal.type === "content-only-match" &&
          signal.label.includes("Weak content-only"),
      ),
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume prioritizes project paths and meaningful files over generic files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-resume-"));
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    insertSyntheticThread(database, {
      externalId: syntheticId(212),
      title: "Review PieChart component",
      cwd: "/repo/scaleway",
      updatedAt: "2026-06-01T12:00:00.000Z",
      evidence: ["chart review"],
      files: ["/repo/scaleway/src/PieChart.tsx"],
    });
    insertSyntheticThread(database, {
      externalId: syntheticId(213),
      title: "Recent backend notes",
      cwd: "/repo/other",
      updatedAt: "2026-06-20T12:00:00.000Z",
      evidence: ["scaleway was mentioned"],
      files: [],
    });
    insertSyntheticThread(database, {
      externalId: syntheticId(214),
      title: "Generic component",
      cwd: "/repo/generic",
      updatedAt: "2026-06-20T13:00:00.000Z",
      evidence: ["component"],
      files: ["/repo/generic/src/Profile.tsx"],
    });
    insertSyntheticThread(database, {
      externalId: syntheticId(215),
      title: "Account editor",
      cwd: "/repo/accounts",
      updatedAt: "2026-06-01T13:00:00.000Z",
      evidence: ["component"],
      files: ["/repo/accounts/features/profile/editor.ts"],
    });

    const project = findResumableTargets(database, { query: "scaleway" });
    assert.equal(project.targets[0]?.title, "Review PieChart component");
    assert.equal(project.targets[0]?.confidence, "high");
    assert.ok(
      project.targets[0]?.signals.some(
        (signal) => signal.type === "exact-project-match",
      ),
    );

    const files = findResumableTargets(database, { query: "profile" });
    assert.equal(files.targets[0]?.title, "Account editor");
    const generic = files.targets.find(
      (target) => target.title === "Generic component",
    );
    assert.equal(generic?.confidence, "low");
    assert.ok(
      generic?.signals.some((signal) => signal.type === "generic-file-match"),
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume rewards multi-token coverage before recency and only uses recency to tie-break", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-resume-"));
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    insertSyntheticThread(database, {
      externalId: syntheticId(216),
      title: "Complete evidence",
      cwd: "/repo/complete",
      updatedAt: "2026-06-01T12:00:00.000Z",
      evidence: ["github profile"],
      files: [],
    });
    insertSyntheticThread(database, {
      externalId: syntheticId(217),
      title: "Partial but recent",
      cwd: "/repo/partial",
      updatedAt: "2026-06-20T12:00:00.000Z",
      evidence: ["github only"],
      files: [],
    });
    insertSyntheticThread(database, {
      externalId: syntheticId(218),
      title: "Older raycast mention",
      cwd: "/repo/older",
      updatedAt: "2026-06-10T12:00:00.000Z",
      evidence: ["raycast"],
      files: [],
    });
    insertSyntheticThread(database, {
      externalId: syntheticId(219),
      title: "Newer raycast mention",
      cwd: "/repo/newer",
      updatedAt: "2026-06-11T12:00:00.000Z",
      evidence: ["raycast"],
      files: [],
    });

    const coverage = findResumableTargets(database, {
      query: "github profile",
    });
    assert.equal(coverage.targets[0]?.title, "Complete evidence");
    assert.ok(coverage.targets[0]!.score > coverage.targets[1]!.score);

    const tied = findResumableTargets(database, { query: "raycast" });
    assert.equal(tied.targets[0]?.title, "Newer raycast mention");
    assert.equal(tied.targets[0]?.score, tied.targets[1]?.score);
    assert.ok(
      tied.targets[0]?.signals.some(
        (signal) => signal.type === "recent-activity" && signal.weight === 0,
      ),
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("included archived results are marked and rank below equivalent active results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-resume-"));
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    insertSyntheticThread(database, {
      externalId: syntheticId(220),
      title: "Safe Apply",
      cwd: "/repo/active",
      updatedAt: "2026-06-01T12:00:00.000Z",
      evidence: ["active"],
      files: [],
    });
    insertSyntheticThread(database, {
      externalId: syntheticId(221),
      title: "Safe Apply",
      cwd: "/repo/archived",
      updatedAt: "2026-06-20T12:00:00.000Z",
      evidence: ["archived"],
      files: [],
      archived: true,
    });

    const defaultResult = findResumableTargets(database, {
      query: "safe apply",
    });
    assert.equal(defaultResult.targets.length, 1);
    assert.equal(defaultResult.targets[0]?.archived, undefined);

    const included = findResumableTargets(database, {
      query: "safe apply",
      includeArchived: true,
    });
    assert.equal(included.targets[0]?.resumeRef, syntheticId(220));
    assert.equal(included.targets[1]?.archived, true);
    assert.ok(included.targets[0]!.score > included.targets[1]!.score);
    assert.ok(
      included.targets[1]?.signals.some(
        (signal) => signal.type === "archived-penalty",
      ),
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
    assert.equal(
      current.targets[0]?.openActions[0]?.value,
      `codex://threads/${uuidV7}`,
    );
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
