CREATE TABLE project_identities (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  key_kind TEXT NOT NULL CHECK (key_kind IN ('git-common-dir', 'cwd')),
  opaque_key TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  display_path TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged')),
  merged_into_id INTEGER REFERENCES project_identities(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (key_kind, opaque_key)
);

CREATE UNIQUE INDEX project_identities_active_name_idx
  ON project_identities(normalized_name)
  WHERE status = 'active';

CREATE INDEX project_identities_status_idx
  ON project_identities(status, updated_at DESC);

CREATE TABLE project_thread_memberships (
  project_id INTEGER NOT NULL REFERENCES project_identities(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL REFERENCES source_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'secondary')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  basis TEXT NOT NULL CHECK (basis IN ('git-common-dir', 'cwd', 'source-project')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, thread_id, role),
  UNIQUE (thread_id, role)
);

CREATE INDEX project_thread_memberships_project_idx
  ON project_thread_memberships(project_id, role, thread_id);

CREATE TABLE project_identity_observations (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_identities(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL REFERENCES source_threads(id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  observation_type TEXT NOT NULL
    CHECK (observation_type IN ('git-common-dir', 'git-root', 'cwd', 'source-project')),
  display_value TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  observed_at TEXT NOT NULL,
  UNIQUE (thread_id, adapter_id, observation_type)
);

CREATE INDEX project_identity_observations_project_idx
  ON project_identity_observations(project_id, observed_at DESC);

CREATE TABLE project_aliases (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project_identities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'source')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, normalized_alias)
);

CREATE INDEX project_aliases_project_idx
  ON project_aliases(project_id, normalized_alias);

ALTER TABLE manual_corrections
  ADD COLUMN project_id INTEGER REFERENCES project_identities(id) ON DELETE SET NULL;
