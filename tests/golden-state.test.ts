import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WorktrailDatabase } from "../src/db/database.js";
import { evaluateQueries } from "../src/eval.js";
import { normalizeRelatedFiles } from "../src/files.js";
import { searchThreads } from "../src/search.js";
import { buildStateResponse } from "../src/state.js";
import {
  addWorkstreamAlias,
  assignThread,
  createWorkstream,
  ignoreThread,
  listWorkstreamAliases,
  listWorkstreams,
  mergeWorkstreams,
} from "../src/workstreams.js";
import {
  insertSyntheticThread,
  syntheticId,
} from "./helpers/synthetic-corpus.js";

test("file display normalization safely collapses cwd-absolute and relative duplicates", () => {
  assert.deepEqual(
    normalizeRelatedFiles(
      [
        "~/synthetic/atlas/src/gui/apply.ts",
        "./src/gui/apply.ts",
        "src/gui/apply.ts",
        "~/other/repo/src/gui/apply.ts",
      ],
      ["~/synthetic/atlas"],
    ).sort(),
    ["src/gui/apply.ts", "~/other/repo/src/gui/apply.ts"].sort(),
  );
});

test("golden ambiguous query resolves through alias and excludes ignored lexical winner", async () => {
  await withGoldenCorpus((database, corpus) => {
    const search = searchThreads(database, "resume safe apply desktop", 10);
    assert.ok(search.length > 0);
    assert.equal(search[0]?.aliasMatch, "safe apply desktop");
    assert.equal(
      search.some((result) => result.externalId === corpus.ignored),
      false,
    );

    const state = buildStateResponse(database, "resume safe apply desktop");
    assert.equal(state.best?.workstream.id, corpus.targetWorkstreamId);
    assert.equal(state.best?.bestThread.externalId, corpus.desktopPrimary);
    assert.ok(
      state.best?.signals.some((signal) => signal.type === "alias-match"),
    );
    assert.ok(
      state.best?.signals.some((signal) => signal.type === "manual-assignment"),
    );
    assert.ok(
      state.best?.signals.some(
        (signal) => signal.type === "ignored-thread-exclusion",
      ),
    );
    assert.deepEqual(
      state.best?.relatedFiles.filter((path) =>
        path.endsWith("src/gui/apply.ts"),
      ),
      ["src/gui/apply.ts"],
    );
  });
});

test("merge redirects to canonical target and preserves assignments, aliases, and corrections", async () => {
  await withGoldenCorpus((database, corpus) => {
    const workstreams = listWorkstreams(database);
    const merged = workstreams.find(
      (item) => item.id === corpus.sourceWorkstreamId,
    );
    assert.equal(merged?.status, "merged");
    assert.equal(merged?.mergedIntoId, corpus.targetWorkstreamId);

    const aliases = listWorkstreamAliases(
      database,
      corpus.targetWorkstreamId,
    ).map((item) => item.alias);
    assert.ok(aliases.includes("guarded apply"));
    assert.ok(aliases.includes("Atlas Legacy Apply"));
    assert.equal(
      database.scalar(
        `SELECT count(*)
         FROM workstream_assignments a
         JOIN workstreams w ON w.id = a.workstream_id
         WHERE w.public_id = ?`,
        corpus.targetWorkstreamId,
      ),
      3,
    );
    assert.ok(
      database.scalar(
        `SELECT count(*)
         FROM manual_corrections c
         JOIN workstreams w ON w.id = c.workstream_id
         WHERE w.public_id = ?`,
        corpus.sourceWorkstreamId,
      ) >= 2,
    );

    const state = buildStateResponse(database, "guarded apply");
    assert.equal(state.best?.workstream.id, corpus.targetWorkstreamId);
    assert.equal(state.best?.relatedThreads.length, 3);
    assert.ok(
      state.best?.signals.some((signal) => signal.type === "alias-match"),
    );
  });
});

test("golden state JSON includes stable structured signal fields", async () => {
  await withGoldenCorpus((database) => {
    const best = buildStateResponse(database, "safe apply desktop").best;
    assert.ok(best);
    assert.ok(best.signals.length > 0);
    for (const signal of best.signals) {
      assert.deepEqual(Object.keys(signal).sort(), [
        "detail",
        "type",
        "weight",
      ]);
      assert.equal(typeof signal.type, "string");
      assert.equal(typeof signal.weight, "number");
      assert.equal(typeof signal.detail, "string");
    }
  });
});

test("eval metadata output omits transcript evidence unless explicitly requested", async () => {
  await withGoldenCorpus((database) => {
    const withoutEvidence = evaluateQueries(database, ["safe apply desktop"]);
    assert.equal(Object.hasOwn(withoutEvidence[0] ?? {}, "evidence"), false);
    assert.doesNotMatch(
      JSON.stringify(withoutEvidence),
      /Implemented safe apply/,
    );

    const withEvidence = evaluateQueries(database, ["safe apply desktop"], {
      withEvidence: true,
    });
    assert.ok((withEvidence[0]?.evidence?.length ?? 0) > 0);
    assert.match(JSON.stringify(withEvidence), /safe apply/i);
  });
});

type GoldenCorpus = {
  targetWorkstreamId: string;
  sourceWorkstreamId: string;
  desktopPrimary: string;
  ignored: string;
};

async function withGoldenCorpus(
  operation: (
    database: WorktrailDatabase,
    corpus: GoldenCorpus,
  ) => void | Promise<void>,
): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "worktrail-golden-"));
  const database = new WorktrailDatabase(join(temporary, "worktrail.db"));
  try {
    const desktopPrimary = syntheticId(101);
    const desktopTests = syntheticId(102);
    const apiThread = syntheticId(103);
    const ignored = syntheticId(104);
    const staleLegacy = syntheticId(105);

    insertSyntheticThread(database, {
      externalId: desktopPrimary,
      title: "Safe Apply Desktop GUI",
      cwd: "~/synthetic/atlas",
      updatedAt: "2026-06-18T12:00:00.000Z",
      evidence: ["Implemented safe apply validation in the desktop flow."],
      files: [
        "~/synthetic/atlas/src/gui/apply.ts",
        "src/gui/apply.ts",
        "src/gui/window.ts",
      ],
    });
    insertSyntheticThread(database, {
      externalId: desktopTests,
      title: "Safe Apply Desktop Tests",
      cwd: "~/synthetic/atlas",
      updatedAt: "2026-06-17T12:00:00.000Z",
      evidence: ["Added confirmation tests for the desktop apply flow."],
      files: ["src/gui/apply.ts", "tests/gui/apply.test.ts"],
    });
    insertSyntheticThread(database, {
      externalId: apiThread,
      title: "Safe Apply Service API",
      cwd: "~/synthetic/service",
      updatedAt: "2026-06-19T08:00:00.000Z",
      evidence: ["Implemented safe apply validation for the service endpoint."],
      files: ["src/api/apply.ts", "src/gui/apply.ts"],
    });
    insertSyntheticThread(database, {
      externalId: ignored,
      title: "Safe Apply Desktop GUI Critical",
      cwd: "~/synthetic/atlas",
      updatedAt: "2026-06-19T09:00:00.000Z",
      evidence: ["Safe apply desktop GUI exact lexical winner."],
      files: ["src/gui/apply.ts"],
    });
    insertSyntheticThread(database, {
      externalId: staleLegacy,
      title: "Guarded Apply Legacy Desktop",
      cwd: "~/synthetic/atlas",
      updatedAt: "2025-01-01T00:00:00.000Z",
      evidence: ["Historical guarded apply desktop implementation."],
      files: ["src/gui/legacy-apply.ts"],
      archived: true,
    });

    const target = createWorkstream(database, "Atlas Desktop Delivery");
    addWorkstreamAlias(database, target.id, "safe apply desktop");
    assignThread(database, desktopPrimary, target.id);
    assignThread(database, desktopTests, target.id);

    const source = createWorkstream(database, "Atlas Legacy Apply");
    addWorkstreamAlias(database, source.id, "guarded apply");
    assignThread(database, staleLegacy, source.id);

    const api = createWorkstream(database, "Atlas Apply API");
    assignThread(database, apiThread, api.id);
    ignoreThread(database, ignored, "synthetic ignored lexical winner");
    mergeWorkstreams(database, source.id, target.id);

    await operation(database, {
      targetWorkstreamId: target.id,
      sourceWorkstreamId: source.id,
      desktopPrimary,
      ignored,
    });
  } finally {
    database.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
