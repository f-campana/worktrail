import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorktrailInvocation,
  sanitizeErrorMessage,
} from "../src/client.js";
import {
  parseResumeSearchResult,
  ResumeCompatibilityError,
} from "../src/contract.js";
import { deriveTargetDisplay, selectCopyCommand } from "../src/display.js";
import type { ResumableTarget } from "../src/types.js";

const target: ResumableTarget = {
  kind: "run",
  title: "Fast Resume",
  resumeRef: "0197f0de-1111-7000-8000-000000000001",
  resumeCommand: "codex resume 0197f0de-1111-7000-8000-000000000001",
  command: {
    program: "codex",
    args: ["resume", "0197f0de-1111-7000-8000-000000000001"],
  },
  lastActivity: "2026-06-20T10:00:00.000Z",
  sourceTool: "codex",
  confidence: "high",
  score: 0.95,
  scoreVersion: 1,
  signals: [{ type: "title-match", label: "Title matched fast" }],
  relatedFiles: ["src/resume.ts"],
  relatedRuns: [
    {
      sourceId: "source-1",
      title: "Fast Resume",
      resumeRef: "0197f0de-1111-7000-8000-000000000001",
      lastActivity: "2026-06-20T10:00:00.000Z",
    },
  ],
  openActions: [
    {
      kind: "copy-command",
      label: "Copy Codex resume command",
      value: "codex resume 0197f0de-1111-7000-8000-000000000001",
    },
  ],
  evidenceAvailable: true,
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    query: "fast resume",
    generatedAt: "2026-06-20T10:01:00.000Z",
    limit: 5,
    targets: [target],
    diagnostics: [],
    ...overrides,
  };
}

test("parses a valid ResumeSearchResult v1", () => {
  assert.deepEqual(parseResumeSearchResult(response()), response());
});

test("rejects an unsupported schema version", () => {
  assert.throws(
    () => parseResumeSearchResult(response({ schemaVersion: 2 })),
    ResumeCompatibilityError,
  );
});

test("rejects an invalid target instead of guessing", () => {
  assert.throws(
    () =>
      parseResumeSearchResult(
        response({ targets: [{ ...target, confidence: "certain" }] }),
      ),
    /targets\[0\]\.confidence/,
  );
});

test("derives compact display metadata", () => {
  const display = deriveTargetDisplay(target);
  assert.equal(display.kind, "Run");
  assert.equal(display.confidence, "High confidence");
  assert.match(display.subtitle, /^High confidence · Run · /);
  assert.deepEqual(display.relatedFiles, ["src/resume.ts"]);
  assert.equal(display.resumable, true);
});

test("selects a declared copy-command action", () => {
  assert.equal(selectCopyCommand(target), target.openActions[0]);
  assert.equal(
    selectCopyCommand({
      ...target,
      resumeCommand: undefined,
      openActions: [{ kind: "copy-id", label: "Copy ID", value: "source-1" }],
    }),
    undefined,
  );
});

test("builds an argument-safe pnpm invocation", () => {
  const invocation = buildWorktrailInvocation("safe apply; echo nope", {
    worktrailProjectPath: "/tmp/worktrail project",
    databasePath: "/tmp/worktrail.db",
    resultLimit: "5",
    includeArchived: true,
  });
  assert.equal(invocation.program, "pnpm");
  assert.deepEqual(invocation.args, [
    "--silent",
    "--dir",
    "/tmp/worktrail project",
    "worktrail",
    "resume",
    "safe apply; echo nope",
    "--json",
    "--limit",
    "5",
    "--db",
    "/tmp/worktrail.db",
    "--include-archived",
  ]);
});

test("sanitizes CLI errors without exposing paths or URL credentials", () => {
  const error = Object.assign(new Error("command failed"), {
    stderr:
      "worktrail: unable to read /Users/private/Documents/worktrail at https://user:secret@example.com/repo\nstack omitted",
  });
  const message = sanitizeErrorMessage(error, [
    "/Users/private/Documents/worktrail",
  ]);
  assert.equal(
    message,
    "unable to read ~ at https://[credentials]@example.com/repo",
  );
});
