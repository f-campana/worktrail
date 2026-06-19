import { resolve } from "node:path";
import { WorktrailDatabase } from "./db/database.js";

export type IndexStatus = {
  version: 1;
  databasePath: string;
  latestRun: null | { completedAt: string | null; status: string };
  counts: {
    sources: number;
    threads: number;
    events: number;
    messages: number;
    diagnostics: number;
  };
};

export function getIndexStatus(
  database: WorktrailDatabase,
  path: string,
): IndexStatus {
  const latestRun = database.raw
    .prepare(
      "SELECT completed_at, status FROM indexing_runs ORDER BY id DESC LIMIT 1",
    )
    .get() as { completed_at: string | null; status: string } | undefined;
  return {
    version: 1,
    databasePath: resolve(path),
    latestRun: latestRun
      ? { completedAt: latestRun.completed_at, status: latestRun.status }
      : null,
    counts: {
      sources: database.scalar("SELECT count(*) FROM sources"),
      threads: database.scalar("SELECT count(*) FROM source_threads"),
      events: database.scalar("SELECT count(*) FROM source_events"),
      messages: database.scalar("SELECT count(*) FROM messages"),
      diagnostics: database.scalar("SELECT count(*) FROM diagnostics"),
    },
  };
}
