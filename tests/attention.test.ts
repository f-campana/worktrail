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

test("builds the deterministic Phase 1 skeleton from one report window", async () =>
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
    assert.match(digest.limitations.at(-1)!, /Phase 1 only/);
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
