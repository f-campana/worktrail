import type { WorktrailDatabase } from "./db/database.js";
import {
  buildDailyReport,
  type DailyReport,
  type DailyReportRun,
} from "./report.js";
import {
  createCodexLocalSourceStateProvider,
  sourceStateRequestsForCandidates,
  type SourceStateCandidate,
  type SourceStateProvider,
} from "./source-state.js";
import { isSafeCodexThreadRef } from "./target-validation.js";
import type {
  SourceThreadState,
  SourceThreadStateObservation,
} from "./types.js";

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
  sourceStateProvider?: SourceStateProvider;
};

export type BuildAttentionDigestFromReportOptions = {
  sourceStateProvider?: SourceStateProvider;
};

const PHASE_FOUR_LIMITATION =
  "Phase 4 only; JSON CLI output is available, but human formatting, dirty Git, source-health aggregation, source stale rules, and index diagnostics are not.";
const UNKNOWN_TARGET_LIMITATION =
  "One or more changed-work Codex targets could not be verified; unknown targets fail closed and expose no open action.";

/** Builds the Phase 4 digest by composing exactly one DailyReport result. */
export function buildAttentionDigest(
  database: WorktrailDatabase,
  options: BuildAttentionDigestOptions,
): AttentionDigestResult {
  const report = buildDailyReport(database, options);
  return buildAttentionDigestFromReport(database, report, {
    ...(options.sourceStateProvider
      ? { sourceStateProvider: options.sourceStateProvider }
      : {}),
  });
}

/** Maps an already composed report into the Phase 4 digest contract. */
export function buildAttentionDigestFromReport(
  database: WorktrailDatabase,
  report: DailyReport,
  options: BuildAttentionDigestFromReportOptions = {},
): AttentionDigestResult {
  const changedWork = buildChangedWork(database, report);
  const sourceState = observeChangedWorkSourceState(
    database,
    changedWork,
    options.sourceStateProvider ??
      createCodexLocalSourceStateProvider({
        clock: () => new Date(report.generatedAt),
      }),
    report.generatedAt,
  );
  const observedChangedWork = changedWork.map((group) =>
    addSafeGroupActions(group, sourceState.observations),
  );
  const attentionItems = buildSourceStateAttentionItems(
    observedChangedWork,
    sourceState.observations,
  );
  const count = (priority: AttentionItem["priority"]) =>
    attentionItems.filter((item) => item.priority === priority).length;
  return {
    schemaVersion: ATTENTION_DIGEST_SCHEMA_VERSION,
    generatedAt: report.generatedAt,
    window: report.window,
    summary: {
      attentionCount: attentionItems.length,
      highCount: count("high"),
      mediumCount: count("medium"),
      lowCount: count("low"),
      infoCount: count("info"),
      changedWorkCount: observedChangedWork.length,
      sourceHealth: "unknown",
    },
    attentionItems,
    changedWork: observedChangedWork,
    sourceHealth: [],
    omitted: {
      ignoredRuns: report.omitted.ignoredRuns,
      archivedTargets: sourceState.counts.archived,
      missingTargets: sourceState.counts.missing,
      unavailableSourceObservations: sourceState.counts.unknown,
    },
    limitations: [
      ...new Set([
        ...report.limitations,
        PHASE_FOUR_LIMITATION,
        ...(sourceState.counts.unknown > 0 ? [UNKNOWN_TARGET_LIMITATION] : []),
      ]),
    ],
  };
}

function observeChangedWorkSourceState(
  database: WorktrailDatabase,
  changedWork: ChangedWorkGroup[],
  provider: SourceStateProvider,
  observedAt: string,
): {
  observations: Map<string, SourceThreadStateObservation>;
  counts: Record<Exclude<SourceThreadState, "active">, number>;
} {
  const candidates = uniqueSourceStateCandidates(
    changedWork.flatMap((group) => group.runs),
  );
  let returned: SourceThreadStateObservation[] = [];
  try {
    returned = provider(sourceStateRequestsForCandidates(database, candidates));
  } catch {
    // A bounded source-state failure is represented as unknown for every
    // affected target; the digest must fail closed rather than expose actions.
  }
  const observations = new Map(
    returned.map((observation) => [sourceStateKey(observation), observation]),
  );
  const counts = { archived: 0, missing: 0, unknown: 0 };
  for (const candidate of candidates) {
    const key = sourceStateKey(candidate);
    if (!observations.has(key)) {
      observations.set(key, {
        sourceId: candidate.sourceId,
        resumeRef: candidate.resumeRef,
        sourceTool: "codex-local",
        state: "unknown",
        observedAt,
      });
    }
    const state = observations.get(key)!.state;
    if (state !== "active") counts[state] += 1;
  }
  return { observations, counts };
}

function buildSourceStateAttentionItems(
  changedWork: ChangedWorkGroup[],
  observations: ReadonlyMap<string, SourceThreadStateObservation>,
): AttentionItem[] {
  const items = new Map<string, AttentionItem>();
  for (const run of changedWork.flatMap((group) => group.runs)) {
    if (run.sourceTool !== "codex-local" || !run.resumeRef) continue;
    const observation = observations.get(sourceStateKey(run));
    if (!observation || observation.state === "active") continue;
    const unavailable =
      observation.state === "archived" || observation.state === "missing";
    const ruleId = unavailable
      ? "resume-target-unavailable/v1"
      : "resume-state-unknown/v1";
    const id = `${ruleId}:codex-local:${run.sourceId}:${observation.state}`;
    items.set(id, {
      id,
      ruleId,
      kind: unavailable ? "archived-or-missing-resume-target" : "unknown-state",
      subject: {
        kind: "run",
        id: run.sourceId,
        title: run.title ?? run.sourceId,
      },
      title: unavailable
        ? "Resume target unavailable"
        : "Resume target state unknown",
      reason: unavailable
        ? "This changed-work Codex target is currently archived or missing, so no open action is exposed."
        : "Worktrail could not verify the current state of this changed-work Codex target, so no open action is exposed.",
      priority: unavailable ? "medium" : "info",
      confidence: "high",
      freshness: unavailable ? "fresh" : "unknown",
      changedAt: run.lastActivity,
      sourceRefs: [
        {
          sourceTool: "codex-local",
          sourceId: run.sourceId,
          observation: observation.state,
          observedAt: observation.observedAt,
        },
      ],
      evidenceRefs: [
        {
          kind: "source-state",
          ref: run.sourceId,
          occurredAt: observation.observedAt,
        },
        {
          kind: "activity",
          ref: run.sourceId,
          occurredAt: run.lastActivity,
        },
      ],
      actions: [
        {
          kind: "copy-id",
          label: "Copy run ID",
          value: run.sourceId,
          validation: "not-required",
        },
        ...(run.title
          ? [
              {
                kind: "copy-title" as const,
                label: "Copy run title",
                value: run.title,
                validation: "not-required" as const,
              },
            ]
          : []),
      ],
      limitations: unavailable
        ? ["The source-state observation does not establish work status."]
        : [
            "The target state could not be verified; unknown targets fail closed.",
          ],
    });
  }
  const priority = { high: 0, medium: 1, low: 2, info: 3 } as const;
  const freshness = { fresh: 0, stale: 1, unknown: 2 } as const;
  return [...items.values()].sort(
    (left, right) =>
      priority[left.priority] - priority[right.priority] ||
      freshness[left.freshness] - freshness[right.freshness] ||
      (right.changedAt ?? "").localeCompare(left.changedAt ?? "") ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.id.localeCompare(right.id),
  );
}

function uniqueSourceStateCandidates(
  runs: DailyReportRun[],
): SourceStateCandidate[] {
  const candidates = new Map<string, SourceStateCandidate>();
  for (const run of runs) {
    if (run.sourceTool !== "codex-local" || !run.resumeRef) continue;
    const candidate = {
      sourceId: run.sourceId,
      resumeRef: run.resumeRef,
      sourceTool: run.sourceTool,
    };
    candidates.set(sourceStateKey(candidate), candidate);
  }
  return [...candidates.values()];
}

function addSafeGroupActions(
  group: ChangedWorkGroup,
  observations: ReadonlyMap<string, SourceThreadStateObservation>,
): ChangedWorkGroup {
  const active = group.runs.find((run) => {
    if (
      run.sourceTool !== "codex-local" ||
      !isSafeCodexThreadRef(run.resumeRef)
    )
      return false;
    return observations.get(sourceStateKey(run))?.state === "active";
  });
  if (!active) return group;
  const target = { sourceTool: "codex-local", resumeRef: active.resumeRef };
  return {
    ...group,
    actions: [
      {
        kind: "open-codex",
        label: "Open in Codex",
        value: `codex://threads/${active.resumeRef}`,
        target,
        validation: "validate-before-open",
      },
      {
        kind: "copy-command",
        label: "Copy Codex resume command",
        value: `codex resume ${active.resumeRef}`,
        target,
        validation: "not-required",
      },
    ],
  };
}

function sourceStateKey(candidate: {
  sourceId: string;
  resumeRef: string;
}): string {
  return `${candidate.sourceId}\0${candidate.resumeRef}`;
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
