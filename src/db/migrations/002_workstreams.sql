CREATE TABLE workstreams (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX workstreams_name_idx ON workstreams(normalized_name);

CREATE TABLE workstream_assignments (
  id INTEGER PRIMARY KEY,
  workstream_id INTEGER NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL UNIQUE REFERENCES source_threads(id) ON DELETE CASCADE,
  assignment_type TEXT NOT NULL DEFAULT 'manual' CHECK (assignment_type = 'manual'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workstream_id, thread_id)
);

CREATE INDEX workstream_assignments_workstream_idx
  ON workstream_assignments(workstream_id, thread_id);

CREATE TABLE ignored_threads (
  thread_id INTEGER PRIMARY KEY REFERENCES source_threads(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE manual_corrections
  ADD COLUMN workstream_id INTEGER REFERENCES workstreams(id) ON DELETE SET NULL;
