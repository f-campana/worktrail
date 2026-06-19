# Daily report dogfood validation

Validated on 2026-06-19 against the existing local Worktrail database. This
note contains structural observations only; no transcript evidence, project
content, absolute home paths, or remote URLs are included.

## Commands and windows

The local index was refreshed with `pnpm worktrail index`. Reports were then
generated as JSON with explicit instants and `Europe/Paris` as the display
timezone:

- Last 24 hours: `2026-06-18T14:00:00Z` to `2026-06-19T14:00:00Z`
- Last 7 days: `2026-06-12T14:00:00Z` to `2026-06-19T14:00:00Z`
- Recent implementation activity: `2026-06-19T07:00:00Z` to
  `2026-06-19T14:00:00Z`

## Sanitized structural summary

| Window                | Active workstreams | Unassigned runs | Git repositories | Diagnostics | Resume refs |
| --------------------- | -----------------: | --------------: | ---------------: | ----------: | ----------: |
| Last 24 hours         |                  0 |              11 |                0 |           3 |          11 |
| Last 7 days           |                  0 |              46 |                0 |           7 |          46 |
| Recent implementation |                  0 |               9 |                0 |           2 |           9 |

All emitted repository paths were home-normalized; no raw home path appeared.
Diagnostics were bounded and did not prevent report generation. No Git
repository was detected in these windows, so local Git signals could not add
useful context in this particular dataset. No duplicate or clearly incorrect
repository association appeared.

## Assessment

The explicit window, stable counts, latest activity ordering, and resume
references were useful. The report remained compact and did not expose evidence
content. The main noise was the long flat list of unassigned runs, especially
over seven days. With no manually assigned workstreams, it did not provide a
useful workstream-level summary. The diagnostics correctly indicated missing or
non-Git working directories, but there was no repository context to act on.

Local Git signals improve the report when indexed runs contain a valid local
repository working directory, as covered by synthetic integration tests. This
real dataset did not demonstrate that benefit. Missing today are curated
assignments and a faster way to scan and correct the report's grouping.

The next vertical slice should be a read-only GUI report page before a GitHub
adapter. The local contract and privacy boundary should first be exercised in a
scannable interface; adding remote status now would increase signal volume
without addressing the unassigned-run bottleneck. Correction interactions can
remain a separate, explicitly authorized follow-up.
