# Worktrail

Worktrail is a local-first workstream memory layer for AI-assisted development.
The repository includes a Codex rollout importer, SQLite/FTS index, canonical
workstreams, manual corrections, evidence-backed commands, and a read-only
local web UI.

Product vocabulary and the current Control Tower direction are documented in
[`CONTEXT.md`](CONTEXT.md), the
[`strategy digest`](docs/strategy/WORKTRAIL_CONVERSATION_DIGEST.md), and the
[`Control Tower / Watch Tower v0 RFC`](docs/rfc/control-tower-watch-tower-v0.md).
The existing report baseline is specified in the
[`daily report PRD`](docs/prd/control-tower-daily-report.md). The Project
Identity + Aliases v0 foundation is specified in the
[`Project Identity + Aliases v0 RFC`](docs/rfc/project-identity-aliases-v0.md).
The next deterministic orientation slice is specified in the
[`Daily Attention Digest v0 RFC`](docs/rfc/daily-attention-digest-v0.md).
The completed Fast Resume foundation is specified in the
[`Fast Resume PRD`](docs/prd/fast-resume.md) and
[`ADR 0005`](docs/adr/0005-fast-resume-as-adoption-wedge.md).

## Fast Resume

```sh
worktrail resume "daily report"
worktrail resume "control tower" --json
worktrail resume "safe apply GUI" --limit 5 --db PATH
```

`resume` is task-oriented retrieval; `search` remains lower-level evidence
search and `report` provides time-bounded orientation. Fast Resume returns
explainable signals and inert, copyable command data but never executes Codex.
Its JSON omits transcript excerpts, diffs, raw home paths, and credentials.
Ranking is deterministic and field-aware: strong title/project/workstream/alias
evidence outranks meaningful paths, generic files, and content-only matches.
The JSON response remains schema version 1; project identity ranking uses score
version 3 and additive project/alias signals.
Archived Codex threads are hidden by default; `--include-archived` includes
penalized targets with additive `archived: true` display metadata. Ignored
Worktrail runs remain excluded.
Before returning Fast Resume targets, Worktrail checks the current Codex-local
state for the bounded top candidate set using rollout metadata only. It does
not full-reindex, hydrate transcripts, rebuild FTS, or write to the database on
the normal read path. Active targets stay visible, archived and missing targets
are hidden by default, archived targets remain available with
`--include-archived`, and unknown state is kept rather than hidden.
Use `pnpm worktrail ...` for the equivalent source-development workflow.

For a keyboard-first private launcher, the repository also includes a thin
[Raycast extension](extensions/raycast/README.md). It delegates ranking and
action construction to this CLI. A declared `codex://threads/<UUID>` action
opens the exact local Codex thread only after Raycast asks Worktrail to validate
that target's current source state. The inert `codex resume <UUID>` command
remains available as a copy fallback. Neither path starts a Codex turn.

## Build and install the local CLI

Worktrail is packaged as a compiled ESM CLI. TypeScript remains the source of
truth; `pnpm build` emits `dist/cli.js`, copies the SQLite migrations required
at runtime, and marks the entry point executable. The package `bin` declaration
installs it under the command name `worktrail`.

For a private user-local install without publishing:

```sh
pnpm install
pnpm build
npm install --global --prefix "$HOME/.local" .
```

Add `$HOME/.local/bin` to `PATH` if needed, or call the absolute executable:

```sh
"$HOME/.local/bin/worktrail" index --help
"$HOME/.local/bin/worktrail" search "profile" --json
"$HOME/.local/bin/worktrail" report --since 2026-06-20T00:00:00Z --json
"$HOME/.local/bin/worktrail" resume "profile" --json --limit 5
"$HOME/.local/bin/worktrail" target validate THREAD_UUID --json
```

Re-run `pnpm build` and the `npm install` command after local source changes.
After installing or updating the CLI, run `worktrail index` once. This applies
pending database migrations and incrementally refreshes changed Codex sources;
unchanged sources are skipped. The read-only `resume` and `target validate`
commands never migrate automatically. If they report that the database needs
an update, run `worktrail index` and retry.
For development, `pnpm worktrail ...` remains supported and executes the
TypeScript source directly.

On Node versions that still label `node:sqlite` experimental, a warning may be
written to stderr. JSON mode writes only the JSON document to stdout, so clients
must parse stdout and treat stderr as diagnostics.

### Why not call pnpm forever?

`pnpm --dir <repository> worktrail ...` is acceptable for private dogfood, but
GUI applications have reduced process environments and nested package-manager
launchers are fragile there. It also requires a checkout, installed
dependencies, and pnpm at runtime. A compiled installed executable gives
Raycast one stable process boundary and is a simpler basis for later
distribution. The CLI and versioned JSON contract remain the source of truth in
both modes.

## Requirements

- Node.js 22.5 or newer, with `node:sqlite`
- pnpm 10 or newer for building and development

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

## Daily report

Generate a compact report from already indexed activity:

```sh
pnpm worktrail report --since 2026-06-18T00:00:00Z
pnpm worktrail report --since 2026-06-18T00:00:00Z \
  --until 2026-06-19T00:00:00Z --timezone Europe/Paris --json
```

`--since` is required and accepts an explicit ISO instant. `--until` defaults
to the current time, and `--timezone` defaults to `UTC`. The timezone records
the requested display policy; report boundaries are absolute instants. `--json`
prints the versioned `DailyReport` object directly.

The report uses no model tokens or network calls and never includes evidence
excerpts. For runs whose indexed `cwd` resolves to a local Git repository, it
also reports the repository root, current branch and short HEAD, dirty file
count, and bounded commit/file lists for the requested window. Multiple runs in
the same repository produce one Git entry linked by source IDs.

In both human and JSON output, `git.repositories[].root` is home-normalized
(for example, `~/Documents/worktrail`). Raw absolute roots are used only
internally as Git command working directories and are not part of the report
contract.

```text
Git
1. ~/Documents/worktrail
   Branch: feat/existing-data-daily-report
   HEAD: 862012b
   Dirty: no
   Commits in window: 2
   Files in window: README.md, src/cli.ts, tests/cli-report.test.ts
```

Git collection runs only argument-safe, read-only local commands with time and
output limits. It does not inspect remotes, make network calls, include diffs,
or infer pull requests, checks, reviews, GitHub, or Linear state. Missing and
non-Git directories do not fail the report; bounded diagnostics indicate that
signals were unavailable. Commit and file lists are capped and expose explicit
truncation flags in JSON. The report still describes activity only: completion,
blockage, review, and delivery status are not inferred.

## Project identity and aliases

Indexing reconciles each source thread to one primary local project identity.
Worktrail prefers the repository's local Git common directory, which groups
linked worktrees from the same clone, and falls back to an existing canonical
cwd for non-Git work. It stores an opaque path digest plus a home-normalized
display path; it does not persist Git remotes in the identity projection.

Project identities are derived automatically and are separate from
workstreams. A repository such as `worktrail` is project context; a body of work
such as `Fast Resume` remains a workstream or title intent.

```sh
pnpm worktrail projects list --db PATH
pnpm worktrail projects aliases list --db PATH
pnpm worktrail projects aliases add scaleway SC --allow-write --db PATH
pnpm worktrail projects aliases remove SC --allow-write --db PATH
```

Project alias changes require `--allow-write` because aliases are explicit
correction feedback. Worktrail never infers `SC → scaleway` from a title prefix;
`SC` becomes a project alias only after the add command succeeds. Project
identity currently comes from local Git/cwd observations, not Codex sidebar
grouping. Re-indexing refreshes derived memberships without deleting manual
aliases when a path is temporarily missing or moved.

This identity layer is deterministic and local. It adds no RAG, embeddings,
LLM calls, remote lookup, or project-management workflow.

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
Set the same Codex home for `index`, `resume`, and `target validate`; otherwise
freshness checks may inspect a different source tree than the one that was
indexed. If `--codex-home` is omitted, all three use `$CODEX_HOME` or
`~/.codex`.

Fast Resume freshness is source-state based, not reindex based. The Codex-local
checker compares candidate thread IDs to current rollout metadata under
`sessions/` and `archived_sessions/`; if a previously indexed file disappears,
the state is `missing`. If the source shape cannot be classified safely, the
state is `unknown` and the result is not hidden solely for that reason. The hot
`resume` path stays read-only and does not refresh persistent archive flags.
It performs only a lightweight schema compatibility read before searching. An
older database fails with an actionable `worktrail index` instruction instead
of running migrations on the launcher path.

Validate one target before opening it from a cached or external client result:

```sh
pnpm worktrail target validate THREAD_UUID --json
```

Openable targets return `status: "openable"` plus a Worktrail-declared
`codex://threads/<UUID>` URL. Archived, missing, unknown, and invalid targets do
not return an open URL. `unknown` is fail-closed for opening because Worktrail
could not prove the thread is currently available; run `resume` again or reindex
when that happens. No explicit state-sync command is required for v0 because the
bounded candidate check and click-time validation cover the stale-open failure
without adding a write path or full reindex to launcher search.

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
- Project identity is local to one filesystem/clone. Codex sidebar project
  grouping and automatic title-prefix aliases are unavailable.
- Search is lexical SQLite FTS with deterministic field-aware scoring. It does
  not perform semantic retrieval or full workstream state synthesis.
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
