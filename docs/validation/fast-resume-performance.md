# Fast Resume performance validation

- Date: 2026-06-22
- Baseline: `c125247 feat(projects): add durable identities and aliases`
- Host: macOS, Node 22.22.1, pnpm 10.28.2
- Corpus: `~/.worktrail/worktrail.db`, 1.2 GB, 1,109 threads, 304,504 evidence rows, and 640,625 file references

## Budgets

| Path                                    |  Target | Acceptable |
| --------------------------------------- | ------: | ---------: |
| Installed CLI, warm process             | <150 ms |    <300 ms |
| Raycast query to rendered results, warm | <300 ms |    <500 ms |
| First cold query                        |       — |  <1,000 ms |

Behavioral requirements are no repeated multi-second spinner and no stale result flashes.

## Method

The baseline was rebuilt from a detached worktree at `c125247`. Every measurement invokes the directly executable built CLI against the same live database. Warm values are repeated process invocations after a priming query. Cold values are the first observed process after a build or after the baseline's large scans displaced database pages; they are OS-cache observations, not a forced hardware-cache purge.

The no-result query used a freshly generated single token of the form `qzxv<timestamp>xkcdnonce`. The literal value is intentionally not committed because committed validation text is indexed in later runs.

`--debug-timing` is opt-in. It emits one privacy-safe JSON timing record to stderr with command and phase names only. JSON results remain the only stdout content.

## Baseline

The first serial `fodmapp` query took 6,575 ms. Repeated process invocations remained multi-second; process startup itself was only 69–75 ms (`worktrail help`). A fresh no-result token still took 2,082–2,163 ms, proving that result rendering and JSON size were not the cause.

| Query                  |  Baseline warm | Baseline top result                      |
| ---------------------- | -------------: | ---------------------------------------- |
| `fodmapp`              | 4,239–5,253 ms | `Nightly Loop \| FODMAPP Simplification` |
| `scaleway`             | 2,236–2,292 ms | `SC \| Review PieChart component`        |
| `SC`                   | 4,101–4,152 ms | `SC \| Review PieChart component`        |
| `shipready`            | 2,142–2,174 ms | `Write MCP plan spec`                    |
| `worktrail`            | 1,990–2,019 ms | `Add project identity aliases`           |
| `fast resume`          | 3,317–3,367 ms | `Add project identity aliases`           |
| `github profile`       | 3,013–3,018 ms | `Job \| Audit GitHub profile`            |
| `profile`              | 2,658–2,676 ms | `Job \| Audit GitHub profile`            |
| fresh runtime sentinel | 2,082–2,163 ms | no result                                |

## Findings

- `resume` opened the database in writable mode, set WAL mode, created the parent directory, created `schema_migrations` if needed, and checked every migration on every process. It did not run project identity reconciliation; reconciliation is confined to import/index work.
- `projectThreadMatches` joined every primary project membership to complete `search_documents` rows before filtering projects in JavaScript. The searchable documents contain about 321 MB of transcript-derived searchable text. This unconditional load explains the multi-second no-result query.
- The FTS candidate query selected complete searchable text for up to 200 candidates. JavaScript needed exact field-presence information for scoring, but did not need to retain transcript-sized strings.
- Evidence and related-file queries ran for every search result before the final resume limit was applied.
- Project identity joins themselves are small. Loading the joined document bodies, not the identity model or alias count, was expensive.
- JSON serialization is consistently about 0.04 ms and is not material.
- Installed Node process startup is about 70 ms. It is material against the 150 ms target but was not the baseline bottleneck.
- Node's experimental SQLite warning is 169 bytes on stderr. Capturing it is not a measurable bottleneck, so warning behavior was not changed.
- Raycast already debounced for 250 ms and aborted the previous process, but every settled query spawned a new CLI process, loading state started before the debounce elapsed, and exact repeated queries were not cached.

## Changes

- `resume` now opens SQLite read-only with `query_only`, skips directory creation, WAL mutation, and migration checks, and performs no reconciliation.
- Project metadata is filtered and ranked before document fields are loaded. Only potentially returned project rows load document fields.
- FTS candidate rows no longer transfer complete searchable text. Exact content-term checks run inside SQLite only for candidates that can affect the requested resume limit.
- Evidence and related files are hydrated only for candidates relevant to the requested resume limit. A full-search fallback preserves canonical-workstream correctness when grouping collapses too many candidates.
- Ranking formulas, score version 3, schema version 1, archive/ignore behavior, aliases, deterministic ordering, and declared actions are unchanged.
- `--debug-timing` and `WORKTRAIL_TIMING=1` provide stderr-only phase measurements.
- Raycast debounce is 120 ms. The loading state begins only when execution starts, a request coordinator aborts and invalidates older requests, and a 45-second session cache stores only complete CLI responses keyed by exact query and all search preferences.

## After

The first observed post-build `fodmapp` query took 620 ms. All repeated installed CLI processes are below the 300 ms acceptable budget. Required-query outputs were compared as complete schema-v1 responses, excluding only `generatedAt`, against `c125247`; they were identical.

| Query                  | After warm | Budget     | Result verification      |
| ---------------------- | ---------: | ---------- | ------------------------ |
| `fodmapp`              | 230–255 ms | acceptable | exact response preserved |
| `scaleway`             | 131–138 ms | target     | exact response preserved |
| `SC`                   | 187–192 ms | acceptable | exact response preserved |
| `shipready`            | 122–125 ms | target     | exact response preserved |
| `worktrail`            | 115–118 ms | target     | exact response preserved |
| `fast resume`          | 240–260 ms | acceptable | exact response preserved |
| `github profile`       | 219–229 ms | acceptable | exact response preserved |
| `profile`              | 157–159 ms | acceptable | exact response preserved |
| fresh runtime sentinel |   82–91 ms | target     | no result                |

Representative warm internal timings show SQLite open at 0.15–0.20 ms, connection setup at about 0.03 ms, FTS candidates at 1–23 ms, identity fallback at 0–3 ms, project identity work at 6–44 ms, selected content checks at 1–12 ms, selected result hydration at 12–34 ms, and serialization at about 0.04 ms. Candidate field analysis remains the largest query-dependent in-process cost; process startup is the largest fixed cost.

## Raycast path

Direct measurements through the Raycast client module include executable/path resolution, CLI execution, JSON parsing, and schema validation. Native React rendering was not separately observable, so the query-to-render estimate adds the configured 120 ms debounce and excludes a small native render cost.

| Query         | Client call | Exact-query cache hit | Estimated query to render |
| ------------- | ----------: | --------------------: | ------------------------: |
| `fodmapp`     |      242 ms |              0.008 ms |                    362 ms |
| `SC`          |      204 ms |              0.009 ms |                    324 ms |
| `fast resume` |      251 ms |              0.009 ms |                    371 ms |
| `profile`     |      164 ms |              0.008 ms |                    284 ms |

The measured estimates meet the <500 ms acceptable budget. The <300 ms target is met for faster queries and cache hits, but not every uncached query. Loading is no longer shown during the debounce window. A changed query clears old results, the prior child process is aborted, and generation checks prevent a late result from rendering as current.

## Future option: local Worktrail daemon

| Option                             | Tradeoff                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Installed CLI per query            | Simple privacy and lifecycle model; currently 115–260 ms warm, including about 70 ms startup                                      |
| Raycast debounce and session cache | Keeps Raycast thin; exact repeats are effectively immediate and uncached interaction stays below 500 ms                           |
| Long-lived local daemon/API        | Could remove process startup and retain database pages, but adds lifecycle, authentication, upgrade, and failure-state complexity |
| Raycast direct library import      | Avoids spawn cost but couples Raycast to storage/runtime internals and weakens the thin-client contract                           |

A daemon is not recommended in this slice. The CLI and Raycast paths meet all acceptable budgets. Consider a daemon only if native measurements later require the <300 ms target for every uncached query and another roughly 70–120 ms cannot be removed safely from the process path.

## Conclusion

Status: ready to merge after the recorded validation commands pass. The main bottleneck was unconditional large-document loading, not migrations, reconciliation, aliases, JSON, or process startup. Warm CLI latency improved by roughly 11–22× and the launcher path no longer has a repeated multi-second spinner. Remaining risk is machine- and OS-cache-dependent variance around the aspirational 150 ms CLI and 300 ms Raycast targets; all acceptable budgets are met without a daemon or schema break.
