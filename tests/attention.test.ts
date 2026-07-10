import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildAttentionDigest,
  buildAttentionDigestFromReport,
} from "../src/attention.js";
import { WorktrailDatabase } from "../src/db/database.js";
import { buildDailyReport } from "../src/report.js";
import type { SourceStateProvider } from "../src/source-state.js";
import { assignThread, createWorkstream } from "../src/workstreams.js";
import {
  insertSyntheticThread,
  syntheticId,
} from "./helpers/synthetic-corpus.js";

const since = new Date("2026-06-18T00:00:00.000Z");
const until = new Date("2026-06-19T00:00:00.000Z");
const generatedAt = "2026-06-19T08:30:00.000Z";
const options = {
  since,
  until,
  timezone: "Europe/Paris",
  clock: () => new Date(generatedAt),
};

test("builds the deterministic Phase 2 skeleton from one report window", async () =>
  withDatabase((database) => {
    const digest = buildAttentionDigest(database, options);
    assert.equal(digest.schemaVersion, 1);
    assert.equal(digest.generatedAt, generatedAt);
    assert.deepEqual(digest.window, {
      since: since.toISOString(),
      until: until.toISOString(),
      timezone: "Europe/Paris",
      boundaryPolicy: "since-inclusive-until-exclusive",
    });
    assert.deepEqual(digest.attentionItems, []);
    assert.deepEqual(digest.sourceHealth, []);
    assert.deepEqual(digest.summary, {
      attentionCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      changedWorkCount: 0,
      sourceHealth: "unknown",
    });
    assert.deepEqual(digest.omitted, {
      ignoredRuns: 0,
      archivedTargets: 0,
      missingTargets: 0,
      unavailableSourceObservations: 0,
    });
    assert.match(digest.limitations.at(-1)!, /Phase 2 only/);
  }));

test("adds safe actions only for active Codex targets", async () =>
  withDatabase((database) => {
    const id = syntheticId(30);
    insertRun(database, id, "Active target", "2026-06-18T15:00:00.000Z");
    const digest = buildAttentionDigest(database, {
      ...options,
      sourceStateProvider: states({ [id]: "active" }),
    });
    assert.deepEqual(digest.changedWork[0]?.actions, [
      {
        kind: "open-codex",
        label: "Open in Codex",
        value: `codex://threads/${id}`,
        target: { sourceTool: "codex-local", resumeRef: id },
        validation: "validate-before-open",
      },
      {
        kind: "copy-command",
        label: "Copy Codex resume command",
        value: `codex resume ${id}`,
        target: { sourceTool: "codex-local", resumeRef: id },
        validation: "not-required",
      },
    ]);
    assert.deepEqual(digest.omitted, {
      ignoredRuns: 0,
      archivedTargets: 0,
      missingTargets: 0,
      unavailableSourceObservations: 0,
    });
  }));

test("archived, missing, and unknown targets fail closed without attention items", async () =>
  withDatabase((database) => {
    const archived = syntheticId(31);
    const missing = syntheticId(32);
    const unknown = syntheticId(33);
    insertRun(
      database,
      archived,
      "Archived target",
      "2026-06-18T15:00:00.000Z",
    );
    insertRun(database, missing, "Missing target", "2026-06-18T14:00:00.000Z");
    insertRun(database, unknown, "Unknown target", "2026-06-18T13:00:00.000Z");
    const digest = buildAttentionDigest(database, {
      ...options,
      sourceStateProvider: states({
        [archived]: "archived",
        [missing]: "missing",
        [unknown]: "unknown",
      }),
    });
    assert.deepEqual(
      digest.changedWork.flatMap((group) => group.actions),
      [],
    );
    assert.deepEqual(digest.omitted, {
      ignoredRuns: 0,
      archivedTargets: 1,
      missingTargets: 1,
      unavailableSourceObservations: 1,
    });
    assert.deepEqual(digest.attentionItems, []);
    assert.deepEqual(digest.sourceHealth, []);
    assert.equal(digest.summary.sourceHealth, "unknown");
    assert.ok(digest.limitations.some((item) => item.includes("fail closed")));
  }));

test("group action prefers the latest active run while counting older unavailable targets", async () =>
  withDatabase((database) => {
    const latestArchived = syntheticId(34);
    const latestActive = syntheticId(35);
    const olderActive = syntheticId(36);
    const missing = syntheticId(37);
    for (const [id, title, at] of [
      [latestArchived, "Latest archived", "2026-06-18T16:00:00.000Z"],
      [latestActive, "Latest active", "2026-06-18T15:00:00.000Z"],
      [olderActive, "Older active", "2026-06-18T14:00:00.000Z"],
      [missing, "Older missing", "2026-06-18T13:00:00.000Z"],
    ] as const)
      insertRun(database, id, title, at);
    const workstream = createWorkstream(database, "Shared group");
    for (const id of [latestArchived, latestActive, olderActive, missing])
      assignThread(database, id, workstream.id);

    const digest = buildAttentionDigest(database, {
      ...options,
      sourceStateProvider: states({
        [latestArchived]: "archived",
        [latestActive]: "active",
        [olderActive]: "active",
        [missing]: "missing",
      }),
    });
    assert.equal(digest.changedWork.length, 1);
    assert.equal(
      digest.changedWork[0]?.actions[0]?.value,
      `codex://threads/${latestActive}`,
    );
    assert.equal(digest.omitted.archivedTargets, 1);
    assert.equal(digest.omitted.missingTargets, 1);
    assert.equal(digest.attentionItems.length, 0);
  }));

test("absent observations and unsafe refs never produce open actions", async () =>
  withDatabase((database) => {
    const id = syntheticId(38);
    insertRun(database, id, "Absent observation", "2026-06-18T15:00:00.000Z");
    const unsafe = syntheticId(39);
    insertRun(database, unsafe, "Unsafe ref", "2026-06-18T14:00:00.000Z");
    database.raw
      .prepare(
        "UPDATE source_threads SET resume_ref = 'not-a-uuid' WHERE external_id = ?",
      )
      .run(unsafe);
    const digest = buildAttentionDigest(database, {
      ...options,
      sourceStateProvider: () => [],
    });
    assert.deepEqual(
      digest.changedWork.flatMap((group) => group.actions),
      [],
    );
    assert.equal(digest.omitted.unavailableSourceObservations, 2);
  }));

test("source provider failures become unavailable observations", async () =>
  withDatabase((database) => {
    const id = syntheticId(40);
    insertRun(database, id, "Provider failure", "2026-06-18T15:00:00.000Z");
    const digest = buildAttentionDigest(database, {
      ...options,
      sourceStateProvider: () => {
        throw new Error("source unavailable");
      },
    });
    assert.deepEqual(digest.changedWork[0]?.actions, []);
    assert.equal(digest.omitted.unavailableSourceObservations, 1);
    assert.deepEqual(digest.attentionItems, []);
  }));

test("groups canonical, durable project, and unassigned work exactly once", async () =>
  withDatabase((database) => {
    const canonicalId = syntheticId(1);
    const projectId = syntheticId(2);
    const unassignedId = syntheticId(3);
    for (const [id, title, at, files] of [
      [
        canonicalId,
        "Canonical run",
        "2026-06-18T14:00:00.000Z",
        ["/safe/example/src/a.ts", "src/a.ts"],
      ],
      [projectId, "Project run", "2026-06-18T13:00:00.000Z", ["src/b.ts"]],
      [unassignedId, "Loose run", "2026-06-18T12:00:00.000Z", []],
    ] as const)
      insertSyntheticThread(database, {
        externalId: id,
        title,
        cwd: "/safe/example",
        updatedAt: at,
        evidence: [],
        files: [...files],
      });

    const workstream = createWorkstream(database, "Canonical");
    assignThread(database, canonicalId, workstream.id);
    addProjectMembership(
      database,
      canonicalId,
      "prj_canonical",
      "Ignored project",
    );
    addProjectMembership(database, projectId, "prj_project", "Project context");

    const report = buildDailyReport(database, { ...options, git: false });
    const reportSnapshot = JSON.stringify(report);
    const digest = buildAttentionDigestFromReport(database, {
      ...report,
      limitations: [...report.limitations, report.limitations[0]!],
    });

    assert.equal(JSON.stringify(report), reportSnapshot);
    assert.deepEqual(
      digest.changedWork.map((item) => item.group),
      [
        {
          kind: "canonical-workstream",
          id: workstream.id,
          title: "Canonical",
          provisional: false,
        },
        {
          kind: "project-context",
          id: "prj_project",
          title: "Project context",
          provisional: true,
        },
        {
          kind: "unassigned",
          id: "unassigned",
          title: "Unassigned",
          provisional: true,
        },
      ],
    );
    assert.deepEqual(
      digest.changedWork
        .flatMap((group) => group.runs.map((run) => run.sourceId))
        .sort(),
      [canonicalId, projectId, unassignedId].sort(),
    );
    assert.deepEqual(digest.changedWork[0]?.relatedFiles, ["src/a.ts"]);
    assert.equal(new Set(digest.limitations).size, digest.limitations.length);
    assert.deepEqual(digest.attentionItems, []);
    assert.deepEqual(
      digest.changedWork.flatMap((group) => group.actions),
      [],
    );
  }));

test("ordering uses latest activity then kind, title, and id", async () =>
  withDatabase((database) => {
    for (const [number, title] of [
      [10, "Zulu"],
      [11, "Alpha"],
    ] as const) {
      const id = syntheticId(number);
      insertSyntheticThread(database, {
        externalId: id,
        title,
        cwd: "/safe/example",
        updatedAt: "2026-06-18T12:00:00.000Z",
        evidence: [],
        files: [],
      });
      const workstream = createWorkstream(database, title);
      assignThread(database, id, workstream.id);
    }
    const first = buildAttentionDigest(database, options);
    const second = buildAttentionDigest(database, options);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.deepEqual(
      first.changedWork.map((item) => item.group.title),
      ["Alpha", "Zulu"],
    );
  }));

test("result exposes no transcript excerpts or unsupported state claims", async () =>
  withDatabase((database) => {
    insertSyntheticThread(database, {
      externalId: syntheticId(20),
      title: "Recent activity",
      cwd: "/safe/example",
      updatedAt: "2026-06-18T12:00:00.000Z",
      evidence: ["private transcript marker"],
      files: [],
    });
    const serialized = JSON.stringify(buildAttentionDigest(database, options));
    assert.equal(serialized.includes("private transcript marker"), false);
    for (const label of [
      "blocked",
      "done",
      "ready-to-review",
      "ready-to-merge",
      "waiting-on-agent",
      "waiting-on-user",
      "open-loop",
      "decision-needed",
    ])
      assert.equal(serialized.includes(label), false, label);
  }));

function addProjectMembership(
  database: WorktrailDatabase,
  externalId: string,
  publicId: string,
  name: string,
): void {
  const now = "2026-06-18T10:00:00.000Z";
  const project = database.raw
    .prepare(
      `INSERT INTO project_identities(
       public_id, key_kind, opaque_key, name, normalized_name, confidence,
       status, created_at, updated_at
     ) VALUES (?, 'cwd', ?, ?, ?, 'medium', 'active', ?, ?) RETURNING id`,
    )
    .get(
      publicId,
      `opaque-${publicId}`,
      name,
      name.toLowerCase(),
      now,
      now,
    ) as { id: number };
  database.raw
    .prepare(
      `INSERT INTO project_thread_memberships(
       project_id, thread_id, role, confidence, basis, created_at, updated_at)
     SELECT ?, id, 'primary', 'medium', 'cwd', ?, ? FROM source_threads WHERE external_id = ?`,
    )
    .run(project.id, now, now, externalId);
}

async function withDatabase(
  operation: (database: WorktrailDatabase) => void | Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-attention-"));
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    await operation(database);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function insertRun(
  database: WorktrailDatabase,
  externalId: string,
  title: string,
  updatedAt: string,
): void {
  insertSyntheticThread(database, {
    externalId,
    title,
    cwd: "/safe/example",
    updatedAt,
    evidence: [],
    files: [],
  });
}

function states(
  values: Record<string, "active" | "archived" | "missing" | "unknown">,
): SourceStateProvider {
  return (requests) =>
    requests.map((request) => ({
      sourceId: request.sourceId,
      resumeRef: request.resumeRef,
      state: values[request.resumeRef] ?? "unknown",
      observedAt: generatedAt,
      sourceTool: "codex-local",
    }));
}
