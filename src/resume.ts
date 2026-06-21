import type { WorktrailDatabase } from "./db/database.js";
import { queryTerms, searchThreads, type SearchResult } from "./search.js";

export const RESUME_SEARCH_SCHEMA_VERSION = 1 as const;
export const RESUME_SCORE_VERSION = 2 as const;

export type ResumeSignal = {
  type: string;
  label: string;
  weight?: number;
  sourceIds?: string[];
};

export type RelatedRun = {
  sourceId: string;
  title?: string;
  resumeRef?: string;
  lastActivity: string;
};

export type ResumableTarget = {
  kind: "canonical-workstream" | "candidate-workstream" | "run";
  title: string;
  subtitle?: string;
  resumeRef?: string;
  resumeCommand?: string;
  command?: { program: "codex"; args: string[] };
  lastActivity: string;
  sourceTool?: string;
  archived?: boolean;
  confidence: "high" | "medium" | "low";
  score: number;
  scoreVersion: typeof RESUME_SCORE_VERSION;
  signals: ResumeSignal[];
  relatedFiles: string[];
  relatedRuns: RelatedRun[];
  openActions: Array<{
    kind: "open-codex" | "copy-command" | "copy-id";
    label: string;
    value: string;
  }>;
  evidenceAvailable: boolean;
};

export type ResumeDiagnostic = {
  code: "unsafe-resume-ref";
  message: string;
  sourceId: string;
};

export type ResumeSearchResult = {
  schemaVersion: typeof RESUME_SEARCH_SCHEMA_VERSION;
  query: string;
  generatedAt: string;
  limit: number;
  targets: ResumableTarget[];
  diagnostics: ResumeDiagnostic[];
};

export type ResumeSearchOptions = {
  query: string;
  limit?: number;
  includeArchived?: boolean;
  clock?: () => Date;
};

type Assignment = { workstreamId: string; name: string; aliasMatch?: string };

/** Finds deterministic, evidence-excerpt-free targets from indexed local data. */
export function findResumableTargets(
  database: WorktrailDatabase,
  options: ResumeSearchOptions,
): ResumeSearchResult {
  const query = options.query.trim();
  if (queryTerms(query).length === 0)
    throw new Error("Resume requires a query.");
  const limit = Math.max(1, Math.min(options.limit ?? 5, 20));
  const diagnostics: ResumeDiagnostic[] = [];
  const matches = searchThreads(database, query, 20).filter(
    (match) => options.includeArchived || !match.archived,
  );
  const assignments = loadAssignments(database);
  const targets = new Map<string, ResumableTarget>();

  for (const match of matches) {
    const assignment = assignments.get(match.externalId);
    if (!assignment) {
      targets.set(
        `run:${match.externalId}`,
        runTarget(database, match, query, diagnostics),
      );
      continue;
    }
    const key = `workstream:${assignment.workstreamId}`;
    if (!targets.has(key)) {
      targets.set(
        key,
        workstreamTarget(database, assignment, query, options, diagnostics),
      );
    }
  }

  for (const assignment of matchingWorkstreams(database, query)) {
    const key = `workstream:${assignment.workstreamId}`;
    if (!targets.has(key)) {
      const target = workstreamTarget(
        database,
        assignment,
        query,
        options,
        diagnostics,
      );
      if (target.relatedRuns.length > 0) targets.set(key, target);
    }
  }

  return {
    schemaVersion: RESUME_SEARCH_SCHEMA_VERSION,
    query,
    generatedAt: (options.clock ?? (() => new Date()))().toISOString(),
    limit,
    targets: [...targets.values()]
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.lastActivity.localeCompare(left.lastActivity) ||
          left.title.localeCompare(right.title),
      )
      .slice(0, limit),
    diagnostics,
  };
}

function runTarget(
  database: WorktrailDatabase,
  match: SearchResult,
  query: string,
  diagnostics: ResumeDiagnostic[],
): ResumableTarget {
  const signals = matchSignals(match, query);
  signals.push({
    type: "unassigned-run",
    label: "Unassigned run",
    weight: 0,
    sourceIds: [match.externalId],
  });
  return targetBase(
    database,
    {
      kind: "run",
      title: match.title ?? match.externalId,
      score: match.score,
      confidence: match.confidence,
      match,
      signals,
      relatedRuns: [relatedRun(match)],
    },
    diagnostics,
  );
}

function workstreamTarget(
  database: WorktrailDatabase,
  assignment: Assignment,
  query: string,
  options: ResumeSearchOptions,
  diagnostics: ResumeDiagnostic[],
): ResumableTarget {
  const runs = loadWorkstreamRuns(database, assignment.workstreamId).filter(
    (run) => options.includeArchived || !run.archived,
  );
  const best = runs
    .map((run) => ({
      run,
      result: searchThreads(database, query, 20).find(
        (item) => item.externalId === run.externalId,
      ),
    }))
    .sort(
      (a, b) =>
        (b.result?.score ?? 0) - (a.result?.score ?? 0) ||
        b.run.updatedAt.localeCompare(a.run.updatedAt),
    )[0];
  if (!best) return emptyWorkstream(assignment);
  const assignmentNameTerms = new Set(queryTerms(assignment.name));
  const nameTerms = queryTerms(query).filter((term) =>
    assignmentNameTerms.has(term),
  );
  const terms = queryTerms(query);
  const nameCoverage = nameTerms.length / terms.length;
  const exactName =
    normalizedPhrase(assignment.name) === normalizedPhrase(query);
  const namePhrase =
    terms.length > 1 &&
    normalizedPhrase(assignment.name).includes(normalizedPhrase(query));
  const nameScore = assignment.aliasMatch
    ? 0.97
    : exactName
      ? 0.99
      : namePhrase
        ? 0.93
        : terms.length > 1 && nameCoverage === 1
          ? 0.88
          : nameCoverage > 0
            ? terms.length === 1
              ? 0.72
              : 0.6 + nameCoverage * 0.18
            : 0;
  const nameConfidence: ResumableTarget["confidence"] =
    assignment.aliasMatch ||
    exactName ||
    namePhrase ||
    (terms.length > 1 && nameCoverage === 1)
      ? "high"
      : nameCoverage > 0
        ? "medium"
        : "low";
  const match =
    best.result ?? toSearchResult(best.run, nameScore, nameConfidence);
  const sourceIds = runs.map((run) => run.externalId).sort();
  const signals: ResumeSignal[] = [];
  if (assignment.aliasMatch) {
    signals.push({
      type: "alias-match",
      label: `Alias matched “${assignment.aliasMatch}”`,
      weight: 0.35,
      sourceIds,
    });
  } else if (nameTerms.length > 0) {
    signals.push({
      type: exactName ? "exact-entity-match" : "entity-match",
      label: `${exactName ? "Exact workstream" : "Workstream"} matched “${query}”`,
      weight: exactName ? 0.35 : 0.25,
      sourceIds,
    });
  }
  signals.push({
    type: "manual-assignment",
    label: "Manually assigned to canonical workstream",
    weight: 0.1,
    sourceIds,
  });
  if (best.result) signals.push(...matchSignals(match, query));
  const score = Math.min(0.99, Math.max(match.score, nameScore) + 0.02);
  const confidence = strongerConfidence(match.confidence, nameConfidence);
  return targetBase(
    database,
    {
      kind: "canonical-workstream",
      title: assignment.name,
      subtitle: `${runs.length} assigned run${runs.length === 1 ? "" : "s"}`,
      score: Number(score.toFixed(3)),
      confidence,
      match,
      signals,
      relatedRuns: runs.map((run) => ({
        sourceId: run.externalId,
        ...(run.title ? { title: run.title } : {}),
        resumeRef: run.resumeRef,
        lastActivity: run.updatedAt,
      })),
      relatedFiles: [
        ...new Set(runs.flatMap((run) => run.fileReferences)),
      ].sort(),
    },
    diagnostics,
  );
}

function targetBase(
  database: WorktrailDatabase,
  input: {
    kind: ResumableTarget["kind"];
    title: string;
    subtitle?: string;
    score: number;
    confidence: ResumableTarget["confidence"];
    match: SearchResult;
    signals: ResumeSignal[];
    relatedRuns: RelatedRun[];
    relatedFiles?: string[];
  },
  diagnostics: ResumeDiagnostic[],
): ResumableTarget {
  const command = safeCommand(
    input.match.resumeRef,
    input.match.externalId,
    diagnostics,
  );
  const score = Number(input.score.toFixed(3));
  return {
    kind: input.kind,
    title: input.title,
    ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    resumeRef: input.match.resumeRef,
    ...(command
      ? { resumeCommand: command.text, command: command.structured }
      : {}),
    lastActivity: input.match.lastActivity,
    sourceTool: input.match.sourceTool,
    ...(input.match.archived ? { archived: true } : {}),
    confidence: input.confidence,
    score,
    scoreVersion: RESUME_SCORE_VERSION,
    signals: input.signals,
    relatedFiles: input.relatedFiles ?? input.match.fileReferences,
    relatedRuns: input.relatedRuns,
    openActions: command
      ? [
          {
            kind: "open-codex",
            label: "Open in Codex",
            value: `codex://threads/${input.match.resumeRef}`,
          },
          {
            kind: "copy-command",
            label: "Copy Codex resume command",
            value: command.text,
          },
        ]
      : [
          {
            kind: "copy-id",
            label: "Copy source ID",
            value: input.match.externalId,
          },
        ],
    evidenceAvailable:
      database.scalar(
        "SELECT count(*) FROM evidence e JOIN source_threads t ON t.id = e.thread_id WHERE t.external_id IN (" +
          input.relatedRuns.map(() => "?").join(",") +
          ")",
        ...input.relatedRuns.map((run) => run.sourceId),
      ) > 0,
  };
}

function matchSignals(match: SearchResult, query: string): ResumeSignal[] {
  const signals: ResumeSignal[] = [];
  const details = match.matchDetails;
  const sourceIds = [match.externalId];
  if (match.aliasMatch) {
    signals.push({
      type: "alias-match",
      label: `Alias matched “${match.aliasMatch}”`,
      weight: 0.35,
      sourceIds,
    });
  }
  if (details.exactTitle) {
    signals.push({
      type: "exact-title-match",
      label: `Exact title matched “${query}”`,
      weight: 0.4,
      sourceIds,
    });
  } else if (details.titlePrefix) {
    signals.push({
      type: "title-prefix-match",
      label: `Title prefix matched “${query}”`,
      weight: 0.35,
      sourceIds,
    });
  } else if (details.titlePhrase) {
    signals.push({
      type: "title-phrase-match",
      label: `Title phrase matched “${query}”`,
      weight: 0.35,
      sourceIds,
    });
  } else if (details.titleTerms.length > 0) {
    signals.push({
      type: "title-token-match",
      label: `Title matched ${quotedTerms(details.titleTerms)}`,
      weight: 0.25,
      sourceIds,
    });
  }
  if (details.projectExact || details.projectTerms.length > 0) {
    signals.push({
      type: details.projectExact ? "exact-project-match" : "project-path-match",
      label: `Project path matched ${quotedTerms(
        details.projectExact ? queryTerms(query) : details.projectTerms,
      )}`,
      weight: details.projectExact ? 0.35 : 0.22,
      sourceIds,
    });
  }
  if (details.meaningfulFileTerms.length > 0) {
    signals.push({
      type: "meaningful-path-match",
      label: `Related path matched ${quotedTerms(details.meaningfulFileTerms)}`,
      weight: 0.18,
      sourceIds,
    });
  }
  if (details.genericFileTerms.length > 0) {
    signals.push({
      type: "generic-file-match",
      label: `Generic file match for ${quotedTerms(details.genericFileTerms)} (downweighted)`,
      weight: 0.05,
      sourceIds,
    });
  }
  const contextualTerms = new Set([
    ...details.titleTerms,
    ...details.projectTerms,
    ...details.meaningfulFileTerms,
    ...details.genericFileTerms,
  ]);
  const contentOnlyTerms = details.contentTerms.filter(
    (term) => !contextualTerms.has(term),
  );
  if (contentOnlyTerms.length > 0) {
    signals.push({
      type: "content-only-match",
      label: `${queryTerms(query).length === 1 ? "Weak " : ""}content-only match for ${quotedTerms(contentOnlyTerms)}`,
      weight: queryTerms(query).length === 1 ? 0.05 : 0.1,
      sourceIds,
    });
  }
  signals.push({
    type: "recent-activity",
    label: "Recent activity used as a tie-breaker",
    weight: 0,
    sourceIds: [match.externalId],
  });
  if (match.archived) {
    signals.push({
      type: "archived-penalty",
      label: "Archived result ranked lower",
      weight: -0.1,
      sourceIds,
    });
  }
  return signals;
}

function safeCommand(
  ref: string,
  sourceId: string,
  diagnostics: ResumeDiagnostic[],
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      ref,
    )
  ) {
    diagnostics.push({
      code: "unsafe-resume-ref",
      message:
        "Resume command omitted because the source reference is not a UUID.",
      sourceId,
    });
    return undefined;
  }
  return {
    text: `codex resume ${ref}`,
    structured: { program: "codex" as const, args: ["resume", ref] },
  };
}

function loadAssignments(database: WorktrailDatabase): Map<string, Assignment> {
  const rows = database.raw
    .prepare(
      `SELECT t.external_id, w.public_id, w.name FROM workstream_assignments a JOIN source_threads t ON t.id = a.thread_id JOIN workstreams w ON w.id = a.workstream_id AND w.status = 'active'`,
    )
    .all() as Array<{ external_id: string; public_id: string; name: string }>;
  return new Map(
    rows.map((row) => [
      row.external_id,
      { workstreamId: row.public_id, name: row.name },
    ]),
  );
}

function matchingWorkstreams(
  database: WorktrailDatabase,
  query: string,
): Assignment[] {
  const terms = queryTerms(query);
  return (
    database.raw
      .prepare(
        `SELECT DISTINCT w.public_id, w.name, group_concat(a.alias, char(10)) AS aliases FROM workstreams w LEFT JOIN workstream_aliases a ON a.workstream_id = w.id WHERE w.status = 'active' GROUP BY w.id`,
      )
      .all() as Array<{
      public_id: string;
      name: string;
      aliases: string | null;
    }>
  )
    .map((row) => {
      const aliasMatch = (row.aliases?.split("\n") ?? []).find((alias) =>
        aliasMatchesQuery(alias, query),
      );
      const nameTerms = new Set(queryTerms(row.name));
      const nameMatched = terms.some((term) => nameTerms.has(term));
      if (!nameMatched && !aliasMatch) return undefined;
      return {
        workstreamId: row.public_id,
        name: row.name,
        ...(aliasMatch ? { aliasMatch } : {}),
      };
    })
    .filter((assignment): assignment is Assignment => assignment !== undefined);
}

type RunRow = {
  externalId: string;
  resumeRef: string;
  title?: string;
  sourceTool: string;
  archived: boolean;
  updatedAt: string;
  fileReferences: string[];
};
function loadWorkstreamRuns(database: WorktrailDatabase, id: string): RunRow[] {
  const rows = database.raw
    .prepare(
      `SELECT t.id, t.external_id, t.resume_ref, t.title, t.source_tool, t.archived, t.updated_at FROM workstream_assignments a JOIN workstreams w ON w.id = a.workstream_id JOIN source_threads t ON t.id = a.thread_id LEFT JOIN ignored_threads i ON i.thread_id = t.id WHERE w.public_id = ? AND i.thread_id IS NULL ORDER BY t.updated_at DESC, t.external_id`,
    )
    .all(id) as Array<{
    id: number;
    external_id: string;
    resume_ref: string;
    title: string | null;
    source_tool: string;
    archived: number;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    externalId: row.external_id,
    resumeRef: row.resume_ref,
    ...(row.title ? { title: row.title } : {}),
    sourceTool: row.source_tool,
    archived: Boolean(row.archived),
    updatedAt: row.updated_at,
    fileReferences: (
      database.raw
        .prepare(
          "SELECT path FROM file_references WHERE thread_id = ? ORDER BY path",
        )
        .all(row.id) as Array<{ path: string }>
    ).map((item) => item.path),
  }));
}
function toSearchResult(
  run: RunRow,
  score: number,
  confidence: SearchResult["confidence"],
): SearchResult {
  return {
    externalId: run.externalId,
    resumeRef: run.resumeRef,
    ...(run.title ? { title: run.title } : {}),
    sourceTool: run.sourceTool,
    archived: run.archived,
    lastActivity: run.updatedAt,
    score,
    confidence,
    evidence: [],
    fileReferences: run.fileReferences,
    matchDetails: {
      exactTitle: false,
      titlePhrase: false,
      titlePrefix: false,
      titleTerms: [],
      projectExact: false,
      projectTerms: [],
      meaningfulFileTerms: [],
      genericFileTerms: [],
      contentTerms: [],
      matchedTerms: [],
    },
  };
}
function relatedRun(match: SearchResult): RelatedRun {
  return {
    sourceId: match.externalId,
    ...(match.title ? { title: match.title } : {}),
    resumeRef: match.resumeRef,
    lastActivity: match.lastActivity,
  };
}
function emptyWorkstream(assignment: Assignment): ResumableTarget {
  return {
    kind: "canonical-workstream",
    title: assignment.name,
    lastActivity: "",
    confidence: "low",
    score: 0,
    scoreVersion: RESUME_SCORE_VERSION,
    signals: [],
    relatedFiles: [],
    relatedRuns: [],
    openActions: [],
    evidenceAvailable: false,
  };
}

function normalizedPhrase(value: string): string {
  return queryTerms(value).join(" ");
}

function quotedTerms(terms: string[]): string {
  return `“${terms.join(" ")}”`;
}

function strongerConfidence(
  left: ResumableTarget["confidence"],
  right: ResumableTarget["confidence"],
): ResumableTarget["confidence"] {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[left] >= rank[right] ? left : right;
}

function aliasMatchesQuery(alias: string, query: string): boolean {
  if (normalizedPhrase(alias) === normalizedPhrase(query)) return true;
  const querySet = new Set(queryTerms(query));
  const aliasTerms = queryTerms(alias);
  return (
    aliasTerms.length > 0 && aliasTerms.every((term) => querySet.has(term))
  );
}
