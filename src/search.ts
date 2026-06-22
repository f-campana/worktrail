import { WorktrailDatabase } from "./db/database.js";
import { normalizeRelatedFiles } from "./files.js";

export type SearchEvidence = {
  kind: string;
  excerpt: string;
  occurredAt: string;
  recordLine: number;
};

export type SearchMatchDetails = {
  exactTitle: boolean;
  titlePhrase: boolean;
  titlePrefix: boolean;
  titleTerms: string[];
  projectExact: boolean;
  projectTerms: string[];
  meaningfulFileTerms: string[];
  genericFileTerms: string[];
  contentTerms: string[];
  matchedTerms: string[];
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
  matchDetails: SearchMatchDetails;
  aliasMatch?: string;
  projectMatch?: {
    kind: "identity" | "alias" | "path";
    projectName: string;
    matchedValue: string;
    keyKind: "git-common-dir" | "cwd";
    membershipConfidence: "high" | "medium" | "low";
  };
};

export type SearchOptions = {
  includeIgnored?: boolean;
  rankingLimit?: number;
  detailLimit?: number;
  selectionExcludeArchived?: boolean;
  selectionTieBreakByTitle?: boolean;
  timing?: (phase: SearchTimingPhase, durationMs: number) => void;
};

export type SearchTimingPhase =
  | "fts-candidates"
  | "identity-fallback"
  | "content-matches"
  | "candidate-ranking"
  | "workstream-aliases"
  | "project-identities"
  | "result-hydration";

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
  title_text: string;
  cwd_text: string;
  file_references: string;
  searchable_text: string;
};

const GENERIC_FILE_NAMES = new Set([
  ".gitignore",
  "app.js",
  "app.jsx",
  "app.ts",
  "app.tsx",
  "eslint.config.js",
  "eslint.config.mjs",
  "index.js",
  "index.jsx",
  "index.ts",
  "index.tsx",
  "main.js",
  "main.jsx",
  "main.ts",
  "main.tsx",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "profile.jsx",
  "profile.tsx",
  "providers.jsx",
  "providers.tsx",
  "readme.md",
  "skill.md",
  "tsconfig.json",
  "usercontext.js",
  "usercontext.ts",
  "vite.config.js",
  "vite.config.ts",
  "yarn.lock",
]);

export function searchThreads(
  database: WorktrailDatabase,
  query: string,
  limit = 5,
  options: SearchOptions = {},
): SearchResult[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const outputLimit = Math.max(1, Math.min(limit, 20));
  const candidateLimit = Math.max(100, outputLimit * 10);
  const ftsQuery = terms
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");

  const rows = measureSearch(options, "fts-candidates", () =>
    database.raw
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
         d.title AS title_text,
         d.cwd AS cwd_text,
         d.file_references,
         '' AS searchable_text
       FROM thread_search
       JOIN search_documents d ON d.thread_id = thread_search.rowid
       JOIN source_threads t ON t.id = d.thread_id
       LEFT JOIN ignored_threads i ON i.thread_id = t.id
       WHERE thread_search MATCH ?
         AND (? = 1 OR i.thread_id IS NULL)
       ORDER BY rank ASC, t.updated_at DESC
       LIMIT ?`,
      )
      .all(ftsQuery, Number(options.includeIgnored ?? false), candidateLimit),
  ) as RankedThreadRow[];

  const combinedRows = new Map(rows.map((row) => [row.external_id, row]));
  const fallbackRows = measureSearch(options, "identity-fallback", () =>
    identityFallbackRows(database, query, candidateLimit, options),
  );
  for (const row of fallbackRows) {
    combinedRows.set(row.external_id, row);
  }
  const combined = new Map<string, SearchResult>();
  measureSearch(options, "candidate-ranking", () => {
    for (const row of combinedRows.values()) {
      const matchDetails = analyzeMatch(row, query, terms);
      if (matchDetails.matchedTerms.length === 0) continue;
      const ranking = rankMatch(
        matchDetails,
        terms.length,
        Boolean(row.archived),
      );
      combined.set(row.external_id, toSearchResult(row, matchDetails, ranking));
    }
  });

  const aliasMatches = measureSearch(options, "workstream-aliases", () =>
    aliasThreadMatches(database, query, terms, options),
  );
  for (const result of aliasMatches) {
    const existing = combined.get(result.externalId);
    if (!existing || result.score > existing.score) {
      combined.set(result.externalId, result);
    } else if (result.aliasMatch) {
      existing.aliasMatch = result.aliasMatch;
    }
  }

  const projectMatches = measureSearch(options, "project-identities", () =>
    projectThreadMatches(database, query, terms, outputLimit, options),
  );
  for (const result of projectMatches) {
    const existing = combined.get(result.externalId);
    if (!existing || result.score > existing.score) {
      combined.set(result.externalId, result);
    } else if (result.projectMatch) {
      existing.projectMatch = result.projectMatch;
    }
  }

  const selectionResults = [...combined.values()].filter(
    (result) => !options.selectionExcludeArchived || !result.archived,
  );
  const preliminary = rankSearchResults(
    selectionResults,
    options.selectionTieBreakByTitle,
  );
  const maxContentScore = terms.length === 1 ? 0.34 : 0.6;
  const rankingLimit = Math.max(
    1,
    Math.min(options.rankingLimit ?? outputLimit, outputLimit),
  );
  const threshold = preliminary[rankingLimit - 1]?.score;
  const contentCandidateIds =
    threshold === undefined || threshold <= maxContentScore
      ? [...combinedRows.values()].map((row) => row.id)
      : preliminary.slice(0, rankingLimit).flatMap((result) => {
          const row = combinedRows.get(result.externalId);
          return row ? [row.id] : [];
        });
  const contentMatches = measureSearch(options, "content-matches", () =>
    contentTermMatches(database, terms, contentCandidateIds),
  );
  const contentCandidateSet = new Set(contentCandidateIds);
  for (const row of combinedRows.values()) {
    if (!contentCandidateSet.has(row.id)) continue;
    const matchDetails = analyzeMatch(
      row,
      query,
      terms,
      contentMatches.get(row.id),
    );
    if (matchDetails.matchedTerms.length === 0) continue;
    const ranking = rankMatch(
      matchDetails,
      terms.length,
      Boolean(row.archived),
    );
    const result = toSearchResult(row, matchDetails, ranking);
    const previous = combined.get(row.external_id);
    if (previous?.aliasMatch) result.aliasMatch = previous.aliasMatch;
    if (previous?.projectMatch) result.projectMatch = previous.projectMatch;
    if (previous && previous.score > result.score) {
      previous.matchDetails = matchDetails;
    } else {
      combined.set(row.external_id, result);
    }
  }

  const ranked = rankSearchResults(combined.values()).slice(0, outputLimit);
  const detailLimit = Math.max(
    0,
    Math.min(options.detailLimit ?? outputLimit, outputLimit),
  );
  const detailedIds = new Set(
    rankSearchResults(
      ranked.filter(
        (result) => !options.selectionExcludeArchived || !result.archived,
      ),
      options.selectionTieBreakByTitle,
    )
      .slice(0, detailLimit)
      .map((result) => result.externalId),
  );
  return measureSearch(options, "result-hydration", () =>
    ranked.map((result) =>
      detailedIds.has(result.externalId)
        ? hydrateSearchResult(database, result, terms)
        : result,
    ),
  );
}

function rankSearchResults(
  results: Iterable<SearchResult>,
  tieBreakByTitle = false,
): SearchResult[] {
  return [...results].sort(
    (left, right) =>
      right.score - left.score ||
      right.lastActivity.localeCompare(left.lastActivity) ||
      (tieBreakByTitle
        ? (left.title ?? left.externalId).localeCompare(
            right.title ?? right.externalId,
          )
        : 0) ||
      left.externalId.localeCompare(right.externalId),
  );
}

function measureSearch<T>(
  options: SearchOptions,
  phase: SearchTimingPhase,
  operation: () => T,
): T {
  const startedAt = performance.now();
  const result = operation();
  options.timing?.(phase, performance.now() - startedAt);
  return result;
}

function identityFallbackRows(
  database: WorktrailDatabase,
  query: string,
  limit: number,
  options: SearchOptions,
): RankedThreadRow[] {
  const compact = compactIdentity(query);
  if (compact.length < 4) return [];
  const compactTitle = compactSql("d.title");
  const compactCwd = compactSql("d.cwd");
  return database.raw
    .prepare(
      `SELECT t.id, t.external_id, t.resume_ref, t.title, t.source_tool,
              t.archived, t.updated_at, t.cwd, 0 AS rank,
              d.title AS title_text, d.cwd AS cwd_text,
              d.file_references, '' AS searchable_text
       FROM search_documents d
       JOIN source_threads t ON t.id = d.thread_id
       LEFT JOIN ignored_threads i ON i.thread_id = t.id
       WHERE (${compactTitle} LIKE ? OR ${compactCwd} LIKE ?)
         AND (? = 1 OR i.thread_id IS NULL)
       ORDER BY t.updated_at DESC
       LIMIT ?`,
    )
    .all(
      `%${compact}%`,
      `%${compact}%`,
      Number(options.includeIgnored ?? false),
      limit,
    ) as RankedThreadRow[];
}

function compactSql(column: string): string {
  return `replace(replace(replace(replace(replace(replace(replace(lower(${column}), '-', ''), '_', ''), ' ', ''), '.', ''), '/', ''), '|', ''), ':', '')`;
}

function analyzeMatch(
  row: RankedThreadRow,
  query: string,
  terms: string[],
  matchedContentTerms?: ReadonlySet<string>,
): SearchMatchDetails {
  const title = row.title_text;
  const titleTerms = terms.filter((term) => containsTerm(title, term));
  const titleTokens = queryTerms(title);
  const queryPhrase = normalizePhrase(query);
  const exactTitle =
    queryPhrase.length > 0 && normalizePhrase(title) === queryPhrase;
  const titlePhrase =
    terms.length > 1 && containsTokenSequence(titleTokens, terms);
  const titlePrefix = title
    .split(/[|:—]/u)
    .slice(0, -1)
    .some((part) => compactIdentity(part) === compactIdentity(query));

  const projectName = pathBasename(row.cwd_text);
  const projectTerms = terms.filter((term) =>
    containsIdentity(projectName, term),
  );
  const projectExact =
    compactIdentity(projectName).length > 0 &&
    compactIdentity(projectName) === compactIdentity(query);

  const files = row.file_references.split("\n").filter(Boolean);
  const meaningfulFileTerms: string[] = [];
  const genericFileTerms: string[] = [];
  for (const term of terms) {
    const matches = files.filter((file) => containsIdentity(file, term));
    if (matches.length === 0) continue;
    const meaningful = matches.some((file) => {
      const basename = pathBasename(file).toLocaleLowerCase();
      const directory = file.slice(
        0,
        Math.max(0, file.length - basename.length),
      );
      return (
        containsIdentity(directory, term) || !GENERIC_FILE_NAMES.has(basename)
      );
    });
    if (meaningful) meaningfulFileTerms.push(term);
    else genericFileTerms.push(term);
  }

  const contentTerms = matchedContentTerms
    ? terms.filter((term) => matchedContentTerms.has(term))
    : terms.filter((term) => containsTerm(row.searchable_text, term));
  const matchedTerms = unique([
    ...titleTerms,
    ...projectTerms,
    ...meaningfulFileTerms,
    ...genericFileTerms,
    ...contentTerms,
  ]);

  return {
    exactTitle,
    titlePhrase,
    titlePrefix,
    titleTerms,
    projectExact,
    projectTerms,
    meaningfulFileTerms,
    genericFileTerms,
    contentTerms,
    matchedTerms,
  };
}

function contentTermMatches(
  database: WorktrailDatabase,
  terms: string[],
  threadIds: number[],
): Map<number, Set<string>> {
  const matches = new Map<number, Set<string>>();
  if (threadIds.length === 0) return matches;
  const patterns = new Map<string, RegExp>();
  database.raw.function(
    "worktrail_contains_term",
    { deterministic: true, directOnly: true },
    (value, term) => {
      if (typeof value !== "string" || typeof term !== "string") return 0;
      let pattern = patterns.get(term);
      if (!pattern) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        pattern = new RegExp(
          `(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`,
          "iu",
        );
        patterns.set(term, pattern);
      }
      return pattern.test(value) ? 1 : 0;
    },
  );
  const placeholders = threadIds.map(() => "?").join(",");
  for (const term of terms) {
    const rows = database.raw
      .prepare(
        `SELECT thread_id
         FROM search_documents
         WHERE thread_id IN (${placeholders})
           AND worktrail_contains_term(searchable_text, ?) = 1`,
      )
      .all(...threadIds, term) as Array<{
      thread_id: number;
    }>;
    for (const row of rows) {
      const rowMatches = matches.get(row.thread_id) ?? new Set<string>();
      rowMatches.add(term);
      matches.set(row.thread_id, rowMatches);
    }
  }
  return matches;
}

function rankMatch(
  details: SearchMatchDetails,
  termCount: number,
  archived: boolean,
): { score: number; confidence: SearchResult["confidence"] } {
  const titleCoverage = details.titleTerms.length / termCount;
  const projectCoverage = details.projectTerms.length / termCount;
  const meaningfulFileCoverage = details.meaningfulFileTerms.length / termCount;
  const genericFileCoverage = details.genericFileTerms.length / termCount;
  const contentCoverage = details.contentTerms.length / termCount;
  const overallCoverage = details.matchedTerms.length / termCount;
  const strongTitle =
    details.exactTitle ||
    details.titlePrefix ||
    details.titlePhrase ||
    (termCount > 1 && titleCoverage === 1);
  const strongProject =
    details.projectExact || (termCount > 1 && projectCoverage === 1);

  const titleScore = details.exactTitle
    ? 0.99
    : details.titlePrefix
      ? 0.985
      : details.titlePhrase
        ? 0.98
        : termCount > 1 && titleCoverage === 1
          ? 0.88
          : titleCoverage > 0
            ? termCount === 1
              ? 0.72
              : 0.6 + titleCoverage * 0.18
            : 0;
  const projectScore = details.projectExact
    ? 0.94
    : termCount > 1 && projectCoverage === 1
      ? 0.87
      : projectCoverage > 0
        ? 0.62 + projectCoverage * 0.12
        : 0;
  const meaningfulFileScore =
    meaningfulFileCoverage > 0 ? 0.56 + meaningfulFileCoverage * 0.12 : 0;
  const genericFileScore =
    genericFileCoverage > 0 ? 0.28 + genericFileCoverage * 0.08 : 0;
  const contentScore =
    contentCoverage === 0
      ? 0
      : termCount === 1
        ? 0.34
        : contentCoverage === 1
          ? 0.56
          : 0.4 + contentCoverage * 0.12;

  let score = Math.max(
    titleScore,
    projectScore,
    meaningfulFileScore,
    genericFileScore,
    contentScore,
  );
  if (termCount > 1 && overallCoverage === 1 && score < 0.82) score += 0.04;
  if (details.projectExact && details.titleTerms.length > 0) score += 0.02;
  if (archived) score -= strongTitle || strongProject ? 0.03 : 0.1;

  const confidence: SearchResult["confidence"] =
    strongTitle || strongProject
      ? "high"
      : details.titleTerms.length > 0 ||
          details.projectTerms.length > 0 ||
          details.meaningfulFileTerms.length > 0 ||
          (termCount > 1 && overallCoverage >= 0.5)
        ? "medium"
        : "low";
  return {
    score: Number(Math.min(0.99, Math.max(0, score)).toFixed(3)),
    confidence,
  };
}

function toSearchResult(
  row: RankedThreadRow,
  matchDetails: SearchMatchDetails,
  ranking: { score: number; confidence: SearchResult["confidence"] },
): SearchResult {
  return {
    externalId: row.external_id,
    resumeRef: row.resume_ref,
    ...(row.title ? { title: row.title } : {}),
    sourceTool: row.source_tool,
    archived: Boolean(row.archived),
    lastActivity: row.updated_at,
    ...(row.cwd ? { cwd: row.cwd } : {}),
    ...ranking,
    evidence: [],
    fileReferences: [],
    matchDetails,
  };
}

function hydrateSearchResult(
  database: WorktrailDatabase,
  result: SearchResult,
  terms: string[],
): SearchResult {
  const row = database.raw
    .prepare("SELECT id, cwd FROM source_threads WHERE external_id = ?")
    .get(result.externalId) as { id: number; cwd: string | null } | undefined;
  if (!row) return result;
  return {
    ...result,
    evidence: matchingEvidence(database, row.id, terms),
    fileReferences: matchingFiles(database, row.id, terms, row.cwd),
  };
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
      overlap: terms.filter((term) => containsTerm(row.excerpt, term)).length,
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
              t.archived, t.updated_at, t.cwd, a.alias,
              d.title AS title_text, d.cwd AS cwd_text,
              d.file_references, '' AS searchable_text, 0 AS rank
       FROM workstream_aliases a
       JOIN workstreams w ON w.id = a.workstream_id AND w.status = 'active'
       JOIN workstream_assignments wa ON wa.workstream_id = w.id
       JOIN source_threads t ON t.id = wa.thread_id
       JOIN search_documents d ON d.thread_id = t.id
       LEFT JOIN ignored_threads i ON i.thread_id = t.id
       WHERE (? = 1 OR i.thread_id IS NULL)`,
    )
    .all(Number(options.includeIgnored ?? false)) as Array<
    RankedThreadRow & { alias: string }
  >;
  const contentMatches = contentTermMatches(
    database,
    terms,
    rows.map((row) => row.id),
  );
  const best = new Map<string, SearchResult>();
  for (const row of rows) {
    const ranking = aliasScore(query, row.alias, Boolean(row.archived));
    if (!ranking) continue;
    const matchDetails = analyzeMatch(
      row,
      query,
      terms,
      contentMatches.get(row.id),
    );
    const result = toSearchResult(row, matchDetails, ranking);
    result.aliasMatch = row.alias;
    const previous = best.get(row.external_id);
    if (!previous || result.score > previous.score)
      best.set(row.external_id, result);
  }
  return [...best.values()];
}

function aliasScore(
  query: string,
  alias: string,
  archived: boolean,
): { score: number; confidence: SearchResult["confidence"] } | undefined {
  const normalizedQuery = normalizePhrase(query);
  const normalizedAlias = normalizePhrase(alias);
  if (!normalizedAlias) return undefined;
  const exact =
    normalizedQuery === normalizedAlias ||
    compactIdentity(query) === compactIdentity(alias);
  const querySet = new Set(queryTerms(query));
  const aliasTerms = queryTerms(alias);
  const matched = aliasTerms.filter((term) => querySet.has(term)).length;
  if (!exact && (matched < aliasTerms.length || aliasTerms.length === 0))
    return undefined;
  const score = (exact ? 0.97 : 0.88) - (archived ? 0.03 : 0);
  return { score: Number(score.toFixed(3)), confidence: "high" };
}

function projectThreadMatches(
  database: WorktrailDatabase,
  query: string,
  terms: string[],
  limit: number,
  options: SearchOptions,
): SearchResult[] {
  const rows = database.raw
    .prepare(
      `SELECT t.id, t.external_id, t.resume_ref, t.title, t.source_tool,
              t.archived, t.updated_at, t.cwd, p.name AS project_name,
              p.key_kind, p.display_path, m.confidence AS membership_confidence,
              group_concat(a.alias, char(10)) AS project_aliases
       FROM project_thread_memberships m
       JOIN project_identities p
         ON p.id = m.project_id AND p.status = 'active'
       JOIN source_threads t ON t.id = m.thread_id
       LEFT JOIN project_aliases a ON a.project_id = p.id
       LEFT JOIN ignored_threads i ON i.thread_id = t.id
       WHERE m.role = 'primary' AND (? = 1 OR i.thread_id IS NULL)
       GROUP BY t.id, p.id
       ORDER BY t.updated_at DESC, t.external_id`,
    )
    .all(Number(options.includeIgnored ?? false)) as Array<
    Pick<
      RankedThreadRow,
      | "id"
      | "external_id"
      | "resume_ref"
      | "title"
      | "source_tool"
      | "archived"
      | "updated_at"
      | "cwd"
    > & {
      project_name: string;
      key_kind: "git-common-dir" | "cwd";
      display_path: string | null;
      membership_confidence: "high" | "medium" | "low";
      project_aliases: string | null;
    }
  >;
  const candidates = rows.flatMap((row) => {
    const project = projectScore(
      query,
      terms,
      row.project_name,
      row.display_path,
      row.project_aliases?.split("\n") ?? [],
      Boolean(row.archived),
    );
    return project ? [{ row, project }] : [];
  });
  candidates.sort(
    (left, right) =>
      right.project.ranking.score - left.project.ranking.score ||
      right.row.updated_at.localeCompare(left.row.updated_at) ||
      left.row.external_id.localeCompare(right.row.external_id),
  );

  const output: SearchResult[] = [];
  const selected = candidates.slice(0, limit);
  const contentMatches = contentTermMatches(
    database,
    terms,
    selected.map(({ row }) => row.id),
  );
  for (const { row, project } of selected) {
    const document = database.raw
      .prepare(
        `SELECT title AS title_text, cwd AS cwd_text,
                file_references, '' AS searchable_text
         FROM search_documents WHERE thread_id = ?`,
      )
      .get(row.id) as
      | Pick<
          RankedThreadRow,
          "title_text" | "cwd_text" | "file_references" | "searchable_text"
        >
      | undefined;
    if (!document) continue;
    const rankedRow: RankedThreadRow = { ...row, ...document, rank: 0 };
    const details = analyzeMatch(
      rankedRow,
      query,
      terms,
      contentMatches.get(row.id),
    );
    const result = toSearchResult(rankedRow, details, project.ranking);
    result.projectMatch = {
      kind: project.kind,
      projectName: row.project_name,
      matchedValue: project.matchedValue,
      keyKind: row.key_kind,
      membershipConfidence: row.membership_confidence,
    };
    output.push(result);
  }
  return output;
}

function projectScore(
  query: string,
  terms: string[],
  name: string,
  displayPath: string | null,
  aliases: string[],
  archived: boolean,
):
  | {
      kind: "identity" | "alias" | "path";
      matchedValue: string;
      ranking: { score: number; confidence: SearchResult["confidence"] };
    }
  | undefined {
  const compactQuery = compactIdentity(query);
  const alias = aliases.find(
    (candidate) => compactIdentity(candidate) === compactQuery,
  );
  if (alias) {
    return {
      kind: "alias",
      matchedValue: alias,
      ranking: {
        score: Number((0.97 - (archived ? 0.03 : 0)).toFixed(3)),
        confidence: "high",
      },
    };
  }

  const nameTerms = queryTerms(name);
  const nameSet = new Set(nameTerms);
  const nameExact = compactIdentity(name) === compactQuery;
  const nameCoverage =
    terms.filter((term) => nameSet.has(term)).length / terms.length;
  if (nameExact || (terms.length > 1 && nameCoverage === 1)) {
    return {
      kind: "identity",
      matchedValue: name,
      ranking: {
        score: Number(
          ((nameExact ? 0.96 : 0.88) - (archived ? 0.03 : 0)).toFixed(3),
        ),
        confidence: "high",
      },
    };
  }
  if (nameCoverage > 0) {
    return {
      kind: "identity",
      matchedValue: name,
      ranking: {
        score: Number(
          (0.66 + nameCoverage * 0.12 - (archived ? 0.1 : 0)).toFixed(3),
        ),
        confidence: "medium",
      },
    };
  }

  if (displayPath) {
    const pathTerms = terms.filter((term) =>
      containsIdentity(displayPath, term),
    );
    const pathExact =
      compactIdentity(pathBasename(displayPath)) === compactQuery;
    if (pathExact || (terms.length > 1 && pathTerms.length === terms.length)) {
      return {
        kind: "path",
        matchedValue: query,
        ranking: {
          score: Number(
            ((pathExact ? 0.92 : 0.84) - (archived ? 0.03 : 0)).toFixed(3),
          ),
          confidence: "high",
        },
      };
    }
  }
  return undefined;
}

function fileScore(path: string, terms: string[]): number {
  const basename = pathBasename(path).toLocaleLowerCase();
  const genericPenalty = GENERIC_FILE_NAMES.has(basename) ? 0.25 : 1;
  return (
    terms.filter((term) => containsIdentity(path, term)).length * genericPenalty
  );
}

function containsTerm(value: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`,
    "iu",
  ).test(value);
}

function containsIdentity(value: string, term: string): boolean {
  const compactTerm = compactIdentity(term);
  return (
    containsTerm(value, term) ||
    (compactTerm.length >= 4 && compactIdentity(value).includes(compactTerm))
  );
}

function containsTokenSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  return haystack.some((_, index) =>
    needle.every((term, offset) => haystack[index + offset] === term),
  );
}

function pathBasename(value: string): string {
  return value.split(/[\\/]/u).filter(Boolean).at(-1) ?? "";
}

function normalizePhrase(value: string): string {
  return queryTerms(value).join(" ");
}

function compactIdentity(value: string): string {
  return queryTerms(value).join("");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}_]+/gu)
        ?.filter((term) => term.length >= 2) ?? [],
    ),
  ].slice(0, 16);
}
