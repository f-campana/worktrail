CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  adapter_id TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  external_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  size_bytes INTEGER NOT NULL,
  modified_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered',
  indexed_at TEXT,
  cursor_line INTEGER,
  UNIQUE (adapter_id, source_uri)
);

CREATE TABLE source_threads (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  resume_ref TEXT NOT NULL,
  source_tool TEXT NOT NULL,
  source_surface TEXT,
  cli_version TEXT,
  title TEXT,
  cwd TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  UNIQUE (adapter_id, external_id)
);

CREATE INDEX source_threads_updated_at_idx ON source_threads(updated_at DESC);
CREATE INDEX source_threads_archived_idx ON source_threads(archived);

CREATE TABLE source_turns (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES source_threads(id) ON DELETE CASCADE,
  turn_external_id TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  UNIQUE (thread_id, turn_external_id)
);

CREATE TABLE source_events (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL REFERENCES source_threads(id) ON DELETE CASCADE,
  turn_id INTEGER REFERENCES source_turns(id) ON DELETE SET NULL,
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  role TEXT,
  tool_name TEXT,
  call_id TEXT,
  occurred_at TEXT NOT NULL,
  source_record_type TEXT NOT NULL,
  record_line INTEGER NOT NULL
);

CREATE INDEX source_events_thread_idx ON source_events(thread_id, occurred_at);
CREATE INDEX source_events_call_idx ON source_events(thread_id, call_id);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL UNIQUE REFERENCES source_events(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL REFERENCES source_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  phase TEXT,
  searchable_text TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1))
);

CREATE TABLE evidence (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL UNIQUE REFERENCES source_events(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL REFERENCES source_threads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  searchable_text TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  content_hash TEXT NOT NULL
);

CREATE INDEX evidence_thread_idx ON evidence(thread_id, kind);

CREATE TABLE file_references (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES source_threads(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES source_events(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  confidence TEXT NOT NULL,
  UNIQUE (thread_id, event_id, path)
);

CREATE INDEX file_references_thread_idx ON file_references(thread_id, path);

CREATE TABLE thread_enrichments (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES source_threads(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  title TEXT,
  updated_at TEXT,
  archived INTEGER CHECK (archived IN (0, 1)),
  UNIQUE (thread_id, provider)
);

CREATE TABLE manual_corrections (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER REFERENCES source_threads(id) ON DELETE CASCADE,
  correction_type TEXT NOT NULL,
  correction_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE indexing_runs (
  id INTEGER PRIMARY KEY,
  adapter_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  discovered_sources INTEGER NOT NULL DEFAULT 0,
  indexed_sources INTEGER NOT NULL DEFAULT 0,
  skipped_sources INTEGER NOT NULL DEFAULT 0,
  threads INTEGER NOT NULL DEFAULT 0,
  events INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  tool_results INTEGER NOT NULL DEFAULT 0,
  file_changes INTEGER NOT NULL DEFAULT 0,
  title_enrichments INTEGER NOT NULL DEFAULT 0,
  malformed_lines INTEGER NOT NULL DEFAULT 0,
  partial_lines INTEGER NOT NULL DEFAULT 0,
  unknown_records INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE diagnostics (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES indexing_runs(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  thread_id INTEGER REFERENCES source_threads(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  detail TEXT NOT NULL,
  record_line INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX diagnostics_run_idx ON diagnostics(run_id, code);

CREATE TABLE search_documents (
  thread_id INTEGER PRIMARY KEY REFERENCES source_threads(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT '',
  file_references TEXT NOT NULL DEFAULT '',
  searchable_text TEXT NOT NULL DEFAULT ''
);

CREATE VIRTUAL TABLE thread_search USING fts5(
  title,
  cwd,
  file_references,
  searchable_text,
  content='search_documents',
  content_rowid='thread_id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER search_documents_ai AFTER INSERT ON search_documents BEGIN
  INSERT INTO thread_search(rowid, title, cwd, file_references, searchable_text)
  VALUES (new.thread_id, new.title, new.cwd, new.file_references, new.searchable_text);
END;
CREATE TRIGGER search_documents_ad AFTER DELETE ON search_documents BEGIN
  INSERT INTO thread_search(thread_search, rowid, title, cwd, file_references, searchable_text)
  VALUES ('delete', old.thread_id, old.title, old.cwd, old.file_references, old.searchable_text);
END;

CREATE TRIGGER search_documents_au AFTER UPDATE ON search_documents BEGIN
  INSERT INTO thread_search(thread_search, rowid, title, cwd, file_references, searchable_text)
  VALUES ('delete', old.thread_id, old.title, old.cwd, old.file_references, old.searchable_text);
  INSERT INTO thread_search(rowid, title, cwd, file_references, searchable_text)
  VALUES (new.thread_id, new.title, new.cwd, new.file_references, new.searchable_text);
END;
