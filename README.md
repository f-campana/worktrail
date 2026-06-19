# Worktrail

Worktrail is a local-first workstream memory layer for AI-assisted development.
The repository includes a Codex rollout importer, SQLite/FTS index, canonical
workstreams, manual corrections, evidence-backed commands, and a read-only
local web UI.

## Requirements

- Node.js 22.5 or newer, with `node:sqlite`
- pnpm 10 or newer

Install dependencies:

```sh
pnpm install
```

Run unit/API tests and focused browser tests:

```sh
pnpm test
pnpm exec playwright install chromium # first run only
pnpm test:browser
```

## Synthetic fixture workflow

Index the committed synthetic fixtures:

```sh
pnpm worktrail index --fixtures
```

Start the fixture-backed UI:

```sh
pnpm ui:build
pnpm ui -- --db .worktrail/fixtures.db
```

Open `http://127.0.0.1:4173` and query `widget repair`. Searches update the URL,
so a query can be reopened locally, for example
`http://127.0.0.1:4173/search?q=widget%20repair`. Canonical results link to a
read-only `/workstreams/WORKSTREAM_ID` detail page. Resume UUIDs and commands
can be copied, but are never executed.

During UI development, run `pnpm ui:dev -- --db .worktrail/fixtures.db` and open
port 5173. The local server binds only to `127.0.0.1`; evidence is fetched only
after expanding its disclosure. Index status contains counts and paths, never
transcript text. It refreshes every 30 seconds and shows its last refresh time.

Search them:

```sh
pnpm worktrail search "widget validation" --db .worktrail/fixtures.db
```

Create a canonical workstream and assign the best fixture thread. The create
command returns a `ws_...` ID to use in the following command:

```sh
pnpm worktrail workstreams create "Fixture widget work" \
  --db .worktrail/fixtures.db --json

pnpm worktrail threads assign \
  00000000-0000-4000-8000-000000000002 WORKSTREAM_ID \
  --db .worktrail/fixtures.db

pnpm worktrail state "widget validation" --db .worktrail/fixtures.db
pnpm worktrail state "widget validation" --db .worktrail/fixtures.db --json
pnpm worktrail state "widget validation" --db .worktrail/fixtures.db --explain
```

Assign additional source threads to the same workstream to make them appear as
related evidence:

```sh
pnpm worktrail threads assign \
  00000000-0000-4000-8000-000000000001 WORKSTREAM_ID \
  --db .worktrail/fixtures.db
```

Ignore and restore a source thread:

```sh
pnpm worktrail threads ignore \
  00000000-0000-4000-8000-000000000002 \
  --db .worktrail/fixtures.db

pnpm worktrail search "widget validation" --db .worktrail/fixtures.db

pnpm worktrail threads unignore \
  00000000-0000-4000-8000-000000000002 \
  --db .worktrail/fixtures.db
```

Use `--json` for machine-readable results. Fixture data is written to
`.worktrail/fixtures.db`, which is ignored by Git.

## Workstream commands

```sh
pnpm worktrail workstreams list --db PATH
pnpm worktrail workstreams create "Workstream name" --db PATH
pnpm worktrail workstreams rename WORKSTREAM_ID "New name" --db PATH
pnpm worktrail workstreams alias add WORKSTREAM_ID "safe apply" --db PATH
pnpm worktrail workstreams alias remove WORKSTREAM_ID "safe apply" --db PATH
pnpm worktrail workstreams aliases WORKSTREAM_ID --db PATH
pnpm worktrail workstreams merge SOURCE_WORKSTREAM_ID TARGET_WORKSTREAM_ID --db PATH

pnpm worktrail threads assign THREAD_UUID WORKSTREAM_ID --db PATH
pnpm worktrail threads unassign THREAD_UUID --db PATH
pnpm worktrail threads ignore THREAD_UUID --db PATH
pnpm worktrail threads unignore THREAD_UUID --db PATH

pnpm worktrail state "what you remember" --db PATH
pnpm worktrail state "what you remember" --db PATH --json
pnpm worktrail state "what you remember" --db PATH --explain
```

One source thread can have one canonical workstream assignment. Reassigning it
replaces the previous assignment. Manual assignments always override
deterministic candidate grouping. Ignored threads are excluded from search and
state cards by default; search can include them explicitly with
`--include-ignored`.

For unassigned threads, Worktrail creates read-time candidates conservatively.
It considers lexical query relevance, titles, cwd, meaningful shared file
references, and recency. It does not persist candidate assignments and does not
use an LLM. A state card labels these as `candidate`; manually assigned cards are
labelled `manual` and include the canonical workstream ID.

State cards report only stored facts: related source threads, resume UUIDs,
latest activity, cwd, evidence excerpts, and file references. “Latest evidence”
does not claim that a task or workstream is complete.

### Aliases and merges

Aliases are manual vocabulary for a canonical workstream. Phrase or full-term
alias matches receive a stronger score than ordinary lexical evidence and are
reported as an `alias-match` signal.

```sh
pnpm worktrail workstreams alias add WORKSTREAM_ID "safe apply" --db PATH
pnpm worktrail state "resume safe apply" --db PATH --explain
pnpm worktrail workstreams aliases WORKSTREAM_ID --db PATH
```

Merge a duplicate source workstream into a canonical target:

```sh
pnpm worktrail workstreams merge SOURCE_WORKSTREAM_ID TARGET_WORKSTREAM_ID \
  --db PATH
```

Merge moves assignments and aliases to the target. The source row and its
correction history are retained with `status=merged` and a target redirect. The
source canonical name becomes a target alias when it does not conflict.

### Ranking explanations

State JSON always includes structured signals with stable `type`, `weight`, and
`detail` fields. Human output shows a compact signal summary; `--explain` prints
the individual details. Signals can include manual assignment, alias, title,
cwd, file reference, evidence text, recency, and ignored-thread exclusion.

Related file paths are normalized for display. When an absolute/home-normalized
path is safely under a related thread's cwd, Worktrail displays it repo-relative
and collapses an equivalent relative path. Original file evidence remains in
SQLite.

## Dogfood evaluation

Create a JSON query file as either an array or `{ "queries": [...] }`:

```json
["resume safe apply GUI", "widget validation"]
```

Run the queries against a local database:

```sh
pnpm worktrail eval queries.json
pnpm worktrail eval queries.json --json
```

Default eval output contains only query, selected workstream/thread metadata,
score, signal names, activity, and IDs. It does not include transcript evidence.
Evidence requires explicit opt-in:

```sh
pnpm worktrail eval queries.json --with-evidence
```

## Local Codex workflow

Index active and archived Codex rollouts under `$CODEX_HOME` or `~/.codex`:

```sh
pnpm worktrail index
pnpm worktrail search "resume safe apply GUI"
pnpm worktrail state "resume safe apply GUI"
```

The default local database is `~/.worktrail/worktrail.db`. Override it with
`--db PATH`, and override the Codex directory with `--codex-home PATH`.

For a bounded, metadata-only console smoke run against a few real sources:

```sh
pnpm worktrail index --db /tmp/worktrail-smoke.db --max-sources 5
```

The index command prints counts and diagnostics only. It never prints transcript
content. Search intentionally displays redacted evidence excerpts from the local
database.

Incremental indexing skips unchanged rollout files. Use `--force` to reparse
them, `--since ISO_DATE` to filter by source modification time, and
`--max-sources N` to bound discovery for smoke testing.

## Privacy and persistence

Rollouts are streamed line-by-line and remain the source of truth. Before any
text reaches SQLite, Worktrail redacts common secrets, normalizes home paths to
`~`, applies the configured byte limit, and marks truncation.

Persisted limits:

| Content                       |   Maximum |
| ----------------------------- | --------: |
| Message                       |      8 KB |
| Tool input                    |      4 KB |
| Tool output                   |      4 KB |
| Patch or file-change evidence |      4 KB |
| Display evidence excerpt      | 800 bytes |

Raw transcript payloads are not stored. The database contains bounded redacted
search text, evidence excerpts, hashes of redacted text, normalized metadata,
and source provenance. `auth.json`, shell snapshots, attachments, Codex logs,
and Codex state databases are not read.

## Development

```sh
pnpm typecheck
pnpm test
```

Format reviewable source and test files with `pnpm format`; CI-style checking is
available as `pnpm format:check`.

## Local UI and correction API

The UI server binds only to `127.0.0.1` and is read-only by default:

```sh
pnpm ui -- --db ~/.worktrail/worktrail.db
```

Explicitly enable correction endpoints with:

```sh
pnpm ui -- --db ~/.worktrail/worktrail.db --allow-write
```

In write mode, `GET /api/bootstrap` supplies a per-process token to the
same-origin local UI. Every mutation also requires a matching `Origin` header
and `X-Worktrail-Write-Token` header. The status response reports
`writesEnabled` but never includes the token. The correction UI is intentionally
not implemented yet.

Correction contracts:

- `POST /api/workstreams` with `{ "name": "Release work" }`
- `PATCH /api/workstreams/:id` with `{ "name": "New name" }`
- `POST /api/workstreams/:id/aliases` with `{ "alias": "release" }`
- `DELETE /api/workstreams/:id/aliases/:alias`
- `POST /api/threads/:threadId/assignment` with `{ "workstreamId": "ws_..." }`
- `DELETE /api/threads/:threadId/assignment`
- `POST /api/threads/:threadId/ignore` with optional `{ "reason": "..." }`
- `DELETE /api/threads/:threadId/ignore`

For example, after obtaining `writeToken` from `/api/bootstrap`:

```sh
curl -X POST http://127.0.0.1:4173/api/workstreams \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://127.0.0.1:4173' \
  -H "X-Worktrail-Write-Token: $TOKEN" \
  --data '{"name":"Release work"}'
```

These APIs update only Worktrail's correction tables and index. They never edit
Codex rollout/source files. Merge remains CLI-only because it has no undo.

Tests use only synthetic fixtures under `fixtures/codex/`.

## Known limitations

- Codex rollout payloads are internal formats and may change. Unknown outer
  records are diagnosed and skipped; unknown event variants are ignored.
- Tool outputs can have additional shapes not represented by the two fixtures.
- Message/event mirror deduplication intentionally covers only nearby identical
  records.
- File references outside structured patch events are regex detections and can
  have false positives or miss extensionless files.
- `cwd` is a launch directory, not a guaranteed repository root.
- Search is lexical SQLite FTS with simple term coverage scoring. It does not
  perform semantic retrieval or full workstream state synthesis.
- Deterministic workstream candidates are intentionally conservative and may
  leave related threads separate. Manual assignment is the correction path.
- Candidate grouping is calculated at query time and is not a durable claim.
- Workstream names are matched lexically; there is no semantic alias model.
- Aliases are exact phrase/full-term vocabulary, not fuzzy semantic synonyms.
- Merge is one-way and currently has no undo command. The merged source row is
  retained for auditability.
- Signal weights are deterministic explanations, not calibrated probabilities.
- Ignoring a thread hides it from default search/state results but does not
  delete its locally indexed evidence.
- Title enrichment uses the newest valid `session_index.jsonl` row. Codex
  `state_5.sqlite` is intentionally unused.
- Redaction reduces exposure but cannot guarantee detection of every secret or
  proprietary value.

The product decisions and source spike are documented in
[`docs/DECISIONS.md`](docs/DECISIONS.md) and
[`docs/spikes/codex-source-availability.md`](docs/spikes/codex-source-availability.md).
