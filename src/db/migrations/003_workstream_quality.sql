CREATE TABLE workstream_aliases (
  id INTEGER PRIMARY KEY,
  workstream_id INTEGER NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workstream_id, normalized_alias)
);

CREATE INDEX workstream_aliases_workstream_idx
  ON workstream_aliases(workstream_id, normalized_alias);

ALTER TABLE workstreams
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'merged'));

ALTER TABLE workstreams
  ADD COLUMN merged_into_id INTEGER REFERENCES workstreams(id) ON DELETE RESTRICT;

ALTER TABLE workstreams
  ADD COLUMN merged_at TEXT;

CREATE INDEX workstreams_status_idx ON workstreams(status, updated_at DESC);
