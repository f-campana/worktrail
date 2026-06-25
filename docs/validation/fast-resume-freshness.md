# Fast Resume freshness guard validation

- Date: 2026-06-25
- Environment: local installed Worktrail CLI, local SQLite index, macOS
- Resume schema version: 1
- Resume score version: 3

## Source shape checked

The Codex-local adapter was verified against the current local source layout at
metadata level only:

| Fact                          | Observation |
| ----------------------------- | ----------: |
| `sessions/` present           |         yes |
| `archived_sessions/` present  |         yes |
| `session_index.jsonl` present |         yes |
| Active rollout JSONL count    |         425 |
| Archived rollout JSONL count  |         693 |

Active files are stored under date-partitioned `sessions/YYYY/MM/DD/` paths.
Archived files are available under `archived_sessions/`. The checker uses file
presence and location only; it does not read transcript records, evidence text,
attachments, shell snapshots, Codex logs, `auth.json`, or Codex state
databases.

## Implemented model

`CodexLocalAdapter.checkThreadStates` returns `active`, `archived`, `missing`,
or `unknown` observations for candidate source IDs/resume refs. `resume` now
checks the bounded top candidate set after DB ranking and before returning
targets:

- `active`: keep.
- `archived`: hide by default; include with `--include-archived`, `archived:
true`, and archive penalty.
- `missing`: hide by default and do not open.
- `unknown`: keep in search results; fail closed in `target validate`.

No full index, FTS rebuild, import, reconciliation, migration, daemon, watcher,
RAG, embeddings, LLM call, or DB write was added to the hot `resume` path.

No explicit `sync codex-state` command was added for v0. Candidate-level
freshness plus click-time validation covers the stale-open failure without
introducing a second state mutation path. A future sync command can still be
added if users need persistent archive flags refreshed outside search.

## Synthetic archive scenario

The automated fixture creates two indexed Codex-local threads with identical
`Freshness Guard` title evidence. Both rows are initially indexed as active. The
newer candidate's rollout file is then moved from `sessions/YYYY/MM/DD/` to
`archived_sessions/`, leaving the DB stale.

| Step             | Result                                                                          |
| ---------------- | ------------------------------------------------------------------------------- |
| Before move      | stale candidate is eligible as an active DB row                                 |
| State check      | stale candidate reports `archived`; other candidate reports `active`            |
| Default resume   | stale candidate is absent; active candidate remains top                         |
| Include archived | active candidate remains top; stale candidate appears with `archived: true`     |
| Ranking signal   | stale candidate includes `archived-penalty` and scores below the active peer    |
| Missing move     | deleting the rollout file reports `missing`; the missing candidate is not shown |
| Unknown source   | synthetic non-Codex source URI reports `unknown`; it is not falsely hidden      |

The adapter-level state fixture also verifies direct outputs:

| Source metadata case                 | State      |
| ------------------------------------ | ---------- |
| Existing rollout under `sessions/`   | `active`   |
| Existing rollout under archive dir   | `archived` |
| Known Codex rollout path disappeared | `missing`  |
| Outside the known Codex source roots | `unknown`  |

## Target validation

`worktrail target validate <UUID> --json` returns schema version 1. It returns
an open URL only for `openable`:

```json
{
  "schemaVersion": 1,
  "resumeRef": "<sanitized-uuid>",
  "status": "openable",
  "openUrl": "codex://threads/<sanitized-uuid>"
}
```

Archived, missing, unknown, and invalid statuses do not include an open URL.
The synthetic validation fixture covered `openable`, `archived`, `missing`, and
`invalid`. Click-time validation measured 74.6-81.5 ms for an installed
openable target.

Raycast now renders **Open in Codex** as the first action, but the action calls
Worktrail validation before opening. It opens only the returned
`codex://threads/<UUID>` URL when it exactly matches the selected target's
declared action. Archived/missing validation failures show a toast, invalidate
the exact-query cache, and refresh results. Unknown fails closed because the
current thread state could not be proven safe to open. **Copy Codex resume
command** remains the second declared action and still copies an inert command.

Native Raycast UI automation was not available in this pass. Helper tests cover
the parser contract, argument-array invocation, action order, validation client,
cache invalidation primitive, and generation cancellation behavior.

## Cache semantics

The Raycast exact-query cache TTL was reduced from 45 seconds to 10 seconds.
The UI now uses stale-while-revalidate: a cached response can render
immediately, then a background Worktrail refresh replaces it. Cached stale
results cannot open blindly because every primary action validates through
Worktrail first; archived/missing validation failures invalidate the cache entry
and refresh the list.

## Latency

Previous warm installed CLI values from
[`fast-resume-performance.md`](fast-resume-performance.md) were roughly
115-260 ms, with the no-result path at 82-91 ms. Current warm installed CLI
measurements after freshness checks:

| Query                    | Warm run 1 | Warm run 2 | Targets | Top result                               |
| ------------------------ | ---------: | ---------: | ------: | ---------------------------------------- |
| `fodmapp`                |   158.2 ms |   154.5 ms |       5 | `Nightly Loop \| FODMAPP Simplification` |
| `scaleway`               |    66.1 ms |    65.0 ms |       5 | `SC \| Review PieChart component`        |
| `SC`                     |   119.7 ms |   120.1 ms |       5 | `SC \| Review PieChart component`        |
| `shipready`              |    53.2 ms |    53.3 ms |       1 | `Master \| ship-ready`                   |
| `worktrail`              |    48.9 ms |    49.1 ms |       2 | `Master \| worktrail`                    |
| `fast resume`            |   172.0 ms |   173.1 ms |       5 | `Master \| worktrail`                    |
| `github profile`         |   144.1 ms |   144.2 ms |       5 | `Job \| Audit GitHub profile`            |
| `profile`                |    88.3 ms |    87.4 ms |       5 | `Job \| Audit GitHub profile`            |
| fresh no-result sentinel |    15.6 ms |    15.6 ms |       0 | none                                     |

Raycast client-path measurements through the installed executable branch:

| Query         | Client call | Exact-query cache hit | Estimated query to render |
| ------------- | ----------: | --------------------: | ------------------------: |
| `fodmapp`     |    229.2 ms |              0.029 ms |                  349.2 ms |
| `SC`          |    193.2 ms |              0.007 ms |                  313.2 ms |
| `fast resume` |    244.5 ms |              0.009 ms |                  364.5 ms |
| `profile`     |    158.5 ms |              0.005 ms |                  278.5 ms |

The installed CLI remains under the 300 ms acceptable warm budget for the
representative set, and the Raycast path remains under the 500 ms acceptable
query-to-render budget. The candidate freshness check did not add multi-second
delay. A daemon is still not recommended.

## Validation commands

Focused commands run before the full quality gate:

```sh
pnpm typecheck
NODE_NO_WARNINGS=1 pnpm exec tsx --test tests/resume.test.ts tests/worktrail.test.ts tests/cli-resume.test.ts
pnpm --dir extensions/raycast typecheck
pnpm --dir extensions/raycast test
pnpm build
npm install --global --prefix "$HOME/.local" .
```

Full quality-gate results are recorded in the final implementation report.

## Limitations

- The checker depends on the verified local Codex rollout layout. If Codex
  changes active/archive storage shape, affected targets report `unknown`
  rather than being hidden solely by guesswork.
- Persistent DB archive flags are not updated by `resume`; they refresh through
  normal indexing. This is deliberate to keep launcher search read-only.
- Native Raycast interaction was not automated here; helper tests and manual
  inspection cover the code path.
- Broad query ranking behavior is intentionally unchanged except for
  source-state filtering.
