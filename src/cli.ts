#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

import { CodexLocalAdapter } from "./adapters/codex-local.js";
import { WorktrailDatabase } from "./db/database.js";
import { importSources } from "./importer.js";
import { evaluateQueries, parseEvalQueries, type EvalEntry } from "./eval.js";
import { searchThreads, type SearchResult } from "./search.js";
import { buildStateResponse, type StateCard } from "./state.js";
import { buildDailyReport, type DailyReport } from "./report.js";
import {
  assignThread,
  addWorkstreamAlias,
  createWorkstream,
  ignoreThread,
  listWorkstreamAliases,
  listWorkstreams,
  mergeWorkstreams,
  removeWorkstreamAlias,
  renameWorkstream,
  unassignThread,
  unignoreThread,
} from "./workstreams.js";

type ParsedArgs = {
  command?: string;
  positional: string[];
  flags: Map<string, string | boolean>;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.flags.has("help") || args.command === "help") {
    printHelp();
    return;
  }

  if (args.command === "index") {
    await runIndex(args);
    return;
  }

  if (args.command === "search") {
    runSearch(args);
    return;
  }

  if (args.command === "state") {
    runState(args);
    return;
  }

  if (args.command === "report") {
    runReport(args);
    return;
  }

  if (args.command === "workstreams") {
    runWorkstreams(args);
    return;
  }

  if (args.command === "threads") {
    runThreads(args);
    return;
  }

  if (args.command === "eval") {
    runEval(args);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

function runReport(args: ParsedArgs): void {
  const since = reportInstantFlag(args, "since", true)!;
  const until = reportInstantFlag(args, "until", false) ?? new Date();
  const timezone = stringFlag(args, "timezone")?.trim() || "UTC";
  const database = new WorktrailDatabase(databasePath(args, false));
  try {
    const report = buildDailyReport(database, { since, until, timezone });
    console.log(
      args.flags.has("json")
        ? JSON.stringify(report, null, 2)
        : formatHumanReport(report),
    );
  } finally {
    database.close();
  }
}

function reportInstantFlag(
  args: ParsedArgs,
  name: "since" | "until",
  required: boolean,
): Date | undefined {
  const value = stringFlag(args, name);
  if (!value) {
    if (required) throw new Error("report requires --since <ISO_INSTANT>.");
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    throw new Error(`--${name} must be a valid ISO instant.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`--${name} must be a valid ISO instant.`);
  }
  return date;
}

export function formatHumanReport(report: DailyReport): string {
  const lines = [
    "Worktrail Daily Report",
    `Window: ${report.window.since} → ${report.window.until}`,
    `Generated: ${report.generatedAt}`,
    `Timezone policy: ${report.window.timezone}`,
    "",
  ];
  const activityCount =
    report.activeWorkstreams.length + report.unassignedRuns.length;
  if (activityCount === 0) lines.push("No activity found.", "");

  lines.push("Active workstreams");
  if (report.activeWorkstreams.length === 0) lines.push("- None");
  report.activeWorkstreams.forEach((workstream, index) => {
    lines.push(
      `${index + 1}. ${workstream.name}`,
      `   Latest activity: ${workstream.latestActivity}`,
      `   Runs: ${workstream.relatedRuns.length}`,
    );
    if (workstream.relatedFiles.length > 0)
      lines.push(`   Files: ${workstream.relatedFiles.join(", ")}`);
    lines.push("   Resume:");
    for (const run of workstream.relatedRuns)
      lines.push(`     codex resume ${run.resumeRef}`);
  });

  lines.push("", "Unassigned runs");
  if (report.unassignedRuns.length === 0) lines.push("- None");
  for (const run of report.unassignedRuns) {
    lines.push(
      `- ${run.title ?? run.sourceId}`,
      `  Latest activity: ${run.lastActivity}`,
      `  Resume: codex resume ${run.resumeRef}`,
    );
  }
  if (report.git?.repositories.length) {
    lines.push("", "Git");
    report.git.repositories.forEach((repository, index) => {
      lines.push(
        `${index + 1}. ${repository.displayRoot}`,
        ...(repository.branch ? [`   Branch: ${repository.branch}`] : []),
        ...(repository.head ? [`   HEAD: ${repository.head}`] : []),
        `   Dirty: ${repository.dirty ? `yes (${repository.dirtyFileCount} files)` : "no"}`,
        `   Commits in window: ${repository.commitsInWindow.length}${repository.commitsTruncated ? "+" : ""}`,
      );
      if (repository.changedFilesInWindow.length)
        lines.push(
          `   Files in window: ${repository.changedFilesInWindow.join(", ")}${repository.changedFilesTruncated ? ", …" : ""}`,
        );
      for (const diagnostic of repository.diagnostics)
        lines.push(`   Diagnostic: ${diagnostic.message}`);
    });
  }
  lines.push(
    "",
    "Omitted",
    `- Ignored runs: ${report.omitted.ignoredRuns}`,
    "",
    "Limitations",
    ...report.limitations.map((limitation) => `- ${limitation}`),
  );
  return lines.join("\n");
}

async function runIndex(args: ParsedArgs): Promise<void> {
  const fixtures = args.flags.has("fixtures");
  const dbPath = databasePath(args, fixtures);
  const fixtureDir = resolve(
    stringFlag(args, "fixture-dir") ?? "fixtures/codex",
  );
  const codexHome = stringFlag(args, "codex-home");
  const maxSources = numberFlag(args, "max-sources");
  const since = stringFlag(args, "since");

  const database = new WorktrailDatabase(dbPath);
  try {
    const adapter = new CodexLocalAdapter({
      ...(fixtures ? { fixtureDir } : {}),
      ...(codexHome ? { codexHome } : {}),
    });
    const stats = await importSources(database, adapter, {
      scope: fixtures ? "fixtures" : "local",
      force: args.flags.has("force"),
      ...(since ? { since } : {}),
      ...(maxSources !== undefined ? { maxSources } : {}),
    });

    console.log(`Index run ${stats.runId} completed.`);
    console.log(`Database: ${dbPath}`);
    console.log(
      `Sources: ${stats.discoveredSources} discovered, ${stats.indexedSources} indexed, ${stats.skippedSources} unchanged.`,
    );
    console.log(
      `Normalized: ${stats.threads} threads, ${stats.events} events, ${stats.messages} messages, ${stats.toolCalls} tool calls, ${stats.toolResults} tool results, ${stats.fileChanges} file changes.`,
    );
    console.log(
      `Enrichment/diagnostics: ${stats.titleEnrichments} titles, ${stats.malformedLines} malformed lines, ${stats.partialLines} partial trailing lines, ${stats.unknownRecords} unknown records.`,
    );
  } finally {
    database.close();
  }
}

function runSearch(args: ParsedArgs): void {
  const query = args.positional.join(" ").trim();
  if (!query) throw new Error("Search requires a query.");
  const dbPath = databasePath(args, args.flags.has("fixtures"));
  const limit = numberFlag(args, "limit") ?? 5;
  const database = new WorktrailDatabase(dbPath);
  try {
    const results = searchThreads(database, query, limit, {
      includeIgnored: args.flags.has("include-ignored"),
    });
    if (args.flags.has("json")) {
      console.log(JSON.stringify({ query, results }, null, 2));
      return;
    }
    printResults(query, results);
  } finally {
    database.close();
  }
}

function runState(args: ParsedArgs): void {
  const query = args.positional.join(" ").trim();
  if (!query) throw new Error("State requires a query.");
  const dbPath = databasePath(args, args.flags.has("fixtures"));
  const limit = numberFlag(args, "limit") ?? 5;
  const database = new WorktrailDatabase(dbPath);
  try {
    const response = buildStateResponse(database, query, limit);
    if (args.flags.has("json")) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    printState(
      response.query,
      response.best,
      response.alternates,
      args.flags.has("explain"),
    );
  } finally {
    database.close();
  }
}

function runWorkstreams(args: ParsedArgs): void {
  const [action, ...values] = args.positional;
  const dbPath = databasePath(args, args.flags.has("fixtures"));
  const database = new WorktrailDatabase(dbPath);
  try {
    if (action === "list") {
      const workstreams = listWorkstreams(database);
      if (args.flags.has("json")) {
        console.log(JSON.stringify({ workstreams }, null, 2));
      } else if (workstreams.length === 0) {
        console.log("No workstreams created.");
      } else {
        for (const workstream of workstreams) {
          console.log(
            `${workstream.id}\t${workstream.name}\t${workstream.status}${workstream.mergedIntoId ? ` -> ${workstream.mergedIntoId}` : ""}\t${workstream.activeThreadCount}/${workstream.threadCount} active threads`,
          );
        }
      }
      return;
    }

    if (action === "create") {
      const name = values.join(" ").trim();
      if (!name) throw new Error("workstreams create requires a name.");
      const workstream = createWorkstream(database, name);
      printMutation(args, { action: "created", workstream });
      return;
    }

    if (action === "rename") {
      const [identifier, ...nameParts] = values;
      const name = nameParts.join(" ").trim();
      if (!identifier || !name) {
        throw new Error("workstreams rename requires WORKSTREAM_ID and name.");
      }
      const workstream = renameWorkstream(database, identifier, name);
      printMutation(args, { action: "renamed", workstream });
      return;
    }

    if (action === "alias") {
      const [aliasAction, identifier, ...aliasParts] = values;
      const alias = aliasParts.join(" ").trim();
      if (
        !identifier ||
        !alias ||
        (aliasAction !== "add" && aliasAction !== "remove")
      ) {
        throw new Error(
          "workstreams alias requires add/remove, WORKSTREAM_ID, and alias.",
        );
      }
      if (aliasAction === "add") {
        printMutation(args, {
          action: "alias-added",
          alias: addWorkstreamAlias(database, identifier, alias),
        });
      } else {
        printMutation(args, {
          action: "alias-removed",
          workstreamId: identifier,
          alias,
          changed: removeWorkstreamAlias(database, identifier, alias),
        });
      }
      return;
    }

    if (action === "aliases") {
      const identifier = values[0];
      if (!identifier)
        throw new Error("workstreams aliases requires WORKSTREAM_ID.");
      const aliases = listWorkstreamAliases(database, identifier);
      if (args.flags.has("json")) {
        console.log(
          JSON.stringify({ workstreamId: identifier, aliases }, null, 2),
        );
      } else if (aliases.length === 0) {
        console.log("No aliases configured.");
      } else {
        for (const item of aliases) console.log(item.alias);
      }
      return;
    }

    if (action === "merge") {
      const [sourceId, targetId] = values;
      if (!sourceId || !targetId) {
        throw new Error(
          "workstreams merge requires SOURCE_WORKSTREAM_ID and TARGET_WORKSTREAM_ID.",
        );
      }
      printMutation(args, {
        action: "merged",
        merge: mergeWorkstreams(database, sourceId, targetId),
      });
      return;
    }

    throw new Error(
      "workstreams requires list, create, rename, alias, aliases, or merge.",
    );
  } finally {
    database.close();
  }
}

function runEval(args: ParsedArgs): void {
  const inputPath = args.positional[0];
  if (!inputPath) throw new Error("eval requires a query JSON file.");
  const parsed = JSON.parse(
    readFileSync(resolve(inputPath), "utf8"),
  ) as unknown;
  const queries = parseEvalQueries(parsed);
  const database = new WorktrailDatabase(
    databasePath(args, args.flags.has("fixtures")),
  );
  try {
    const entries = evaluateQueries(database, queries, {
      withEvidence: args.flags.has("with-evidence"),
    });
    if (args.flags.has("json")) {
      console.log(JSON.stringify({ version: 1, entries }, null, 2));
    } else {
      printEval(entries, args.flags.has("with-evidence"));
    }
  } finally {
    database.close();
  }
}

function runThreads(args: ParsedArgs): void {
  const [action, externalThreadId, workstreamId] = args.positional;
  const dbPath = databasePath(args, args.flags.has("fixtures"));
  if (!externalThreadId) {
    throw new Error("threads command requires a source thread UUID.");
  }
  const database = new WorktrailDatabase(dbPath);
  try {
    if (action === "assign") {
      if (!workstreamId) {
        throw new Error(
          "threads assign requires THREAD_UUID and WORKSTREAM_ID.",
        );
      }
      const assignment = assignThread(database, externalThreadId, workstreamId);
      printMutation(args, { action: "assigned", assignment });
      return;
    }
    if (action === "unassign") {
      const changed = unassignThread(database, externalThreadId);
      printMutation(args, {
        action: "unassigned",
        threadId: externalThreadId,
        changed,
      });
      return;
    }
    if (action === "ignore") {
      ignoreThread(database, externalThreadId, stringFlag(args, "reason"));
      printMutation(args, { action: "ignored", threadId: externalThreadId });
      return;
    }
    if (action === "unignore") {
      const changed = unignoreThread(database, externalThreadId);
      printMutation(args, {
        action: "unignored",
        threadId: externalThreadId,
        changed,
      });
      return;
    }
    throw new Error("threads requires assign, unassign, ignore, or unignore.");
  } finally {
    database.close();
  }
}

function printResults(query: string, results: SearchResult[]): void {
  console.log(`Query: ${query}`);
  if (results.length === 0) {
    console.log("No matching work found.");
    return;
  }

  const [best, ...alternates] = results;
  if (!best) return;
  console.log("\nBest match");
  console.log(`Title: ${best.title ?? "(untitled Codex thread)"}`);
  console.log(`Score: ${best.score.toFixed(3)} (${best.confidence})`);
  console.log(`Source: ${best.sourceTool}`);
  console.log(`Archived: ${best.archived ? "yes" : "no"}`);
  console.log(`Last activity: ${best.lastActivity}`);
  console.log(`Cwd: ${best.cwd ?? "unknown"}`);
  console.log(`Resume UUID: ${best.resumeRef}`);

  if (best.evidence.length > 0) {
    console.log("Evidence:");
    for (const item of best.evidence) {
      console.log(
        `- [${item.kind}, line ${item.recordLine}] ${oneLine(item.excerpt)}`,
      );
    }
  }
  if (best.fileReferences.length > 0) {
    console.log(`Related files: ${best.fileReferences.join(", ")}`);
  }

  if (alternates.length > 0) {
    console.log("\nAlternate matches");
    for (const alternate of alternates.slice(0, 4)) {
      console.log(
        `- ${alternate.title ?? alternate.externalId} (${alternate.score.toFixed(3)}, ${alternate.archived ? "archived" : "active"})`,
      );
    }
  }
}

function printState(
  query: string,
  best: StateCard | null,
  alternates: Array<{
    workstream: {
      id: string | null;
      name: string;
      origin: "manual" | "candidate";
    };
    score: number;
    confidence: "high" | "medium" | "low";
    signals: Array<{ type: string; weight: number; detail: string }>;
    latestActivity: string;
    bestThreadId: string;
  }>,
  explain: boolean,
): void {
  console.log(`Query: ${query}`);
  if (!best) {
    console.log("No matching workstream evidence found.");
    return;
  }

  console.log("\nBest workstream");
  console.log(`Name: ${best.workstream.name}`);
  console.log(`Origin: ${best.workstream.origin}`);
  if (best.workstream.id) console.log(`Workstream ID: ${best.workstream.id}`);
  console.log(`Score: ${best.score.toFixed(3)} (${best.confidence})`);
  console.log(`Why: ${best.signals.map((signal) => signal.type).join(", ")}`);
  if (explain) {
    for (const signal of best.signals) {
      console.log(
        `- ${signal.type} (${signal.weight.toFixed(2)}): ${signal.detail}`,
      );
    }
  }
  console.log(`Latest activity: ${best.latestActivity}`);
  console.log(`Cwd: ${best.cwd ?? "unknown"}`);
  console.log(
    `Best thread: ${best.bestThread.title ?? best.bestThread.externalId} (${best.bestThread.resumeRef})`,
  );

  console.log("Related threads:");
  for (const thread of best.relatedThreads) {
    console.log(
      `- ${thread.title ?? thread.externalId} | ${thread.archived ? "archived" : "active"} | resume ${thread.resumeRef}`,
    );
  }

  if (best.latestEvidence.length > 0) {
    console.log("Latest evidence:");
    for (const item of best.latestEvidence) {
      console.log(
        `- [${item.kind}, ${item.occurredAt}, ${item.threadId}] ${oneLine(item.excerpt)}`,
      );
    }
  }
  if (best.relatedFiles.length > 0) {
    console.log(`Related files: ${best.relatedFiles.join(", ")}`);
  }

  if (alternates.length > 0) {
    console.log("\nAlternate workstreams");
    for (const alternate of alternates) {
      console.log(
        `- ${alternate.workstream.name} (${alternate.score.toFixed(3)}, ${alternate.workstream.origin})`,
      );
    }
  }
}

function printEval(entries: EvalEntry[], withEvidence: boolean): void {
  for (const entry of entries) {
    if (!entry.found) {
      console.log(`${entry.query}\tNO_MATCH`);
      continue;
    }
    console.log(
      [
        entry.query,
        entry.workstreamName,
        entry.workstreamId ?? "candidate",
        entry.bestThreadTitle ?? entry.bestThreadId,
        entry.bestThreadId,
        entry.score?.toFixed(3),
        entry.signals.join(","),
        entry.latestActivity,
      ].join("\t"),
    );
    if (withEvidence) {
      for (const evidence of entry.evidence ?? []) {
        console.log(`  evidence: ${oneLine(evidence.excerpt)}`);
      }
    }
  }
}

function printMutation(
  args: ParsedArgs,
  payload: Record<string, unknown>,
): void {
  if (args.flags.has("json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(JSON.stringify(payload));
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value?.startsWith("--")) {
      if (value) positional.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { ...(command ? { command } : {}), positional, flags };
}

function databasePath(args: ParsedArgs, fixtures: boolean): string {
  return resolve(
    stringFlag(args, "db") ??
      process.env.WORKTRAIL_DB ??
      (fixtures
        ? resolve(".worktrail/fixtures.db")
        : resolve(homedir(), ".worktrail/worktrail.db")),
  );
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function numberFlag(args: ParsedArgs, name: string): number | undefined {
  const raw = stringFlag(args, name);
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return value;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function printHelp(): void {
  console.log(`Worktrail headless CLI

Usage:
  pnpm worktrail index --fixtures [--db PATH] [--force]
  pnpm worktrail index [--db PATH] [--codex-home PATH] [--max-sources N] [--since ISO_DATE]
  pnpm worktrail search "query" [--db PATH] [--limit N] [--json] [--include-ignored]
  pnpm worktrail state "query" [--db PATH] [--limit N] [--json] [--explain]
  pnpm worktrail report --since ISO_INSTANT [--until ISO_INSTANT] [--timezone TIMEZONE] [--db PATH] [--json]
  pnpm worktrail workstreams list [--db PATH] [--json]
  pnpm worktrail workstreams create "name" [--db PATH] [--json]
  pnpm worktrail workstreams rename WORKSTREAM_ID "name" [--db PATH] [--json]
  pnpm worktrail workstreams alias add WORKSTREAM_ID "alias" [--db PATH] [--json]
  pnpm worktrail workstreams alias remove WORKSTREAM_ID "alias" [--db PATH] [--json]
  pnpm worktrail workstreams aliases WORKSTREAM_ID [--db PATH] [--json]
  pnpm worktrail workstreams merge SOURCE_WORKSTREAM_ID TARGET_WORKSTREAM_ID [--db PATH] [--json]
  pnpm worktrail threads assign THREAD_UUID WORKSTREAM_ID [--db PATH] [--json]
  pnpm worktrail threads unassign THREAD_UUID [--db PATH] [--json]
  pnpm worktrail threads ignore THREAD_UUID [--db PATH] [--reason TEXT] [--json]
  pnpm worktrail threads unignore THREAD_UUID [--db PATH] [--json]
  pnpm worktrail eval queries.json [--db PATH] [--json] [--with-evidence]

Defaults:
  Fixture database: .worktrail/fixtures.db
  Local database:   ~/.worktrail/worktrail.db
  Codex home:       $CODEX_HOME or ~/.codex
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  console.error(`worktrail: ${message}`);
  process.exitCode = 1;
});
