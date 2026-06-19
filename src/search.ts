import { WorktrailDatabase } from "./db/database.js";
import { normalizeRelatedFiles } from "./files.js";

export type SearchEvidence = {
  kind: string;
  excerpt: string;
  occurredAt: string;
  recordLine: number;
};

export type SearchResult = {
  externalId: string;
  resumeRef: string;
  title?: string;
  sourceTool: string;
  archived: boolean;
  lastActivity: string;
  cwd?: string;
  score: number;
  confidence: "high" | "medium" | "low";
  evidence: SearchEvidence[];
  fileReferences: string[];
  aliasMatch?: string;
};

export type SearchOptions = {
  includeIgnored?: boolean;
};

type RankedThreadRow = {
  id: number;
  external_id: string;
  resume_ref: string;
  title: string | null;
  source_tool: string;
  archived: number;
  updated_at: string;
  cwd: string | null;
  rank: number;
  document_text: string;
};

export function searchThreads(
  database: WorktrailDatabase,
  query: string,
  limit = 5,
  options: SearchOptions = {},
): SearchResult[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const ftsQuery = terms
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");

  const rows = database.raw
    .prepare(
      `SELECT
         t.id,
         t.external_id,
         t.resume_ref,
         t.title,
         t.source_tool,
         t.archived,
         t.updated_at,
         t.cwd,
         bm25(thread_search, 8.0, 3.0, 4.0, 1.0) AS rank,
         (d.title || '\n' || d.cwd || '\n' || d.file_references || '\n' || d.searchable_text) AS document_text
       FROM thread_search
       JOIN search_documents d ON d.thread_id = thread_search.rowid
       JOIN source_threads t ON t.id = d.thread_id
       LEFT JOIN ignored_threads i ON i.thread_id = t.id
       WHERE thread_search MATCH ?
         AND (? = 1 OR i.thread_id IS NULL)
       ORDER BY rank ASC, t.updated_at DESC
       LIMIT ?`,
    )
    .all(
      ftsQuery,
      Number(options.includeIgnored ?? false),
      Math.max(1, Math.min(limit, 20)),
    ) as RankedThreadRow[];

  const lexicalResults: SearchResult[] = rows.map((row) => {
    const normalizedDocument = row.document_text.toLocaleLowerCase();
    const matchedTerms = terms.filter((term) =>
      normalizedDocument.includes(term),
    );
    const coverage = matchedTerms.length / terms.length;
    const score = Math.min(
      0.99,
      Number(
        (0.35 + coverage * 0.6 + Math.min(0.04, Math.abs(row.rank))).toFixed(3),
      ),
    );
    const confidence: SearchResult["confidence"] =
      coverage >= 0.75 ? "high" : coverage >= 0.4 ? "medium" : "low";

    return {
      externalId: row.external_id,
      resumeRef: row.resume_ref,
      ...(row.title ? { title: row.title } : {}),
      sourceTool: row.source_tool,
      archived: Boolean(row.archived),
      lastActivity: row.updated_at,
      ...(row.cwd ? { cwd: row.cwd } : {}),
      score,
      confidence,
      evidence: matchingEvidence(database, row.id, terms),
      fileReferences: matchingFiles(database, row.id, terms, row.cwd),
    };
  });
  const combined = new Map(
    lexicalResults.map((result) => [result.externalId, result]),
  );
  for (const result of aliasThreadMatches(database, query, terms, options)) {
    const existing = combined.get(result.externalId);
    if (!existing || result.score > existing.score)
      combined.set(result.externalId, result);
    else if (result.aliasMatch) existing.aliasMatch = result.aliasMatch;
  }
  return [...combined.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.lastActivity.localeCompare(left.lastActivity),
    )
    .slice(0, Math.max(1, Math.min(limit, 20)));
}

function matchingEvidence(
  database: WorktrailDatabase,
  threadId: number,
  terms: string[],
): SearchEvidence[] {
  const rows = database.raw
    .prepare(
      `SELECT e.kind, e.excerpt, se.occurred_at, se.record_line
       FROM evidence e
       JOIN source_events se ON se.id = e.event_id
       WHERE e.thread_id = ?
       ORDER BY se.occurred_at DESC, e.id DESC`,
    )
    .all(threadId) as Array<{
    kind: string;
    excerpt: string;
    occurred_at: string;
    record_line: number;
  }>;

  return rows
    .map((row) => ({
      row,
      overlap: terms.filter((term) =>
        row.excerpt.toLocaleLowerCase().includes(term),
      ).length,
    }))
    .filter((candidate) => candidate.overlap > 0)
    .sort(
      (left, right) =>
        right.overlap - left.overlap ||
        right.row.occurred_at.localeCompare(left.row.occurred_at),
    )
    .slice(0, 3)
    .map(({ row }) => ({
      kind: row.kind,
      excerpt: row.excerpt,
      occurredAt: row.occurred_at,
      recordLine: row.record_line,
    }));
}

function matchingFiles(
  database: WorktrailDatabase,
  threadId: number,
  terms: string[],
  cwd: string | null,
): string[] {
  const rows = database.raw
    .prepare(
      "SELECT DISTINCT path FROM file_references WHERE thread_id = ? ORDER BY path",
    )
    .all(threadId) as Array<{ path: string }>;
  return normalizeRelatedFiles(
    rows.map((row) => row.path),
    [cwd],
  )
    .sort((left, right) => fileScore(right, terms) - fileScore(left, terms))
    .slice(0, 8);
}

function aliasThreadMatches(
  database: WorktrailDatabase,
  query: string,
  terms: string[],
  options: SearchOptions,
): SearchResult[] {
  const rows = database.raw
    .prepare(
      `SELECT t.id, t.external_id, t.resume_ref, t.title, t.source_tool,
              t.archived, t.updated_at, t.cwd, a.alias
       FROM workstream_aliases a
       JOIN workstreams w ON w.id = a.workstream_id AND w.status = 'active'
       JOIN workstream_assignments wa ON wa.workstream_id = w.id
       JOIN source_threads t ON t.id = wa.thread_id
       LEFT JOIN ignored_threads i ON i.thread_id = t.id
       WHERE (? = 1 OR i.thread_id IS NULL)`,
    )
    .all(Number(options.includeIgnored ?? false)) as Array<{
    id: number;
    external_id: string;
    resume_ref: string;
    title: string | null;
    source_tool: string;
    archived: number;
    updated_at: string;
    cwd: string | null;
    alias: string;
  }>;
  const best = new Map<string, SearchResult>();
  for (const row of rows) {
    const score = aliasScore(query, row.alias);
    if (score === 0) continue;
    const result: SearchResult = {
      externalId: row.external_id,
      resumeRef: row.resume_ref,
      ...(row.title ? { title: row.title } : {}),
      sourceTool: row.source_tool,
      archived: Boolean(row.archived),
      lastActivity: row.updated_at,
      ...(row.cwd ? { cwd: row.cwd } : {}),
      score,
      confidence: score >= 0.85 ? "high" : "medium",
      evidence: matchingEvidence(database, row.id, terms),
      fileReferences: matchingFiles(database, row.id, terms, row.cwd),
      aliasMatch: row.alias,
    };
    const previous = best.get(row.external_id);
    if (!previous || result.score > previous.score)
      best.set(row.external_id, result);
  }
  return [...best.values()];
}

function aliasScore(query: string, alias: string): number {
  const normalizedQuery = query.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const normalizedAlias = alias.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  if (!normalizedAlias) return 0;
  if (normalizedQuery.includes(normalizedAlias)) return 0.99;
  const querySet = new Set(queryTerms(query));
  const aliasTerms = queryTerms(alias);
  const matched = aliasTerms.filter((term) => querySet.has(term)).length;
  if (matched === aliasTerms.length) return 0.9;
  if (matched >= 2 && matched / aliasTerms.length >= 0.75) return 0.82;
  return 0;
}

function fileScore(path: string, terms: string[]): number {
  const normalized = path.toLocaleLowerCase();
  return terms.filter((term) => normalized.includes(term)).length;
}

export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}_-]+/gu)
        ?.filter((term) => term.length >= 2) ?? [],
    ),
  ].slice(0, 16);
}
