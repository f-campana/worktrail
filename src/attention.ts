import type { WorktrailDatabase } from "./db/database.js";
import {
  buildDailyReport,
  type DailyReport,
  type DailyReportRun,
} from "./report.js";

export const ATTENTION_DIGEST_SCHEMA_VERSION = 1 as const;

export type AttentionKind =
  | "dirty-repository-after-recent-activity"
  | "archived-or-missing-resume-target"
  | "stale-source"
  | "source-unavailable"
  | "index-diagnostics"
  | "unknown-state";

export type SourceRef = {
  sourceTool: string;
  sourceId?: string;
  observation: string;
  observedAt?: string;
};

export type EvidenceRef = {
  kind: "activity" | "git" | "source-state" | "index-diagnostic";
  ref: string;
  occurredAt?: string;
};

export type DeclaredAction = {
  kind: "open-codex" | "copy-command" | "copy-id" | "copy-title" | "open-path";
  label: string;
  value: string;
  target?: { sourceTool: string; resumeRef?: string };
  validation:
    | "validated-at-generation"
    | "validate-before-open"
    | "not-required";
};

export type AttentionItem = {
  id: string;
  ruleId: string;
  kind: AttentionKind;
  subject: {
    kind: "workstream" | "project" | "run" | "repository" | "source";
    id: string;
    title: string;
  };
  title: string;
  reason: string;
  priority: "high" | "medium" | "low" | "info";
  confidence: "high" | "medium" | "low";
  freshness: "fresh" | "stale" | "unknown";
  changedAt?: string;
  sourceRefs: SourceRef[];
  evidenceRefs: EvidenceRef[];
  actions: DeclaredAction[];
  limitations: string[];
};

export type ChangedWorkGroup = {
  group: {
    kind: "canonical-workstream" | "project-context" | "unassigned";
    id: string;
    title: string;
    provisional: boolean;
  };
  latestActivity: string;
  runs: DailyReportRun[];
  relatedFiles: string[];
  repositories: string[];
  actions: DeclaredAction[];
  limitations: string[];
};

export type SourceHealthItem = {
  source: "codex-local" | "git-local" | "worktrail-index" | "worktrail-schema";
  status: "healthy" | "degraded" | "unavailable" | "unknown";
  observedAt: string;
  freshness: "fresh" | "stale" | "unknown";
  summary: string;
  diagnostics: Array<{ code: string; message: string; count?: number }>;
  actions: DeclaredAction[];
};

export type AttentionDigestResult = {
  schemaVersion: typeof ATTENTION_DIGEST_SCHEMA_VERSION;
  generatedAt: string;
  window: DailyReport["window"];
  summary: {
    attentionCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
    changedWorkCount: number;
    sourceHealth: "healthy" | "degraded" | "unknown";
  };
  attentionItems: AttentionItem[];
  changedWork: ChangedWorkGroup[];
  sourceHealth: SourceHealthItem[];
  omitted: {
    ignoredRuns: number;
    archivedTargets: number;
    missingTargets: number;
    unavailableSourceObservations: number;
  };
  limitations: string[];
};

export type BuildAttentionDigestOptions = {
  since: Date;
  until: Date;
  timezone: string;
  clock?: () => Date;
};

const PHASE_ONE_LIMITATION =
  "Phase 1 only; attention rules, source health, and source-state checks are not evaluated.";

/** Builds the Phase 1 digest by composing exactly one DailyReport result. */
export function buildAttentionDigest(
  database: WorktrailDatabase,
  options: BuildAttentionDigestOptions,
): AttentionDigestResult {
  const report = buildDailyReport(database, options);
  return buildAttentionDigestFromReport(database, report);
}

/** Maps an already composed report into the Phase 1 digest contract. */
export function buildAttentionDigestFromReport(
  database: WorktrailDatabase,
  report: DailyReport,
): AttentionDigestResult {
  const changedWork = buildChangedWork(database, report);
  return {
    schemaVersion: ATTENTION_DIGEST_SCHEMA_VERSION,
    generatedAt: report.generatedAt,
    window: report.window,
    summary: {
      attentionCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      changedWorkCount: changedWork.length,
      sourceHealth: "unknown",
    },
    attentionItems: [],
    changedWork,
    sourceHealth: [],
    omitted: {
      ignoredRuns: report.omitted.ignoredRuns,
      archivedTargets: 0,
      missingTargets: 0,
      unavailableSourceObservations: 0,
    },
    limitations: [...new Set([...report.limitations, PHASE_ONE_LIMITATION])],
  };
}

function buildChangedWork(
  database: WorktrailDatabase,
  report: DailyReport,
): ChangedWorkGroup[] {
  const groups: ChangedWorkGroup[] = report.activeWorkstreams.map(
    (workstream) => ({
      group: {
        kind: "canonical-workstream",
        id: workstream.id,
        title: workstream.name,
        provisional: false,
      },
      latestActivity: workstream.latestActivity,
      runs: workstream.relatedRuns,
      relatedFiles: unique(workstream.relatedFiles),
      repositories: repositoriesForRuns(report, workstream.relatedRuns),
      actions: [],
      limitations: [],
    }),
  );

  const projects = projectMemberships(database, report.unassignedRuns);
  const fallback = new Map<string, ChangedWorkGroup>();
  for (const run of report.unassignedRuns) {
    const project = projects.get(run.sourceId);
    const key = project ? `project:${project.id}` : "unassigned";
    const existing = fallback.get(key);
    if (existing) {
      existing.runs.push(run);
      existing.latestActivity = max(existing.latestActivity, run.lastActivity);
      existing.relatedFiles = unique([
        ...existing.relatedFiles,
        ...run.relatedFiles,
      ]);
      existing.repositories = unique([
        ...existing.repositories,
        ...repositoriesForRuns(report, [run]),
      ]);
      continue;
    }
    fallback.set(key, {
      group: project
        ? {
            kind: "project-context",
            id: project.id,
            title: project.name,
            provisional: true,
          }
        : {
            kind: "unassigned",
            id: "unassigned",
            title: "Unassigned",
            provisional: true,
          },
      latestActivity: run.lastActivity,
      runs: [run],
      relatedFiles: unique(run.relatedFiles),
      repositories: repositoriesForRuns(report, [run]),
      actions: [],
      limitations: [],
    });
  }

  return [...groups, ...fallback.values()]
    .map((group) => ({
      ...group,
      runs: [...group.runs].sort(
        (left, right) =>
          right.lastActivity.localeCompare(left.lastActivity) ||
          left.sourceId.localeCompare(right.sourceId),
      ),
    }))
    .sort(
      (left, right) =>
        right.latestActivity.localeCompare(left.latestActivity) ||
        left.group.kind.localeCompare(right.group.kind) ||
        left.group.title.localeCompare(right.group.title) ||
        left.group.id.localeCompare(right.group.id),
    );
}

function projectMemberships(
  database: WorktrailDatabase,
  runs: DailyReportRun[],
): Map<string, { id: string; name: string }> {
  if (runs.length === 0) return new Map();
  const ids = runs.map((run) => run.sourceId);
  const rows = database.raw
    .prepare(
      `SELECT t.external_id, p.public_id, p.name
       FROM source_threads t
       JOIN project_thread_memberships m ON m.thread_id = t.id
       JOIN project_identities p ON p.id = m.project_id AND p.status = 'active'
       WHERE t.external_id IN (${ids.map(() => "?").join(", ")})
       ORDER BY t.external_id, p.public_id`,
    )
    .all(...ids) as Array<{
    external_id: string;
    public_id: string;
    name: string;
  }>;
  const candidates = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of rows) {
    const values = candidates.get(row.external_id) ?? [];
    values.push({ id: row.public_id, name: row.name });
    candidates.set(row.external_id, values);
  }
  return new Map(
    [...candidates].flatMap(([sourceId, values]) =>
      values.length === 1 ? [[sourceId, values[0]!] as const] : [],
    ),
  );
}

function repositoriesForRuns(
  report: DailyReport,
  runs: DailyReportRun[],
): string[] {
  const sourceIds = new Set(runs.map((run) => run.sourceId));
  return unique(
    (report.git?.repositories ?? [])
      .filter((repository) =>
        repository.relatedRunSourceIds.some((id) => sourceIds.has(id)),
      )
      .map((repository) => repository.root),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function max(left: string, right: string): string {
  return left.localeCompare(right) >= 0 ? left : right;
}
