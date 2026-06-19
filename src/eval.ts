import { WorktrailDatabase } from "./db/database.js";
import { buildStateResponse, type StateEvidence } from "./state.js";

export type EvalEntry = {
  query: string;
  found: boolean;
  workstreamId: string | null;
  workstreamName: string | null;
  workstreamOrigin: "manual" | "candidate" | null;
  bestThreadId: string | null;
  bestThreadTitle: string | null;
  resumeRef: string | null;
  score: number | null;
  confidence: "high" | "medium" | "low" | null;
  signals: string[];
  latestActivity: string | null;
  evidence?: StateEvidence[];
};

export function parseEvalQueries(input: unknown): string[] {
  const values = Array.isArray(input)
    ? input
    : isObject(input) && Array.isArray(input.queries)
      ? input.queries
      : [];
  const queries = values
    .map((value) =>
      typeof value === "string"
        ? value
        : isObject(value) && typeof value.query === "string"
          ? value.query
          : "",
    )
    .map((query) => query.trim())
    .filter(Boolean);
  if (queries.length === 0) {
    throw new Error("Eval file must contain a non-empty query array.");
  }
  return queries;
}

export function evaluateQueries(
  database: WorktrailDatabase,
  queries: readonly string[],
  options: { withEvidence?: boolean } = {},
): EvalEntry[] {
  return queries.map((query) => {
    const state = buildStateResponse(database, query);
    const best = state.best;
    if (!best) {
      return {
        query,
        found: false,
        workstreamId: null,
        workstreamName: null,
        workstreamOrigin: null,
        bestThreadId: null,
        bestThreadTitle: null,
        resumeRef: null,
        score: null,
        confidence: null,
        signals: [],
        latestActivity: null,
        ...(options.withEvidence ? { evidence: [] } : {}),
      };
    }
    return {
      query,
      found: true,
      workstreamId: best.workstream.id,
      workstreamName: best.workstream.name,
      workstreamOrigin: best.workstream.origin,
      bestThreadId: best.bestThread.externalId,
      bestThreadTitle: best.bestThread.title,
      resumeRef: best.bestThread.resumeRef,
      score: best.score,
      confidence: best.confidence,
      signals: best.signals.map((signal) => signal.type),
      latestActivity: best.latestActivity,
      ...(options.withEvidence ? { evidence: best.latestEvidence } : {}),
    };
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
