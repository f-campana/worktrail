import { basename } from "node:path";

import { WorktrailDatabase } from "./db/database.js";
import { normalizeRelatedFiles } from "./files.js";
import { queryTerms, searchThreads, type SearchResult } from "./search.js";

export type StateSignalType =
  | "manual-assignment"
  | "alias-match"
  | "workstream-name-match"
  | "title-match"
  | "cwd-match"
  | "file-reference-match"
  | "evidence-text-match"
  | "recency"
  | "ignored-thread-exclusion";

export type StateSignal = {
  type: StateSignalType;
  weight: number;
  detail: string;
};

export type StateThread = {
  externalId: string;
  title: string | null;
  sourceTool: string;
  archived: boolean;
  lastActivity: string;
  cwd: string | null;
  resumeRef: string;
  score: number;
};

export type StateEvidence = {
  threadId: string;
  kind: string;
  excerpt: string;
  occurredAt: string;
  recordLine: number;
  relevance: number;
};

export type StateWorkstream = {
  id: string | null;
  name: string;
  origin: "manual" | "candidate";
};

export type StateCard = {
  workstream: StateWorkstream;
  score: number;
  confidence: "high" | "medium" | "low";
  signals: StateSignal[];
  latestActivity: string;
  cwd: string | null;
  bestThread: StateThread;
  relatedThreads: StateThread[];
  latestEvidence: StateEvidence[];
  relatedFiles: string[];
};

export type StateAlternate = {
  workstream: StateWorkstream;
  score: number;
  confidence: "high" | "medium" | "low";
  signals: StateSignal[];
  latestActivity: string;
  bestThreadId: string;
};

export type StateResponse = {
  version: 1;
  query: string;
  best: StateCard | null;
  alternates: StateAlternate[];
};

export type WorkstreamDetailResponse = {
  version: 1;
  workstream: StateWorkstream & { status: "active" | "merged"; aliases: string[] };
  card: StateCard;
};

export function buildWorkstreamDetail(
  database: WorktrailDatabase,
  publicId: string,
): WorkstreamDetailResponse | null {
  const row = database.raw.prepare(
    `SELECT id, public_id, name, status FROM workstreams WHERE public_id = ?`,
  ).get(publicId) as { id: number; public_id: string; name: string; status: "active" | "merged" } | undefined;
  if (!row) return null;
  const aliases = (database.raw.prepare(
    `SELECT alias FROM workstream_aliases WHERE workstream_id = ? ORDER BY alias`,
  ).all(row.id) as Array<{ alias: string }>).map((item) => item.alias);
  const terms = queryTerms([row.name, ...aliases].join(" "));
  const card = buildCard(database, {
    origin: "manual", internalWorkstreamId: row.id, publicId: row.public_id,
    name: row.name, score: 1, matches: [],
  }, terms, 0);
  if (!card) return null;
  return { version: 1, workstream: { ...card.workstream, status: row.status, aliases }, card };
}

export function listRecentWorkstreamCards(database: WorktrailDatabase, limit = 5) {
  const rows = database.raw.prepare(
    `SELECT w.public_id FROM workstreams w
     JOIN workstream_assignments a ON a.workstream_id = w.id
     JOIN source_threads t ON t.id = a.thread_id
     LEFT JOIN ignored_threads i ON i.thread_id = t.id
     WHERE w.status = 'active' AND i.thread_id IS NULL
     GROUP BY w.id ORDER BY max(t.updated_at) DESC LIMIT ?`,
  ).all(limit) as Array<{ public_id: string }>;
  return rows.flatMap(({ public_id }) => {
    const detail = buildWorkstreamDetail(database, public_id);
    if (!detail) return [];
    return [{ workstream: detail.card.workstream, latestActivity: detail.card.latestActivity,
      confidence: detail.card.confidence, threadCount: detail.card.relatedThreads.length }];
  });
}

type AssignmentRow = {
  workstream_internal_id: number;
  workstream_public_id: string;
  workstream_name: string;
  external_id: string;
};

type WorkstreamVocabulary = {
  internalId: number;
  publicId: string;
  name: string;
  aliases: string[];
};

type ThreadRow = {
  id: number;
  external_id: string;
  resume_ref: string;
  title: string | null;
  source_tool: string;
  archived: number;
  updated_at: string;
  cwd: string | null;
};

type Candidate = {
  origin: "manual" | "candidate";
  internalWorkstreamId?: number;
  publicId?: string;
  name: string;
  score: number;
  matches: SearchResult[];
  aliasMatch?: string;
  nameMatched?: boolean;
};

const GENERIC_IDENTITY_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "readme.md",
  "tsconfig.json",
  ".gitignore",
]);

export function buildStateResponse(
  database: WorktrailDatabase,
  query: string,
  limit = 5,
): StateResponse {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return { version: 1, query, best: null, alternates: [] };
  }

  const matchLimit = Math.max(20, limit * 4);
  const matches = searchThreads(database, query, matchLimit);
  const allMatches = searchThreads(database, query, matchLimit, { includeIgnored: true });
  const visibleIds = new Set(matches.map((match) => match.externalId));
  const ignoredQueryMatches = allMatches.filter(
    (match) => !visibleIds.has(match.externalId),
  ).length;
  const assignments = loadAssignments(database);
  const assignmentByThread = new Map(
    assignments.map((assignment) => [assignment.external_id, assignment]),
  );
  const candidates = new Map<string, Candidate>();

  for (const match of matches) {
    const assignment = assignmentByThread.get(match.externalId);
    if (!assignment) continue;
    const key = `manual:${assignment.workstream_public_id}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.matches.push(match);
      existing.score = Math.max(existing.score, match.score);
    } else {
      candidates.set(key, {
        origin: "manual",
        internalWorkstreamId: assignment.workstream_internal_id,
        publicId: assignment.workstream_public_id,
        name: assignment.workstream_name,
        score: match.score,
        matches: [match],
      });
    }
  }

  for (const workstream of loadWorkstreamVocabulary(database)) {
    const alias = bestAliasMatch(query, workstream.aliases);
    const aliasScore = alias ? aliasMatchScore(query, alias) : 0;
    const nameScore = lexicalScore(workstream.name, terms);
    if (aliasScore === 0 && nameScore === 0) continue;
    if (!hasActiveAssignedThread(database, workstream.internalId)) continue;

    const key = `manual:${workstream.publicId}`;
    const existing = candidates.get(key);
    const score = Math.max(aliasScore, nameScore);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      if (alias) existing.aliasMatch = alias;
      if (nameScore > 0) existing.nameMatched = true;
    } else {
      candidates.set(key, {
        origin: "manual",
        internalWorkstreamId: workstream.internalId,
        publicId: workstream.publicId,
        name: workstream.name,
        score,
        matches: [],
        ...(alias ? { aliasMatch: alias } : {}),
        ...(nameScore > 0 ? { nameMatched: true } : {}),
      });
    }
  }

  const unassigned = matches.filter((match) => !assignmentByThread.has(match.externalId));
  const clustered = new Set<string>();
  for (const seed of unassigned) {
    if (clustered.has(seed.externalId)) continue;
    clustered.add(seed.externalId);
    const grouped = [seed];
    for (const candidate of unassigned) {
      if (clustered.has(candidate.externalId)) continue;
      if (shouldGroup(seed, candidate)) {
        grouped.push(candidate);
        clustered.add(candidate.externalId);
      }
    }
    candidates.set(`candidate:${seed.externalId}`, {
      origin: "candidate",
      name: candidateName(seed),
      score: Math.max(...grouped.map((match) => match.score)),
      matches: grouped,
    });
  }

  const cards = [...candidates.values()]
    .map((candidate) =>
      buildCard(database, candidate, terms, ignoredQueryMatches),
    )
    .filter((card): card is StateCard => card !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        originWeight(right.workstream.origin) - originWeight(left.workstream.origin) ||
        right.latestActivity.localeCompare(left.latestActivity),
    );

  return {
    version: 1,
    query,
    best: cards[0] ?? null,
    alternates: cards.slice(1, Math.max(1, limit)).map((card) => ({
      workstream: card.workstream,
      score: card.score,
      confidence: card.confidence,
      signals: card.signals,
      latestActivity: card.latestActivity,
      bestThreadId: card.bestThread.externalId,
    })),
  };
}

function buildCard(
  database: WorktrailDatabase,
  candidate: Candidate,
  terms: string[],
  ignoredQueryMatches: number,
): StateCard | null {
  const scoreByThread = new Map(
    candidate.matches.map((match) => [match.externalId, match.score]),
  );
  const rows = candidate.internalWorkstreamId
    ? assignedThreadRows(database, candidate.internalWorkstreamId)
    : threadRows(database, candidate.matches.map((match) => match.externalId));
  if (rows.length === 0) return null;

  const relatedThreads = rows
    .map((row) => toStateThread(row, scoreByThread.get(row.external_id) ?? 0))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.lastActivity.localeCompare(left.lastActivity),
    );
  const bestThread = relatedThreads[0];
  if (!bestThread) return null;

  const latestActivity = relatedThreads
    .map((thread) => thread.lastActivity)
    .sort()
    .at(-1) ?? bestThread.lastActivity;
  const internalThreadIds = rows.map((row) => row.id);
  const latestEvidence = collectEvidence(database, internalThreadIds, terms);
  const relatedFiles = collectFiles(database, internalThreadIds, terms, rows);
  const ignoredAssigned = candidate.internalWorkstreamId
    ? ignoredAssignedCount(database, candidate.internalWorkstreamId)
    : 0;
  const signals = buildSignals({
    candidate,
    bestThread,
    relatedThreads,
    latestEvidence,
    relatedFiles,
    terms,
    latestActivity,
    ignoredCount: Math.max(ignoredQueryMatches, ignoredAssigned),
  });

  return {
    workstream: {
      id: candidate.publicId ?? null,
      name: candidate.name,
      origin: candidate.origin,
    },
    score: candidate.score,
    confidence: confidenceFor(candidate.score),
    signals,
    latestActivity,
    cwd: bestThread.cwd,
    bestThread,
    relatedThreads,
    latestEvidence,
    relatedFiles,
  };
}

function buildSignals(input: {
  candidate: Candidate;
  bestThread: StateThread;
  relatedThreads: StateThread[];
  latestEvidence: StateEvidence[];
  relatedFiles: string[];
  terms: string[];
  latestActivity: string;
  ignoredCount: number;
}): StateSignal[] {
  const signals: StateSignal[] = [];
  if (input.candidate.origin === "manual") {
    signals.push({
      type: "manual-assignment",
      weight: 1,
      detail: `${input.relatedThreads.length} manually assigned active thread(s)`,
    });
  }
  if (input.candidate.aliasMatch) {
    signals.push({
      type: "alias-match",
      weight: 0.9,
      detail: `matched alias "${input.candidate.aliasMatch}"`,
    });
  }
  if (input.candidate.nameMatched) {
    signals.push({
      type: "workstream-name-match",
      weight: 0.65,
      detail: `query matched "${input.candidate.name}"`,
    });
  }
  if (termOverlap(input.bestThread.title ?? "", input.terms) > 0) {
    signals.push({
      type: "title-match",
      weight: 0.5,
      detail: `matched thread title "${input.bestThread.title}"`,
    });
  }
  const sharedCwd = sharedValue(input.relatedThreads.map((thread) => thread.cwd));
  if (
    termOverlap(input.bestThread.cwd ?? "", input.terms) > 0 ||
    (input.relatedThreads.length > 1 && sharedCwd)
  ) {
    signals.push({
      type: "cwd-match",
      weight: 0.3,
      detail: sharedCwd
        ? `${input.relatedThreads.length} related threads share ${sharedCwd}`
        : `query matched ${input.bestThread.cwd}`,
    });
  }
  const matchedFiles = input.relatedFiles.filter(
    (path) => termOverlap(path, input.terms) > 0,
  );
  if (matchedFiles.length > 0 || input.relatedThreads.length > 1) {
    signals.push({
      type: "file-reference-match",
      weight: 0.4,
      detail:
        matchedFiles.length > 0
          ? `matched ${matchedFiles.slice(0, 3).join(", ")}`
          : `${input.relatedFiles.length} normalized related file(s)`,
    });
  }
  const relevantEvidence = input.latestEvidence.filter((item) => item.relevance > 0);
  if (relevantEvidence.length > 0) {
    signals.push({
      type: "evidence-text-match",
      weight: 0.55,
      detail: `${relevantEvidence.length} relevant evidence excerpt(s)`,
    });
  }
  signals.push({
    type: "recency",
    weight: recencyWeight(input.latestActivity),
    detail: `latest activity ${input.latestActivity}`,
  });
  if (input.ignoredCount > 0) {
    signals.push({
      type: "ignored-thread-exclusion",
      weight: 0,
      detail: `excluded ${input.ignoredCount} ignored matching thread(s)`,
    });
  }
  return signals.sort(
    (left, right) => right.weight - left.weight || left.type.localeCompare(right.type),
  );
}

function loadAssignments(database: WorktrailDatabase): AssignmentRow[] {
  return database.raw
    .prepare(
      `SELECT w.id AS workstream_internal_id, w.public_id AS workstream_public_id,
              w.name AS workstream_name, t.external_id
       FROM workstream_assignments a
       JOIN workstreams w ON w.id = a.workstream_id AND w.status = 'active'
       JOIN source_threads t ON t.id = a.thread_id
       LEFT JOIN ignored_threads i ON i.thread_id = t.id
       WHERE i.thread_id IS NULL`,
    )
    .all() as AssignmentRow[];
}

function loadWorkstreamVocabulary(
  database: WorktrailDatabase,
): WorkstreamVocabulary[] {
  const rows = database.raw
    .prepare(
      `SELECT w.id, w.public_id, w.name, a.alias
       FROM workstreams w
       LEFT JOIN workstream_aliases a ON a.workstream_id = w.id
       WHERE w.status = 'active'
       ORDER BY w.id, a.normalized_alias`,
    )
    .all() as Array<{
    id: number;
    public_id: string;
    name: string;
    alias: string | null;
  }>;
  const output = new Map<number, WorkstreamVocabulary>();
  for (const row of rows) {
    const item = output.get(row.id) ?? {
      internalId: row.id,
      publicId: row.public_id,
      name: row.name,
      aliases: [],
    };
    if (row.alias) item.aliases.push(row.alias);
    output.set(row.id, item);
  }
  return [...output.values()];
}

function hasActiveAssignedThread(
  database: WorktrailDatabase,
  workstreamId: number,
): boolean {
  return Boolean(
    database.raw
      .prepare(
        `SELECT 1 FROM workstream_assignments a
         LEFT JOIN ignored_threads i ON i.thread_id = a.thread_id
         WHERE a.workstream_id = ? AND i.thread_id IS NULL LIMIT 1`,
      )
      .get(workstreamId),
  );
}

function assignedThreadRows(
  database: WorktrailDatabase,
  workstreamId: number,
): ThreadRow[] {
  return database.raw
    .prepare(
      `SELECT t.id, t.external_id, t.resume_ref, t.title, t.source_tool,
              t.archived, t.updated_at, t.cwd
       FROM workstream_assignments a
       JOIN source_threads t ON t.id = a.thread_id
       LEFT JOIN ignored_threads i ON i.thread_id = t.id
       WHERE a.workstream_id = ? AND i.thread_id IS NULL
       ORDER BY t.updated_at DESC`,
    )
    .all(workstreamId) as ThreadRow[];
}

function ignoredAssignedCount(
  database: WorktrailDatabase,
  workstreamId: number,
): number {
  return database.scalar(
    `SELECT count(*) FROM workstream_assignments a
     JOIN ignored_threads i ON i.thread_id = a.thread_id
     WHERE a.workstream_id = ?`,
    workstreamId,
  );
}

function threadRows(
  database: WorktrailDatabase,
  externalIds: string[],
): ThreadRow[] {
  if (externalIds.length === 0) return [];
  const placeholders = externalIds.map(() => "?").join(", ");
  return database.raw
    .prepare(
      `SELECT t.id, t.external_id, t.resume_ref, t.title, t.source_tool,
              t.archived, t.updated_at, t.cwd
       FROM source_threads t
       LEFT JOIN ignored_threads i ON i.thread_id = t.id
       WHERE t.external_id IN (${placeholders}) AND i.thread_id IS NULL`,
    )
    .all(...externalIds) as ThreadRow[];
}

function toStateThread(row: ThreadRow, score: number): StateThread {
  return {
    externalId: row.external_id,
    title: row.title,
    sourceTool: row.source_tool,
    archived: Boolean(row.archived),
    lastActivity: row.updated_at,
    cwd: row.cwd,
    resumeRef: row.resume_ref,
    score,
  };
}

function collectEvidence(
  database: WorktrailDatabase,
  threadIds: number[],
  terms: string[],
): StateEvidence[] {
  if (threadIds.length === 0) return [];
  const placeholders = threadIds.map(() => "?").join(", ");
  const rows = database.raw
    .prepare(
      `SELECT t.external_id, e.kind, e.excerpt, se.occurred_at, se.record_line
       FROM evidence e
       JOIN source_events se ON se.id = e.event_id
       JOIN source_threads t ON t.id = e.thread_id
       WHERE e.thread_id IN (${placeholders})
       ORDER BY se.occurred_at DESC, e.id DESC LIMIT 500`,
    )
    .all(...threadIds) as Array<{
    external_id: string;
    kind: string;
    excerpt: string;
    occurred_at: string;
    record_line: number;
  }>;
  return rows
    .map((row) => ({
      threadId: row.external_id,
      kind: row.kind,
      excerpt: row.excerpt,
      occurredAt: row.occurred_at,
      recordLine: row.record_line,
      relevance: termOverlap(row.excerpt, terms),
    }))
    .sort(
      (left, right) =>
        right.relevance - left.relevance ||
        right.occurredAt.localeCompare(left.occurredAt),
    )
    .slice(0, 6);
}

function collectFiles(
  database: WorktrailDatabase,
  threadIds: number[],
  terms: string[],
  rows: ThreadRow[],
): string[] {
  if (threadIds.length === 0) return [];
  const placeholders = threadIds.map(() => "?").join(", ");
  const files = (
    database.raw
      .prepare(
        `SELECT path FROM file_references WHERE thread_id IN (${placeholders})`,
      )
      .all(...threadIds) as Array<{ path: string }>
  ).map((row) => row.path);
  return normalizeRelatedFiles(
    files,
    rows.map((row) => row.cwd),
  )
    .sort(
      (left, right) =>
        termOverlap(right, terms) - termOverlap(left, terms) || left.localeCompare(right),
    )
    .slice(0, 12);
}

function shouldGroup(left: SearchResult, right: SearchResult): boolean {
  const sameCwd = Boolean(left.cwd && right.cwd && left.cwd === right.cwd);
  const leftFiles = new Set(meaningfulFiles(left.fileReferences));
  const sharedFiles = meaningfulFiles(right.fileReferences).filter((path) =>
    leftFiles.has(path),
  );
  const titleSimilarity = jaccard(
    identityTerms(left.title ?? ""),
    identityTerms(right.title ?? ""),
  );
  const recencyDays = Math.abs(
    Date.parse(left.lastActivity) - Date.parse(right.lastActivity),
  ) / 86_400_000;
  const recent = Number.isFinite(recencyDays) && recencyDays <= 30;
  if (sameCwd && sharedFiles.length >= 1) return true;
  if (titleSimilarity >= 0.6 && (sameCwd || sharedFiles.length >= 1)) return true;
  return sharedFiles.length >= 2 && recent;
}

function meaningfulFiles(files: string[]): string[] {
  return files.filter(
    (path) => !GENERIC_IDENTITY_FILES.has(basename(path).toLocaleLowerCase()),
  );
}

function identityTerms(value: string): string[] {
  const ignored = new Set(["add", "fix", "update", "implement", "work", "thread"]);
  return queryTerms(value).filter((term) => !ignored.has(term));
}

function jaccard(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((term) => rightSet.has(term)).length;
  return intersection / new Set([...leftSet, ...rightSet]).size;
}

function candidateName(seed: SearchResult): string {
  if (seed.title) return seed.title;
  if (seed.cwd) return `Work in ${basename(seed.cwd) || seed.cwd}`;
  return `Work related to ${seed.externalId}`;
}

function bestAliasMatch(query: string, aliases: string[]): string | undefined {
  return aliases
    .map((alias) => ({ alias, score: aliasMatchScore(query, alias) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.alias;
}

function aliasMatchScore(query: string, alias: string): number {
  const normalizedQuery = normalizePhrase(query);
  const normalizedAlias = normalizePhrase(alias);
  if (!normalizedAlias) return 0;
  if (normalizedQuery.includes(normalizedAlias)) return 0.99;
  const querySet = new Set(queryTerms(query));
  const aliasTerms = queryTerms(alias);
  if (aliasTerms.length === 0) return 0;
  const matched = aliasTerms.filter((term) => querySet.has(term)).length;
  if (matched === aliasTerms.length) return 0.9;
  if (matched >= 2 && matched / aliasTerms.length >= 0.75) return 0.82;
  return 0;
}

function lexicalScore(value: string, terms: string[]): number {
  const matched = termOverlap(value, terms);
  if (matched === 0) return 0;
  return Number(Math.min(0.97, 0.35 + (matched / terms.length) * 0.6).toFixed(3));
}

function termOverlap(value: string, terms: string[]): number {
  const normalized = value.toLocaleLowerCase();
  return terms.filter((term) => normalized.includes(term)).length;
}

function sharedValue(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length > 1 && new Set(present).size === 1 ? present[0] ?? null : null;
}

function recencyWeight(timestamp: string): number {
  const days = (Date.now() - Date.parse(timestamp)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) return 0;
  if (days <= 7) return 0.2;
  if (days <= 30) return 0.12;
  if (days <= 180) return 0.05;
  return 0;
}

function normalizePhrase(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function confidenceFor(score: number): "high" | "medium" | "low" {
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function originWeight(origin: "manual" | "candidate"): number {
  return origin === "manual" ? 1 : 0;
}
