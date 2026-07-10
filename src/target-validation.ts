import type { WorktrailDatabase } from "./db/database.js";
import {
  createCodexLocalSourceStateProvider,
  sourceStateRequestsForCandidates,
  type SourceStateProvider,
} from "./source-state.js";

export const TARGET_VALIDATION_SCHEMA_VERSION = 1 as const;

export type TargetValidationStatus =
  | "openable"
  | "archived"
  | "missing"
  | "unknown"
  | "invalid";

export type TargetValidationResult = {
  schemaVersion: typeof TARGET_VALIDATION_SCHEMA_VERSION;
  resumeRef: string;
  status: TargetValidationStatus;
  openUrl?: string;
  message?: string;
};

const SAFE_CODEX_THREAD_REF =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSafeCodexThreadRef(resumeRef: string): boolean {
  return SAFE_CODEX_THREAD_REF.test(resumeRef);
}

export function validateResumeTarget(
  database: WorktrailDatabase,
  resumeRef: string,
  options: { sourceStateProvider?: SourceStateProvider } = {},
): TargetValidationResult {
  if (!isSafeCodexThreadRef(resumeRef)) {
    return {
      schemaVersion: TARGET_VALIDATION_SCHEMA_VERSION,
      resumeRef,
      status: "invalid",
      message: "This target does not have a safe Codex thread UUID.",
    };
  }

  const row = database.raw
    .prepare(
      `SELECT external_id, resume_ref, source_tool
       FROM source_threads
       WHERE resume_ref = ? OR external_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(resumeRef, resumeRef) as
    | { external_id: string; resume_ref: string; source_tool: string }
    | undefined;

  if (!row) {
    return {
      schemaVersion: TARGET_VALIDATION_SCHEMA_VERSION,
      resumeRef,
      status: "missing",
      message:
        "This Codex thread is not available in the local Worktrail index.",
    };
  }

  const provider =
    options.sourceStateProvider ?? createCodexLocalSourceStateProvider();
  const [request] = sourceStateRequestsForCandidates(database, [
    {
      sourceId: row.external_id,
      resumeRef: row.resume_ref,
      sourceTool: row.source_tool,
    },
  ]);
  const [observation] = provider(request ? [request] : []);
  const state = observation?.state ?? "unknown";

  if (state === "active") {
    return {
      schemaVersion: TARGET_VALIDATION_SCHEMA_VERSION,
      resumeRef: row.resume_ref,
      status: "openable",
      openUrl: `codex://threads/${row.resume_ref}`,
    };
  }

  if (state === "archived") {
    return {
      schemaVersion: TARGET_VALIDATION_SCHEMA_VERSION,
      resumeRef: row.resume_ref,
      status: "archived",
      message:
        "This Codex thread is archived. Refresh results or enable archived results.",
    };
  }

  if (state === "missing") {
    return {
      schemaVersion: TARGET_VALIDATION_SCHEMA_VERSION,
      resumeRef: row.resume_ref,
      status: "missing",
      message: "This Codex thread is no longer available. Refresh results.",
    };
  }

  return {
    schemaVersion: TARGET_VALIDATION_SCHEMA_VERSION,
    resumeRef: row.resume_ref,
    status: "unknown",
    message:
      "Worktrail could not verify the current Codex thread state. Refresh results before opening.",
  };
}
