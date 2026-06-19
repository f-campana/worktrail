import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const MIGRATIONS = [
  {
    version: 1,
    name: "initial",
    sql: readFileSync(
      new URL("./migrations/001_initial.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 2,
    name: "workstreams",
    sql: readFileSync(
      new URL("./migrations/002_workstreams.sql", import.meta.url),
      "utf8",
    ),
  },
  {
    version: 3,
    name: "workstream-quality",
    sql: readFileSync(
      new URL("./migrations/003_workstream_quality.sql", import.meta.url),
      "utf8",
    ),
  },
] as const;

type SourceRow = {
  id: number;
  fingerprint: string;
  status: string;
};

export class WorktrailDatabase {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    const resolved = resolve(path);
    mkdirSync(dirname(resolved), { recursive: true });
    this.raw = new DatabaseSync(resolved);
    this.raw.exec("PRAGMA journal_mode = WAL");
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  close(): void {
    this.raw.close();
  }

  transaction<T>(operation: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  getSource(adapterId: string, sourceUri: string): SourceRow | undefined {
    return this.raw
      .prepare(
        "SELECT id, fingerprint, status FROM sources WHERE adapter_id = ? AND source_uri = ?",
      )
      .get(adapterId, sourceUri) as SourceRow | undefined;
  }

  scalar(sql: string, ...values: SQLInputValue[]): number {
    const row = this.raw.prepare(sql).get(...values) as
      | Record<string, string | number | bigint | null>
      | undefined;
    const value = row ? Object.values(row)[0] : 0;
    return Number(value ?? 0);
  }

  rebuildSearchDocument(threadId: number): void {
    const thread = this.raw
      .prepare("SELECT title, cwd FROM source_threads WHERE id = ?")
      .get(threadId) as
      | { title: string | null; cwd: string | null }
      | undefined;
    if (!thread) return;

    const messageRows = this.raw
      .prepare(
        "SELECT searchable_text FROM messages WHERE thread_id = ? ORDER BY id",
      )
      .all(threadId) as Array<{ searchable_text: string }>;
    const evidenceRows = this.raw
      .prepare(
        "SELECT searchable_text FROM evidence WHERE thread_id = ? AND kind <> 'message' ORDER BY id",
      )
      .all(threadId) as Array<{ searchable_text: string }>;
    const fileRows = this.raw
      .prepare(
        "SELECT DISTINCT path FROM file_references WHERE thread_id = ? ORDER BY path",
      )
      .all(threadId) as Array<{ path: string }>;

    const searchableText = [...messageRows, ...evidenceRows]
      .map((row) => row.searchable_text)
      .filter(Boolean)
      .join("\n");
    const fileReferences = fileRows.map((row) => row.path).join("\n");

    this.raw
      .prepare(
        `INSERT INTO search_documents(thread_id, title, cwd, file_references, searchable_text)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           title = excluded.title,
           cwd = excluded.cwd,
           file_references = excluded.file_references,
           searchable_text = excluded.searchable_text`,
      )
      .run(
        threadId,
        thread.title ?? "",
        thread.cwd ?? "",
        fileReferences,
        searchableText,
      );
  }

  private migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);

    const applied = new Set(
      (
        this.raw
          .prepare("SELECT version FROM schema_migrations")
          .all() as Array<{
          version: number;
        }>
      ).map((row) => row.version),
    );

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      this.transaction(() => {
        this.raw.exec(migration.sql);
        this.raw
          .prepare(
            "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          )
          .run(migration.version, migration.name, new Date().toISOString());
      });
    }
  }
}
