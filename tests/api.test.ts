import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiResponse, mutationResponse } from "../src/api.js";
import { WorktrailDatabase } from "../src/db/database.js";
import {
  insertSyntheticThread,
  syntheticId,
} from "./helpers/synthetic-corpus.js";
import {
  assignThread,
  createWorkstream,
  addWorkstreamAlias,
} from "../src/workstreams.js";

function fixture(run: (db: WorktrailDatabase, path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-api-"));
  const path = join(dir, "test.db");
  const db = new WorktrailDatabase(path);
  try {
    insertSyntheticThread(db, {
      externalId: syntheticId(1),
      title: "Widget repair",
      cwd: "/repo",
      updatedAt: "2026-01-01T00:00:00Z",
      evidence: ["Repaired the widget safely"],
      files: ["/repo/src/widget.ts"],
    });
    run(db, path);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
test("state API is stable and evidence is opt-in", () =>
  fixture((db, path) => {
    const hidden = apiResponse(
      db,
      path,
      new URL("http://x/api/state?q=widget"),
    );
    assert.equal(hidden.status, 200);
    const body = hidden.body as any;
    assert.equal(body.version, 1);
    assert.equal(body.best.workstream.name, "Widget repair");
    assert.deepEqual(body.best.latestEvidence, []);
    const shown = apiResponse(
      db,
      path,
      new URL("http://x/api/state?q=widget&evidence=1"),
    ).body as any;
    assert.equal(shown.best.latestEvidence.length, 1);
  }));
test("status API returns counts without transcript content", () =>
  fixture((db, path) => {
    const response = apiResponse(db, path, new URL("http://x/api/status"));
    assert.equal(response.status, 200);
    const json = JSON.stringify(response.body);
    assert.match(json, /"threads":1/);
    assert.doesNotMatch(json, /Repaired the widget safely/);
    assert.doesNotMatch(json, /excerpt|searchable_text/);
    assert.equal((response.body as any).writesEnabled, false);
  }));

test("status exposes enabled write mode without a token or transcript", () =>
  fixture((db, path) => {
    const json = JSON.stringify(
      apiResponse(db, path, new URL("http://x/api/status"), true).body,
    );
    assert.match(json, /"writesEnabled":true/);
    assert.doesNotMatch(json, /token|Repaired the widget safely/);
  }));

test("mutations require write mode and a valid token", () =>
  fixture((db) => {
    const url = new URL("http://x/api/workstreams");
    assert.equal(
      mutationResponse(db, "POST", url, { name: "API work" }, false, false)
        .status,
      403,
    );
    assert.equal(
      mutationResponse(db, "POST", url, { name: "API work" }, true, false)
        .status,
      403,
    );
  }));

test("correction API creates, renames, aliases, assigns, and ignores", () =>
  fixture((db) => {
    const mutate = (method: string, path: string, body: unknown = {}) =>
      mutationResponse(
        db,
        method,
        new URL(`http://x${path}`),
        body,
        true,
        true,
      );
    const created = mutate("POST", "/api/workstreams", { name: "API work" });
    assert.equal(created.status, 201);
    const id = (created.body as any).workstream.id;
    assert.equal(
      mutate("PATCH", `/api/workstreams/${id}`, { name: "Renamed API work" })
        .status,
      200,
    );
    assert.equal(
      mutate("POST", `/api/workstreams/${id}/aliases`, { alias: "api alias" })
        .status,
      201,
    );
    assert.equal(
      mutate("POST", `/api/workstreams/${id}/aliases`, { alias: "api alias" })
        .status,
      201,
    );
    assert.equal(
      mutate("DELETE", `/api/workstreams/${id}/aliases/api%20alias`).status,
      200,
    );
    assert.equal(
      mutate("POST", `/api/threads/${syntheticId(1)}/assignment`, {
        workstreamId: id,
      }).status,
      200,
    );
    assert.deepEqual(
      mutate("DELETE", `/api/threads/${syntheticId(1)}/assignment`).body as any,
      { removed: true },
    );
    assert.equal(
      mutate("POST", `/api/threads/${syntheticId(1)}/ignore`, {
        reason: "manual",
      }).status,
      200,
    );
    assert.deepEqual(
      mutate("DELETE", `/api/threads/${syntheticId(1)}/ignore`).body as any,
      { ignored: false },
    );
  }));

test("correction API returns stable invalid, conflict, and missing errors", () =>
  fixture((db) => {
    const mutate = (method: string, path: string, body: unknown = {}) =>
      mutationResponse(
        db,
        method,
        new URL(`http://x${path}`),
        body,
        true,
        true,
      );
    assert.equal(mutate("POST", "/api/workstreams", { name: "" }).status, 400);
    assert.equal(mutate("POST", "/api/workstreams", []).status, 400);
    assert.equal(mutate("POST", `/api/threads/missing/ignore`).status, 404);
    mutate("POST", "/api/workstreams", { name: "Duplicate" });
    const duplicate = mutate("POST", "/api/workstreams", { name: "duplicate" });
    assert.equal(duplicate.status, 409);
    assert.equal((duplicate.body as any).error.code, "conflict");
  }));
test("workstream detail is fixture-backed and evidence is opt-in", () =>
  fixture((db, path) => {
    const ws = createWorkstream(db, "Widget work");
    addWorkstreamAlias(db, ws.id, "widget repair");
    assignThread(db, syntheticId(1), ws.id);
    const hidden = apiResponse(
      db,
      path,
      new URL(`http://x/api/workstreams/${ws.id}`),
    );
    assert.equal(hidden.status, 200);
    const body = hidden.body as any;
    assert.deepEqual(body.workstream.aliases, ["widget repair"]);
    assert.equal(body.card.relatedThreads[0].externalId, syntheticId(1));
    assert.deepEqual(body.card.latestEvidence, []);
    const shown = apiResponse(
      db,
      path,
      new URL(`http://x/api/workstreams/${ws.id}?evidence=1`),
    ).body as any;
    assert.equal(shown.card.latestEvidence.length, 1);
  }));
