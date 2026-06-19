import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorktrailDatabase } from "../src/db/database.js";
import { buildDailyReport } from "../src/report.js";
import {
  addWorkstreamAlias,
  assignThread,
  createWorkstream,
  ignoreThread,
  mergeWorkstreams,
} from "../src/workstreams.js";
import {
  insertSyntheticThread,
  syntheticId,
} from "./helpers/synthetic-corpus.js";

const since = "2026-06-18T00:00:00.000Z";
const until = "2026-06-19T00:00:00.000Z";
const generatedAt = "2026-06-19T08:30:00.000Z";
const options = {
  since,
  until,
  timezone: "Europe/Paris",
  clock: () => new Date(generatedAt),
};

test("empty daily report has a fixed clock and explicit window policy", async () =>
  withDatabase((database) => {
    assert.deepEqual(buildDailyReport(database, options), {
      schemaVersion: 1,
      generatedAt,
      window: {
        since,
        until,
        timezone: "Europe/Paris",
        boundaryPolicy: "since-inclusive-until-exclusive",
      },
      activeWorkstreams: [],
      unassignedRuns: [],
      omitted: { ignoredRuns: 0 },
      limitations: [
        "Activity only; completion, blockage, review, and delivery status are not inferred.",
        "Transcript-like evidence excerpts are omitted.",
      ],
    });
  }));

test("report organizes manual workstreams and leaves candidates unassigned", async () =>
  withDatabase((database) => {
    const assigned = syntheticId(1);
    const candidate = syntheticId(2);
    const ignored = syntheticId(3);
    insertSyntheticThread(database, {
      externalId: assigned,
      title: "Assigned",
      cwd: "/repo",
      updatedAt: "2026-06-18T12:00:00.000Z",
      evidence: ["secret transcript"],
      files: ["/repo/src/a.ts", "src/a.ts"],
    });
    insertSyntheticThread(database, {
      externalId: candidate,
      title: "Candidate",
      cwd: "/repo",
      updatedAt: "2026-06-18T13:00:00.000Z",
      evidence: [],
      files: ["src/b.ts"],
    });
    insertSyntheticThread(database, {
      externalId: ignored,
      title: "Ignored",
      cwd: "/repo",
      updatedAt: "2026-06-18T14:00:00.000Z",
      evidence: [],
      files: [],
    });
    const workstream = createWorkstream(database, "Canonical work");
    addWorkstreamAlias(database, workstream.id, "manual alias");
    assignThread(database, assigned, workstream.id);
    ignoreThread(database, ignored);

    const report = buildDailyReport(database, options);
    assert.equal(report.activeWorkstreams[0]?.id, workstream.id);
    assert.deepEqual(report.activeWorkstreams[0]?.relatedFiles, ["src/a.ts"]);
    assert.equal(
      report.activeWorkstreams[0]?.relatedRuns[0]?.resumeRef,
      assigned,
    );
    assert.deepEqual(
      report.unassignedRuns.map((run) => run.sourceId),
      [candidate],
    );
    assert.equal(report.omitted.ignoredRuns, 1);
    assert.equal(JSON.stringify(report).includes("secret transcript"), false);
    assert.equal(
      report.activeWorkstreams[0]?.relatedRuns[0]?.evidenceAvailable,
      true,
    );
  }));

test("merged assignments report under their canonical target", async () =>
  withDatabase((database) => {
    const id = syntheticId(10);
    insertSyntheticThread(database, {
      externalId: id,
      title: "Merged",
      cwd: "/repo",
      updatedAt: "2026-06-18T10:00:00.000Z",
      evidence: [],
      files: [],
    });
    const source = createWorkstream(database, "Duplicate");
    const target = createWorkstream(database, "Canonical");
    assignThread(database, id, source.id);
    mergeWorkstreams(database, source.id, target.id);
    assert.equal(
      buildDailyReport(database, options).activeWorkstreams[0]?.id,
      target.id,
    );
  }));

test("window is since-inclusive and until-exclusive", async () =>
  withDatabase((database) => {
    insertSyntheticThread(database, {
      externalId: syntheticId(20),
      title: "Since",
      cwd: "/repo",
      updatedAt: since,
      evidence: [],
      files: [],
    });
    insertSyntheticThread(database, {
      externalId: syntheticId(21),
      title: "Until",
      cwd: "/repo",
      updatedAt: until,
      evidence: [],
      files: [],
    });
    assert.deepEqual(
      buildDailyReport(database, options).unassignedRuns.map(
        (run) => run.title,
      ),
      ["Since"],
    );
  }));

test("ordering and structured output are deterministic", async () =>
  withDatabase((database) => {
    for (const [number, title] of [
      [31, "Zulu"],
      [30, "Alpha"],
    ] as const) {
      const id = syntheticId(number);
      insertSyntheticThread(database, {
        externalId: id,
        title,
        cwd: "/repo",
        updatedAt: "2026-06-18T12:00:00.000Z",
        evidence: [],
        files: [],
      });
      const workstream = createWorkstream(database, title);
      assignThread(database, id, workstream.id);
    }
    const first = buildDailyReport(database, options);
    const second = buildDailyReport(database, options);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.deepEqual(
      first.activeWorkstreams.map((item) => item.name),
      ["Alpha", "Zulu"],
    );
  }));

async function withDatabase(
  operation: (database: WorktrailDatabase) => void | Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-report-"));
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    await operation(database);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
}
