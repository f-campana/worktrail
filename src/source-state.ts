import { CodexLocalAdapter } from "./adapters/codex-local.js";
import type { WorktrailDatabase } from "./db/database.js";
import type {
  SourceThreadStateObservation,
  SourceThreadStateRequest,
} from "./types.js";

export type SourceStateProvider = (
  requests: readonly SourceThreadStateRequest[],
) => SourceThreadStateObservation[];

export type SourceStateCandidate = {
  sourceId: string;
  resumeRef: string;
  sourceTool?: string;
};

export function createCodexLocalSourceStateProvider(
  options: {
    codexHome?: string;
    clock?: () => Date;
  } = {},
): SourceStateProvider {
  const adapter = new CodexLocalAdapter({
    ...(options.codexHome ? { codexHome: options.codexHome } : {}),
  });
  return (requests) =>
    adapter.checkThreadStates(requests, {
      ...(options.clock ? { clock: options.clock } : {}),
    });
}

export function sourceStateRequestsForCandidates(
  database: WorktrailDatabase,
  candidates: readonly SourceStateCandidate[],
): SourceThreadStateRequest[] {
  if (candidates.length === 0) return [];
  const unique = new Map<string, SourceStateCandidate>();
  for (const candidate of candidates) {
    unique.set(`${candidate.sourceId}\0${candidate.resumeRef}`, candidate);
  }

  const sourceIds = [
    ...new Set([...unique.values()].map((item) => item.sourceId)),
  ];
  const resumeRefs = [
    ...new Set([...unique.values()].map((item) => item.resumeRef)),
  ];
  const clauses: string[] = [];
  const values: string[] = [];
  if (sourceIds.length > 0) {
    clauses.push(`t.external_id IN (${sourceIds.map(() => "?").join(",")})`);
    values.push(...sourceIds);
  }
  if (resumeRefs.length > 0) {
    clauses.push(`t.resume_ref IN (${resumeRefs.map(() => "?").join(",")})`);
    values.push(...resumeRefs);
  }

  const rows = database.raw
    .prepare(
      `SELECT t.external_id, t.resume_ref, t.source_tool, s.source_uri
       FROM source_threads t
       JOIN sources s ON s.id = t.source_id
       WHERE ${clauses.join(" OR ")}`,
    )
    .all(...values) as Array<{
    external_id: string;
    resume_ref: string;
    source_tool: string;
    source_uri: string;
  }>;
  const byExternalId = new Map(rows.map((row) => [row.external_id, row]));
  const byResumeRef = new Map(rows.map((row) => [row.resume_ref, row]));

  return [...unique.values()].map((candidate) => {
    const row =
      byExternalId.get(candidate.sourceId) ??
      byResumeRef.get(candidate.resumeRef);
    const sourceTool = candidate.sourceTool ?? row?.source_tool;
    return {
      sourceId: candidate.sourceId,
      resumeRef: candidate.resumeRef,
      ...(sourceTool ? { sourceTool } : {}),
      ...(row?.source_uri ? { sourceUri: row.source_uri } : {}),
    };
  });
}
