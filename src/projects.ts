import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import type { WorktrailDatabase } from "./db/database.js";
import { TEXT_LIMITS } from "./limits.js";
import { redactAndBound } from "./redaction.js";

export type ProjectKeyKind = "git-common-dir" | "cwd";
export type ProjectConfidence = "high" | "medium";

export type ProjectIdentity = {
  id: string;
  keyKind: ProjectKeyKind;
  name: string;
  displayPath?: string;
  confidence: ProjectConfidence;
  status: "active" | "merged";
  threadCount: number;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectAlias = {
  projectId: string;
  projectName: string;
  alias: string;
  source: "manual" | "source";
  createdAt: string;
};

export type ProjectResolutionInput = {
  sourceThreadId: number;
  adapterId: string;
  rawCwd?: string;
  displayCwd?: string;
  title?: string;
  observedAt: string;
  archived?: boolean;
};

export type ProjectIdentityResolution = {
  keyKind: ProjectKeyKind;
  opaqueKey: string;
  name: string;
  displayPath: string;
  confidence: ProjectConfidence;
  observationType: "git-common-dir" | "cwd";
};

export type ProjectReconciliationDiagnostic = {
  sourceId: number;
  threadId: number;
  code: "project-path-unavailable";
  detail: string;
};

type ProjectRow = {
  id: number;
  public_id: string;
  name: string;
  normalized_name: string;
  status: "active" | "merged";
};

const GIT_TIMEOUT_MS = 2_000;
const GIT_OUTPUT_LIMIT = 4_096;

/** Resolves local project context without persisting raw filesystem keys. */
export function resolveProjectIdentity(
  input: ProjectResolutionInput,
): ProjectIdentityResolution | undefined {
  const cwd = expandLocalCwd(input.rawCwd ?? input.displayCwd);
  if (!cwd) return undefined;

  let canonicalCwd: string;
  try {
    if (!statSync(cwd).isDirectory()) return undefined;
    canonicalCwd = realpathSync(cwd);
  } catch {
    return undefined;
  }

  const commonDirectory = gitCommonDirectory(canonicalCwd);
  if (commonDirectory) {
    const repositoryRoot =
      basename(commonDirectory) === ".git"
        ? dirname(commonDirectory)
        : commonDirectory;
    return projectResolution(
      "git-common-dir",
      commonDirectory,
      repositoryRoot,
      "high",
    );
  }

  return projectResolution("cwd", canonicalCwd, canonicalCwd, "medium");
}

export function reconcileProjectIdentities(
  database: WorktrailDatabase,
  adapterId: string,
  rawCwds: ReadonlyMap<number, string> = new Map(),
): ProjectReconciliationDiagnostic[] {
  const rows = database.raw
    .prepare(
      `SELECT id, source_id, adapter_id, cwd, title, updated_at, archived
       FROM source_threads
       WHERE adapter_id = ?
       ORDER BY id`,
    )
    .all(adapterId) as Array<{
    id: number;
    source_id: number;
    adapter_id: string;
    cwd: string | null;
    title: string | null;
    updated_at: string;
    archived: number;
  }>;
  const diagnostics: ProjectReconciliationDiagnostic[] = [];

  for (const row of rows) {
    const rawCwd = rawCwds.get(row.id);
    const resolution = resolveProjectIdentity({
      sourceThreadId: row.id,
      adapterId: row.adapter_id,
      ...(rawCwd ? { rawCwd } : {}),
      ...(row.cwd ? { displayCwd: row.cwd } : {}),
      ...(row.title ? { title: row.title } : {}),
      observedAt: row.updated_at,
      archived: Boolean(row.archived),
    });
    if (!resolution) {
      if (row.cwd || rawCwds.has(row.id)) {
        diagnostics.push({
          sourceId: row.source_id,
          threadId: row.id,
          code: "project-path-unavailable",
          detail:
            "Project identity was not refreshed because the launch directory is missing or unusable.",
        });
      }
      continue;
    }
    upsertResolvedProject(
      database,
      row.id,
      row.adapter_id,
      row.updated_at,
      resolution,
    );
  }

  return diagnostics;
}

export function listProjects(database: WorktrailDatabase): ProjectIdentity[] {
  const rows = database.raw
    .prepare(
      `SELECT p.public_id, p.key_kind, p.name, p.display_path, p.confidence,
              p.status, p.created_at, p.updated_at,
              count(DISTINCT m.thread_id) AS thread_count,
              (SELECT group_concat(a.alias, char(10))
               FROM project_aliases a
               WHERE a.project_id = p.id) AS aliases
       FROM project_identities p
       LEFT JOIN project_thread_memberships m
         ON m.project_id = p.id AND m.role = 'primary'
       GROUP BY p.id
       ORDER BY p.name, p.public_id`,
    )
    .all() as Array<{
    public_id: string;
    key_kind: ProjectKeyKind;
    name: string;
    display_path: string | null;
    confidence: ProjectConfidence;
    status: "active" | "merged";
    created_at: string;
    updated_at: string;
    thread_count: number;
    aliases: string | null;
  }>;
  return rows.map((row) => ({
    id: row.public_id,
    keyKind: row.key_kind,
    name: row.name,
    ...(row.display_path ? { displayPath: row.display_path } : {}),
    confidence: row.confidence,
    status: row.status,
    threadCount: Number(row.thread_count),
    aliases: (row.aliases?.split("\n") ?? []).sort(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function listProjectAliases(
  database: WorktrailDatabase,
  identifier?: string,
): ProjectAlias[] {
  const project = identifier
    ? requireActiveProject(database, identifier)
    : undefined;
  const rows = database.raw
    .prepare(
      `SELECT p.public_id, p.name, a.alias, a.source, a.created_at
       FROM project_aliases a
       JOIN project_identities p ON p.id = a.project_id
       WHERE (? IS NULL OR p.id = ?)
       ORDER BY a.normalized_alias, p.public_id`,
    )
    .all(project?.id ?? null, project?.id ?? null) as Array<{
    public_id: string;
    name: string;
    alias: string;
    source: "manual" | "source";
    created_at: string;
  }>;
  return rows.map((row) => ({
    projectId: row.public_id,
    projectName: row.name,
    alias: row.alias,
    source: row.source,
    createdAt: row.created_at,
  }));
}

export function addProjectAlias(
  database: WorktrailDatabase,
  projectIdentifier: string,
  requestedAlias: string,
): ProjectAlias {
  const project = requireActiveProject(database, projectIdentifier);
  const alias = cleanAlias(requestedAlias);
  const normalizedAlias = normalizeProjectVocabulary(alias);
  assertVocabularyAvailable(database, project.id, normalizedAlias, alias);
  const existing = database.raw
    .prepare(
      "SELECT alias, source, created_at FROM project_aliases WHERE project_id = ? AND normalized_alias = ?",
    )
    .get(project.id, normalizedAlias) as
    | { alias: string; source: "manual" | "source"; created_at: string }
    | undefined;
  if (existing) {
    return {
      projectId: project.public_id,
      projectName: project.name,
      alias: existing.alias,
      source: existing.source,
      createdAt: existing.created_at,
    };
  }

  const now = new Date().toISOString();
  database.transaction(() => {
    database.raw
      .prepare(
        `INSERT INTO project_aliases(
           project_id, alias, normalized_alias, source, created_at, updated_at
         ) VALUES (?, ?, ?, 'manual', ?, ?)`,
      )
      .run(project.id, alias, normalizedAlias, now, now);
    database.raw
      .prepare("UPDATE project_identities SET updated_at = ? WHERE id = ?")
      .run(now, project.id);
    recordProjectCorrection(
      database,
      project.id,
      "project.alias.add",
      {
        projectId: project.public_id,
        alias,
      },
      now,
    );
  });
  return {
    projectId: project.public_id,
    projectName: project.name,
    alias,
    source: "manual",
    createdAt: now,
  };
}

export function removeProjectAlias(
  database: WorktrailDatabase,
  requestedAlias: string,
): boolean {
  const alias = cleanAlias(requestedAlias);
  const normalized = normalizeProjectVocabulary(alias);
  const compact = compactProjectVocabulary(alias);
  const rows = database.raw
    .prepare(
      `SELECT a.id, a.alias, a.normalized_alias, a.project_id,
              p.public_id, p.name
       FROM project_aliases a
       JOIN project_identities p ON p.id = a.project_id
       WHERE p.status = 'active'`,
    )
    .all() as Array<{
    id: number;
    alias: string;
    normalized_alias: string;
    project_id: number;
    public_id: string;
    name: string;
  }>;
  const matches = rows.filter(
    (row) =>
      row.normalized_alias === normalized ||
      compactProjectVocabulary(row.alias) === compact,
  );
  if (matches.length === 0) return false;
  if (matches.length > 1) {
    throw new Error(`Project alias is ambiguous: ${requestedAlias}`);
  }
  const match = matches[0]!;
  const now = new Date().toISOString();
  database.transaction(() => {
    database.raw
      .prepare("DELETE FROM project_aliases WHERE id = ?")
      .run(match.id);
    database.raw
      .prepare("UPDATE project_identities SET updated_at = ? WHERE id = ?")
      .run(now, match.project_id);
    recordProjectCorrection(
      database,
      match.project_id,
      "project.alias.remove",
      {
        projectId: match.public_id,
        alias: match.alias,
      },
      now,
    );
  });
  return true;
}

export function normalizeProjectVocabulary(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

export function compactProjectVocabulary(value: string): string {
  return (
    value
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.join("") ?? ""
  );
}

function upsertResolvedProject(
  database: WorktrailDatabase,
  threadId: number,
  adapterId: string,
  observedAt: string,
  resolution: ProjectIdentityResolution,
): void {
  const existing = database.raw
    .prepare(
      "SELECT id FROM project_identities WHERE key_kind = ? AND opaque_key = ?",
    )
    .get(resolution.keyKind, resolution.opaqueKey) as
    | { id: number }
    | undefined;
  const now = new Date().toISOString();
  let projectId = existing?.id;
  database.transaction(() => {
    if (projectId) {
      database.raw
        .prepare(
          `UPDATE project_identities
           SET display_path = ?, confidence = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(resolution.displayPath, resolution.confidence, now, projectId);
    } else {
      const name = uniqueDerivedName(
        database,
        resolution.name,
        resolution.opaqueKey,
      );
      const inserted = database.raw
        .prepare(
          `INSERT INTO project_identities(
             public_id, key_kind, opaque_key, name, normalized_name,
             display_path, confidence, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(
          `prj_${randomUUID()}`,
          resolution.keyKind,
          resolution.opaqueKey,
          name,
          normalizeProjectVocabulary(name),
          resolution.displayPath,
          resolution.confidence,
          now,
          now,
        );
      projectId = Number(inserted.lastInsertRowid);
    }

    database.raw
      .prepare(
        `INSERT INTO project_thread_memberships(
           project_id, thread_id, role, confidence, basis, created_at, updated_at
         ) VALUES (?, ?, 'primary', ?, ?, ?, ?)
         ON CONFLICT(thread_id, role) DO UPDATE SET
           project_id = excluded.project_id,
           confidence = excluded.confidence,
           basis = excluded.basis,
           updated_at = excluded.updated_at`,
      )
      .run(
        projectId!,
        threadId,
        resolution.confidence,
        resolution.keyKind,
        now,
        now,
      );
    database.raw
      .prepare(
        `INSERT INTO project_identity_observations(
           project_id, thread_id, adapter_id, observation_type,
           display_value, confidence, observed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, adapter_id, observation_type) DO UPDATE SET
           project_id = excluded.project_id,
           display_value = excluded.display_value,
           confidence = excluded.confidence,
           observed_at = excluded.observed_at`,
      )
      .run(
        projectId!,
        threadId,
        adapterId,
        resolution.observationType,
        resolution.displayPath,
        resolution.confidence,
        observedAt,
      );
  });
}

function projectResolution(
  keyKind: ProjectKeyKind,
  canonicalKey: string,
  displayRoot: string,
  confidence: ProjectConfidence,
): ProjectIdentityResolution {
  const displayPath = redactAndBound(
    homeNormalize(displayRoot),
    TEXT_LIMITS.path,
  ).text;
  return {
    keyKind,
    opaqueKey: createHash("sha256")
      .update(`${keyKind}\0${canonicalKey}`)
      .digest("hex"),
    name: basename(displayRoot) || "project",
    displayPath,
    confidence,
    observationType: keyKind,
  };
}

function gitCommonDirectory(cwd: string): string | undefined {
  const result = spawnSync(
    "git",
    ["-C", cwd, "rev-parse", "--git-common-dir"],
    {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_OUTPUT_LIMIT,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (result.status !== 0 || result.error || result.signal) return undefined;
  const output = result.stdout.trim().split(/\r?\n/u)[0];
  if (!output || output.length > GIT_OUTPUT_LIMIT) return undefined;
  try {
    return realpathSync(isAbsolute(output) ? output : resolve(cwd, output));
  } catch {
    return undefined;
  }
}

function expandLocalCwd(value: string | undefined): string | undefined {
  const cwd = value?.trim();
  if (!cwd) return undefined;
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  if (cwd.startsWith("~")) return undefined;
  return isAbsolute(cwd) ? cwd : undefined;
}

function homeNormalize(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  return path.startsWith(`${home}/`)
    ? `~/${path.slice(home.length + 1)}`
    : path;
}

function uniqueDerivedName(
  database: WorktrailDatabase,
  requestedName: string,
  opaqueKey: string,
): string {
  const name =
    redactAndBound(requestedName, TEXT_LIMITS.title).text || "project";
  const normalized = normalizeProjectVocabulary(name);
  const compactName = compactProjectVocabulary(name);
  const nameConflict = (
    database.raw
      .prepare(
        "SELECT name, normalized_name FROM project_identities WHERE status = 'active'",
      )
      .all() as Array<{ name: string; normalized_name: string }>
  ).some(
    (row) =>
      row.normalized_name === normalized ||
      compactProjectVocabulary(row.name) === compactName,
  );
  const aliasConflict = (
    database.raw
      .prepare(
        `SELECT a.alias
         FROM project_aliases a
         JOIN project_identities p ON p.id = a.project_id
         WHERE p.status = 'active'`,
      )
      .all() as Array<{ alias: string }>
  ).some(
    (row) =>
      normalizeProjectVocabulary(row.alias) === normalized ||
      compactProjectVocabulary(row.alias) === compactName,
  );
  return nameConflict || aliasConflict
    ? `${name} · ${opaqueKey.slice(0, 8)}`
    : name;
}

function cleanAlias(requestedAlias: string): string {
  const alias = redactAndBound(
    requestedAlias.trim().replace(/\s+/gu, " "),
    TEXT_LIMITS.title,
  ).text;
  if ((alias.match(/[\p{L}\p{N}]/gu) ?? []).length < 2) {
    throw new Error(
      "Project alias must contain at least two letters or numbers.",
    );
  }
  return alias;
}

function requireActiveProject(
  database: WorktrailDatabase,
  identifier: string,
): ProjectRow {
  const byId = database.raw
    .prepare("SELECT * FROM project_identities WHERE public_id = ?")
    .get(identifier) as ProjectRow | undefined;
  if (byId) {
    if (byId.status !== "active")
      throw new Error(`Project is not active: ${identifier}`);
    return byId;
  }
  const normalized = normalizeProjectVocabulary(identifier);
  const compact = compactProjectVocabulary(identifier);
  const rows = database.raw
    .prepare("SELECT * FROM project_identities WHERE status = 'active'")
    .all() as ProjectRow[];
  const matches = rows.filter(
    (row) =>
      row.normalized_name === normalized ||
      compactProjectVocabulary(row.name) === compact,
  );
  if (matches.length === 0) {
    throw new Error(
      `Unknown project identity: ${identifier}. Run \"worktrail projects list\" after indexing.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Project identity is ambiguous: ${identifier}. Use the project ID from \"worktrail projects list\".`,
    );
  }
  return matches[0]!;
}

function assertVocabularyAvailable(
  database: WorktrailDatabase,
  projectId: number,
  normalizedAlias: string,
  alias: string,
): void {
  const compact = compactProjectVocabulary(alias);
  const projects = database.raw
    .prepare(
      "SELECT id, public_id, name, normalized_name FROM project_identities WHERE status = 'active'",
    )
    .all() as Array<{
    id: number;
    public_id: string;
    name: string;
    normalized_name: string;
  }>;
  const projectConflict = projects.find(
    (row) =>
      row.normalized_name === normalizedAlias ||
      compactProjectVocabulary(row.name) === compact,
  );
  if (projectConflict) {
    throw new Error(
      projectConflict.id === projectId
        ? `Alias duplicates the project name: ${projectConflict.name}`
        : `Alias conflicts with active project: ${projectConflict.public_id} (${projectConflict.name})`,
    );
  }
  const aliases = database.raw
    .prepare(
      `SELECT a.project_id, a.alias, p.public_id
       FROM project_aliases a
       JOIN project_identities p ON p.id = a.project_id
       WHERE p.status = 'active'`,
    )
    .all() as Array<{ project_id: number; alias: string; public_id: string }>;
  const aliasConflict = aliases.find(
    (row) =>
      normalizeProjectVocabulary(row.alias) === normalizedAlias ||
      compactProjectVocabulary(row.alias) === compact,
  );
  if (aliasConflict && aliasConflict.project_id !== projectId) {
    throw new Error(
      `Alias conflicts with active project alias on: ${aliasConflict.public_id}`,
    );
  }
}

function recordProjectCorrection(
  database: WorktrailDatabase,
  projectId: number,
  type: string,
  payload: Record<string, unknown>,
  now: string,
): void {
  database.raw
    .prepare(
      `INSERT INTO manual_corrections(
         project_id, correction_type, correction_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(projectId, type, JSON.stringify(payload), now, now);
}
