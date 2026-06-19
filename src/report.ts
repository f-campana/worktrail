import { normalizeRelatedFiles } from "./files.js";
import type { WorktrailDatabase } from "./db/database.js";

export const DAILY_REPORT_SCHEMA_VERSION = 1 as const;

export type DailyReportRun = {
  sourceId: string;
  adapterId: string;
  sourceTool: string;
  title: string | null;
  lastActivity: string;
  resumeRef: string;
  relatedFiles: string[];
  evidenceAvailable: boolean;
};

export type DailyReportWorkstream = {
  id: string;
  name: string;
  latestActivity: string;
  relatedRuns: DailyReportRun[];
  relatedFiles: string[];
  signals: Array<{ type: "manual-assignment"; sourceIds: string[] }>;
};

export type DailyReport = {
  schemaVersion: typeof DAILY_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  window: {
    since: string;
    until: string;
    timezone: string;
    boundaryPolicy: "since-inclusive-until-exclusive";
  };
  activeWorkstreams: DailyReportWorkstream[];
  unassignedRuns: DailyReportRun[];
  omitted: { ignoredRuns: number };
  limitations: string[];
};

export type DailyReportOptions = {
  since: string | Date;
  until: string | Date;
  timezone?: string;
  clock?: () => Date;
};

type RunRow = {
  id: number;
  external_id: string;
  adapter_id: string;
  source_tool: string;
  title: string | null;
  cwd: string | null;
  last_activity: string;
  resume_ref: string;
  workstream_id: string | null;
  workstream_name: string | null;
  evidence_count: number;
};

/** Builds a deterministic, source-neutral report from already indexed data only. */
export function buildDailyReport(
  database: WorktrailDatabase,
  options: DailyReportOptions,
): DailyReport {
  const since = iso(options.since, "since");
  const until = iso(options.until, "until");
  if (since >= until)
    throw new Error("Report window requires since before until.");
  const generatedAt = (options.clock ?? (() => new Date()))().toISOString();
  const timezone = options.timezone?.trim() || "UTC";

  const rows = database.raw
    .prepare(
      `SELECT t.id, t.external_id, t.adapter_id, t.source_tool, t.title, t.cwd,
              max(se.occurred_at) AS last_activity, t.resume_ref,
              w.public_id AS workstream_id, w.name AS workstream_name,
              (SELECT count(*) FROM evidence e WHERE e.thread_id = t.id) AS evidence_count
       FROM source_threads t
       JOIN source_events se ON se.thread_id = t.id
         AND se.occurred_at >= ? AND se.occurred_at < ?
       LEFT JOIN workstream_assignments a ON a.thread_id = t.id
       LEFT JOIN workstreams assigned ON assigned.id = a.workstream_id
       LEFT JOIN workstreams w ON w.id = CASE
         WHEN assigned.status = 'merged' THEN assigned.merged_into_id ELSE assigned.id END
       LEFT JOIN ignored_threads ignored ON ignored.thread_id = t.id
       WHERE ignored.thread_id IS NULL
       GROUP BY t.id
       ORDER BY last_activity DESC, t.external_id ASC`,
    )
    .all(since, until) as RunRow[];

  const ignoredRuns = database.scalar(
    `SELECT count(DISTINCT t.id)
     FROM source_threads t
     JOIN source_events se ON se.thread_id = t.id
       AND se.occurred_at >= ? AND se.occurred_at < ?
     JOIN ignored_threads ignored ON ignored.thread_id = t.id`,
    since,
    until,
  );
  const filesByThread = loadFiles(database, rows);
  const runs = rows.map((row) => toRun(row, filesByThread.get(row.id) ?? []));
  const groups = new Map<
    string,
    { id: string; name: string; rows: RunRow[]; runs: DailyReportRun[] }
  >();
  const unassignedRuns: DailyReportRun[] = [];
  rows.forEach((row, index) => {
    const run = runs[index]!;
    if (!row.workstream_id || !row.workstream_name) {
      unassignedRuns.push(run);
      return;
    }
    const group = groups.get(row.workstream_id) ?? {
      id: row.workstream_id,
      name: row.workstream_name,
      rows: [],
      runs: [],
    };
    group.rows.push(row);
    group.runs.push(run);
    groups.set(group.id, group);
  });

  const activeWorkstreams = [...groups.values()]
    .map(
      (group): DailyReportWorkstream => ({
        id: group.id,
        name: group.name,
        latestActivity: group.runs[0]!.lastActivity,
        relatedRuns: group.runs,
        relatedFiles: normalizeRelatedFiles(
          group.runs.flatMap((run) => run.relatedFiles),
          group.rows.map((row) => row.cwd),
        ).sort(),
        signals: [
          {
            type: "manual-assignment",
            sourceIds: group.runs.map((run) => run.sourceId).sort(),
          },
        ],
      }),
    )
    .sort(
      (left, right) =>
        right.latestActivity.localeCompare(left.latestActivity) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    );

  return {
    schemaVersion: DAILY_REPORT_SCHEMA_VERSION,
    generatedAt,
    window: {
      since,
      until,
      timezone,
      boundaryPolicy: "since-inclusive-until-exclusive",
    },
    activeWorkstreams,
    unassignedRuns,
    omitted: { ignoredRuns },
    limitations: [
      "Activity only; completion, blockage, review, and delivery status are not inferred.",
      "Transcript-like evidence excerpts are omitted.",
    ],
  };
}

function loadFiles(
  database: WorktrailDatabase,
  rows: RunRow[],
): Map<number, string[]> {
  if (rows.length === 0) return new Map();
  const ids = rows.map((row) => row.id);
  const records = database.raw
    .prepare(
      `SELECT thread_id, path FROM file_references WHERE thread_id IN (${ids.map(() => "?").join(", ")}) ORDER BY path`,
    )
    .all(...ids) as Array<{ thread_id: number; path: string }>;
  const result = new Map<number, string[]>();
  for (const row of rows) {
    result.set(
      row.id,
      normalizeRelatedFiles(
        records
          .filter((record) => record.thread_id === row.id)
          .map((record) => record.path),
        [row.cwd],
      ).sort(),
    );
  }
  return result;
}

function toRun(row: RunRow, relatedFiles: string[]): DailyReportRun {
  return {
    sourceId: row.external_id,
    adapterId: row.adapter_id,
    sourceTool: row.source_tool,
    title: row.title,
    lastActivity: row.last_activity,
    resumeRef: row.resume_ref,
    relatedFiles,
    evidenceAvailable: row.evidence_count > 0,
  };
}

function iso(value: string | Date, name: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`Invalid report ${name}.`);
  return date.toISOString();
}
