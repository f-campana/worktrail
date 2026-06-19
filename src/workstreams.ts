import { randomUUID } from "node:crypto";

import { WorktrailDatabase } from "./db/database.js";
import { TEXT_LIMITS } from "./limits.js";
import { redactAndBound } from "./redaction.js";

export type Workstream = {
  id: string;
  name: string;
  status: "active" | "merged";
  mergedIntoId: string | null;
  createdAt: string;
  updatedAt: string;
  threadCount: number;
  activeThreadCount: number;
};

export type WorkstreamAlias = {
  workstreamId: string;
  alias: string;
  createdAt: string;
};

export type WorkstreamMerge = {
  sourceId: string;
  targetId: string;
  movedAssignments: number;
  movedAliases: number;
  mergedAt: string;
};

export type Assignment = {
  workstreamId: string;
  workstreamName: string;
  threadId: string;
  assignedAt: string;
};

type WorkstreamRow = {
  id: number;
  public_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  status: "active" | "merged";
  merged_into_id: number | null;
  merged_into_public_id?: string | null;
};

type ThreadRow = {
  id: number;
  external_id: string;
};

export function createWorkstream(
  database: WorktrailDatabase,
  requestedName: string,
): Workstream {
  const name = cleanName(requestedName);
  const normalizedName = normalizeName(name);
  const duplicate = database.raw
    .prepare("SELECT public_id FROM workstreams WHERE normalized_name = ?")
    .get(normalizedName) as { public_id: string } | undefined;
  if (duplicate) {
    throw new Error(
      `A workstream with that name already exists: ${duplicate.public_id}`,
    );
  }
  assertNameDoesNotConflictAlias(database, normalizedName);

  const now = new Date().toISOString();
  const publicId = `ws_${randomUUID()}`;
  database.transaction(() => {
    const result = database.raw
      .prepare(
        `INSERT INTO workstreams(public_id, name, normalized_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(publicId, name, normalizedName, now, now);
    const internalId = Number(result.lastInsertRowid);
    recordCorrection(database, {
      workstreamId: internalId,
      type: "workstream.create",
      payload: { workstreamId: publicId, name },
      now,
    });
  });

  return {
    id: publicId,
    name,
    status: "active",
    mergedIntoId: null,
    createdAt: now,
    updatedAt: now,
    threadCount: 0,
    activeThreadCount: 0,
  };
}

export function listWorkstreams(database: WorktrailDatabase): Workstream[] {
  const rows = database.raw
    .prepare(
      `SELECT
         w.public_id,
         w.name,
         w.status,
         target.public_id AS merged_into_public_id,
         w.created_at,
         w.updated_at,
         count(a.id) AS thread_count,
         sum(CASE WHEN a.id IS NOT NULL AND i.thread_id IS NULL THEN 1 ELSE 0 END)
           AS active_thread_count
       FROM workstreams w
       LEFT JOIN workstreams target ON target.id = w.merged_into_id
       LEFT JOIN workstream_assignments a ON a.workstream_id = w.id
       LEFT JOIN ignored_threads i ON i.thread_id = a.thread_id
       GROUP BY w.id
       ORDER BY w.updated_at DESC, w.name ASC`,
    )
    .all() as Array<{
    public_id: string;
    name: string;
    status: "active" | "merged";
    merged_into_public_id: string | null;
    created_at: string;
    updated_at: string;
    thread_count: number;
    active_thread_count: number;
  }>;

  return rows.map((row) => ({
    id: row.public_id,
    name: row.name,
    status: row.status,
    mergedIntoId: row.merged_into_public_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    threadCount: Number(row.thread_count),
    activeThreadCount: Number(row.active_thread_count),
  }));
}

export function renameWorkstream(
  database: WorktrailDatabase,
  identifier: string,
  requestedName: string,
): Workstream {
  const workstream = requireActiveWorkstream(database, identifier);
  const name = cleanName(requestedName);
  const normalizedName = normalizeName(name);
  const duplicate = database.raw
    .prepare(
      "SELECT public_id FROM workstreams WHERE normalized_name = ? AND id <> ?",
    )
    .get(normalizedName, workstream.id) as { public_id: string } | undefined;
  if (duplicate) {
    throw new Error(
      `A workstream with that name already exists: ${duplicate.public_id}`,
    );
  }
  assertNameDoesNotConflictAlias(database, normalizedName, workstream.id);

  const now = new Date().toISOString();
  database.transaction(() => {
    database.raw
      .prepare(
        "UPDATE workstreams SET name = ?, normalized_name = ?, updated_at = ? WHERE id = ?",
      )
      .run(name, normalizedName, now, workstream.id);
    recordCorrection(database, {
      workstreamId: workstream.id,
      type: "workstream.rename",
      payload: {
        workstreamId: workstream.public_id,
        previousName: workstream.name,
        name,
      },
      now,
    });
  });
  return requireListedWorkstream(database, workstream.public_id);
}

export function assignThread(
  database: WorktrailDatabase,
  externalThreadId: string,
  workstreamIdentifier: string,
): Assignment {
  const thread = requireThread(database, externalThreadId);
  const workstream = requireActiveWorkstream(database, workstreamIdentifier);
  const now = new Date().toISOString();

  database.transaction(() => {
    database.raw
      .prepare(
        `INSERT INTO workstream_assignments(
           workstream_id, thread_id, assignment_type, created_at, updated_at
         ) VALUES (?, ?, 'manual', ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           workstream_id = excluded.workstream_id,
           assignment_type = 'manual',
           updated_at = excluded.updated_at`,
      )
      .run(workstream.id, thread.id, now, now);
    database.raw
      .prepare("UPDATE workstreams SET updated_at = ? WHERE id = ?")
      .run(now, workstream.id);
    recordCorrection(database, {
      threadId: thread.id,
      workstreamId: workstream.id,
      type: "thread.assign",
      payload: {
        threadId: thread.external_id,
        workstreamId: workstream.public_id,
      },
      now,
    });
  });

  return {
    workstreamId: workstream.public_id,
    workstreamName: workstream.name,
    threadId: thread.external_id,
    assignedAt: now,
  };
}

export function unassignThread(
  database: WorktrailDatabase,
  externalThreadId: string,
): boolean {
  const thread = requireThread(database, externalThreadId);
  const assignment = database.raw
    .prepare(
      `SELECT a.workstream_id, w.public_id
       FROM workstream_assignments a
       JOIN workstreams w ON w.id = a.workstream_id
       WHERE a.thread_id = ?`,
    )
    .get(thread.id) as { workstream_id: number; public_id: string } | undefined;
  if (!assignment) return false;

  const now = new Date().toISOString();
  database.transaction(() => {
    database.raw
      .prepare("DELETE FROM workstream_assignments WHERE thread_id = ?")
      .run(thread.id);
    recordCorrection(database, {
      threadId: thread.id,
      workstreamId: assignment.workstream_id,
      type: "thread.unassign",
      payload: {
        threadId: thread.external_id,
        workstreamId: assignment.public_id,
      },
      now,
    });
  });
  return true;
}

export function ignoreThread(
  database: WorktrailDatabase,
  externalThreadId: string,
  reason?: string,
): void {
  const thread = requireThread(database, externalThreadId);
  const now = new Date().toISOString();
  const safeReason = reason
    ? redactAndBound(reason, TEXT_LIMITS.evidenceExcerpt).text
    : null;

  database.transaction(() => {
    database.raw
      .prepare(
        `INSERT INTO ignored_threads(thread_id, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           reason = excluded.reason,
           updated_at = excluded.updated_at`,
      )
      .run(thread.id, safeReason, now, now);
    recordCorrection(database, {
      threadId: thread.id,
      type: "thread.ignore",
      payload: {
        threadId: thread.external_id,
        ...(safeReason ? { reason: safeReason } : {}),
      },
      now,
    });
  });
}

export function unignoreThread(
  database: WorktrailDatabase,
  externalThreadId: string,
): boolean {
  const thread = requireThread(database, externalThreadId);
  const now = new Date().toISOString();
  const removed = database.transaction(() => {
    const result = database.raw
      .prepare("DELETE FROM ignored_threads WHERE thread_id = ?")
      .run(thread.id);
    if (Number(result.changes) > 0) {
      recordCorrection(database, {
        threadId: thread.id,
        type: "thread.unignore",
        payload: { threadId: thread.external_id },
        now,
      });
    }
    return Number(result.changes) > 0;
  });
  return removed;
}

export function isThreadIgnored(
  database: WorktrailDatabase,
  externalThreadId: string,
): boolean {
  const row = database.raw
    .prepare(
      `SELECT 1
       FROM ignored_threads i
       JOIN source_threads t ON t.id = i.thread_id
       WHERE t.external_id = ?`,
    )
    .get(externalThreadId);
  return Boolean(row);
}

export function addWorkstreamAlias(
  database: WorktrailDatabase,
  identifier: string,
  requestedAlias: string,
): WorkstreamAlias {
  const workstream = requireActiveWorkstream(database, identifier);
  const alias = cleanName(requestedAlias);
  const normalizedAlias = normalizeName(alias);
  if (normalizedAlias === normalizeName(workstream.name)) {
    throw new Error("Alias duplicates the canonical workstream name.");
  }

  const nameConflict = database.raw
    .prepare(
      `SELECT public_id
       FROM workstreams
       WHERE normalized_name = ? AND status = 'active' AND id <> ?`,
    )
    .get(normalizedAlias, workstream.id) as { public_id: string } | undefined;
  if (nameConflict) {
    throw new Error(
      `Alias conflicts with workstream: ${nameConflict.public_id}`,
    );
  }

  const existing = database.raw
    .prepare(
      `SELECT a.alias, a.created_at, w.public_id
       FROM workstream_aliases a
       JOIN workstreams w ON w.id = a.workstream_id
       WHERE a.normalized_alias = ?`,
    )
    .get(normalizedAlias) as
    | { alias: string; created_at: string; public_id: string }
    | undefined;
  if (existing) {
    if (existing.public_id !== workstream.public_id) {
      throw new Error(
        `Alias already belongs to workstream: ${existing.public_id}`,
      );
    }
    return {
      workstreamId: workstream.public_id,
      alias: existing.alias,
      createdAt: existing.created_at,
    };
  }

  const now = new Date().toISOString();
  database.transaction(() => {
    database.raw
      .prepare(
        `INSERT INTO workstream_aliases(
           workstream_id, alias, normalized_alias, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(workstream.id, alias, normalizedAlias, now, now);
    database.raw
      .prepare("UPDATE workstreams SET updated_at = ? WHERE id = ?")
      .run(now, workstream.id);
    recordCorrection(database, {
      workstreamId: workstream.id,
      type: "workstream.alias.add",
      payload: { workstreamId: workstream.public_id, alias },
      now,
    });
  });

  return { workstreamId: workstream.public_id, alias, createdAt: now };
}

export function removeWorkstreamAlias(
  database: WorktrailDatabase,
  identifier: string,
  requestedAlias: string,
): boolean {
  const workstream = requireActiveWorkstream(database, identifier);
  const normalizedAlias = normalizeName(requestedAlias);
  const row = database.raw
    .prepare(
      `SELECT alias
       FROM workstream_aliases
       WHERE workstream_id = ? AND normalized_alias = ?`,
    )
    .get(workstream.id, normalizedAlias) as { alias: string } | undefined;
  if (!row) return false;

  const now = new Date().toISOString();
  database.transaction(() => {
    database.raw
      .prepare(
        "DELETE FROM workstream_aliases WHERE workstream_id = ? AND normalized_alias = ?",
      )
      .run(workstream.id, normalizedAlias);
    recordCorrection(database, {
      workstreamId: workstream.id,
      type: "workstream.alias.remove",
      payload: { workstreamId: workstream.public_id, alias: row.alias },
      now,
    });
  });
  return true;
}

export function listWorkstreamAliases(
  database: WorktrailDatabase,
  identifier: string,
): WorkstreamAlias[] {
  const workstream = requireActiveWorkstream(database, identifier);
  const rows = database.raw
    .prepare(
      `SELECT alias, created_at
       FROM workstream_aliases
       WHERE workstream_id = ?
       ORDER BY normalized_alias`,
    )
    .all(workstream.id) as Array<{ alias: string; created_at: string }>;
  return rows.map((row) => ({
    workstreamId: workstream.public_id,
    alias: row.alias,
    createdAt: row.created_at,
  }));
}

export function mergeWorkstreams(
  database: WorktrailDatabase,
  sourceIdentifier: string,
  targetIdentifier: string,
): WorkstreamMerge {
  const source = requireWorkstream(database, sourceIdentifier);
  const target = requireActiveWorkstream(database, targetIdentifier);
  if (source.id === target.id) {
    throw new Error("Cannot merge a workstream into itself.");
  }
  if (source.status !== "active") {
    throw new Error(
      `Source workstream is already merged into another workstream.`,
    );
  }

  const now = new Date().toISOString();
  let movedAssignments = 0;
  let movedAliases = 0;
  database.transaction(() => {
    const assignmentResult = database.raw
      .prepare(
        `UPDATE workstream_assignments
         SET workstream_id = ?, updated_at = ?
         WHERE workstream_id = ?`,
      )
      .run(target.id, now, source.id);
    movedAssignments = Number(assignmentResult.changes);

    const aliasResult = database.raw
      .prepare(
        `UPDATE workstream_aliases
         SET workstream_id = ?, updated_at = ?
         WHERE workstream_id = ?`,
      )
      .run(target.id, now, source.id);
    movedAliases = Number(aliasResult.changes);

    if (normalizeName(source.name) !== normalizeName(target.name)) {
      const conflict = database.raw
        .prepare("SELECT 1 FROM workstream_aliases WHERE normalized_alias = ?")
        .get(normalizeName(source.name));
      if (!conflict) {
        database.raw
          .prepare(
            `INSERT INTO workstream_aliases(
               workstream_id, alias, normalized_alias, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(target.id, source.name, normalizeName(source.name), now, now);
        movedAliases += 1;
      }
    }

    database.raw
      .prepare(
        `UPDATE workstreams
         SET status = 'merged', merged_into_id = ?, merged_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(target.id, now, now, source.id);
    database.raw
      .prepare("UPDATE workstreams SET updated_at = ? WHERE id = ?")
      .run(now, target.id);
    recordCorrection(database, {
      workstreamId: target.id,
      type: "workstream.merge",
      payload: {
        sourceWorkstreamId: source.public_id,
        targetWorkstreamId: target.public_id,
        movedAssignments,
        movedAliases,
      },
      now,
    });
  });

  return {
    sourceId: source.public_id,
    targetId: target.public_id,
    movedAssignments,
    movedAliases,
    mergedAt: now,
  };
}

function requireActiveWorkstream(
  database: WorktrailDatabase,
  identifier: string,
): WorkstreamRow {
  const workstream = requireWorkstream(database, identifier);
  if (workstream.status === "active") return workstream;
  if (!workstream.merged_into_id) {
    throw new Error(`Merged workstream has no canonical target: ${identifier}`);
  }
  const target = database.raw
    .prepare("SELECT * FROM workstreams WHERE id = ?")
    .get(workstream.merged_into_id) as WorkstreamRow | undefined;
  if (!target || target.status !== "active") {
    throw new Error(`Merged workstream target is unavailable: ${identifier}`);
  }
  return target;
}

function requireWorkstream(
  database: WorktrailDatabase,
  identifier: string,
): WorkstreamRow {
  const row = database.raw
    .prepare("SELECT * FROM workstreams WHERE public_id = ?")
    .get(identifier) as WorkstreamRow | undefined;
  if (!row) throw new Error(`Unknown workstream: ${identifier}`);
  return row;
}

function requireListedWorkstream(
  database: WorktrailDatabase,
  identifier: string,
): Workstream {
  const workstream = listWorkstreams(database).find(
    (item) => item.id === identifier,
  );
  if (!workstream) throw new Error(`Unknown workstream: ${identifier}`);
  return workstream;
}

function requireThread(
  database: WorktrailDatabase,
  externalThreadId: string,
): ThreadRow {
  const row = database.raw
    .prepare("SELECT id, external_id FROM source_threads WHERE external_id = ?")
    .get(externalThreadId) as ThreadRow | undefined;
  if (!row) throw new Error(`Unknown source thread: ${externalThreadId}`);
  return row;
}

function cleanName(requestedName: string): string {
  const name = redactAndBound(requestedName.trim(), TEXT_LIMITS.title).text;
  if (!name) throw new Error("Workstream name cannot be empty.");
  return name;
}

function assertNameDoesNotConflictAlias(
  database: WorktrailDatabase,
  normalizedName: string,
  workstreamId?: number,
): void {
  const conflict = database.raw
    .prepare(
      `SELECT w.public_id
       FROM workstream_aliases a
       JOIN workstreams w ON w.id = a.workstream_id
       WHERE a.normalized_alias = ? AND w.status = 'active'
         AND (? IS NULL OR w.id <> ?)`,
    )
    .get(normalizedName, workstreamId ?? null, workstreamId ?? null) as
    | { public_id: string }
    | undefined;
  if (conflict) {
    throw new Error(
      `Workstream name conflicts with alias on: ${conflict.public_id}`,
    );
  }
}

function normalizeName(name: string): string {
  return name.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function recordCorrection(
  database: WorktrailDatabase,
  correction: {
    threadId?: number;
    workstreamId?: number;
    type: string;
    payload: Record<string, unknown>;
    now: string;
  },
): void {
  database.raw
    .prepare(
      `INSERT INTO manual_corrections(
         thread_id, workstream_id, correction_type, correction_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      correction.threadId ?? null,
      correction.workstreamId ?? null,
      correction.type,
      JSON.stringify(correction.payload),
      correction.now,
      correction.now,
    );
}
