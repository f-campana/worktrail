# Fast Resume dogfood validation

Validated on 2026-06-20 against the refreshed default local Worktrail database.
This note contains structural observations only. It excludes transcript excerpts,
diffs, credentials, source IDs, private titles, and raw home paths.

## Commands run

The local index was refreshed before evaluation:

```sh
pnpm worktrail index
```

The following queries were run through `pnpm worktrail resume`, primarily with
`--json`. Each JSON query was repeated to check deterministic ordering and was
also run with `--include-archived` to check the default archive boundary. The
Worktrail and empty-state queries were additionally rendered as human output.

```sh
pnpm worktrail resume "worktrail daily report"
pnpm worktrail resume "fast resume" --json
pnpm worktrail resume "control tower" --json
pnpm worktrail resume "git signals" --json
pnpm worktrail resume "shipready" --json
pnpm worktrail resume "fodmapp" --json
pnpm worktrail resume "safe apply" --json
pnpm worktrail resume "resume.ts" --json
pnpm worktrail resume "raycast" --json
pnpm worktrail resume "zzzznonexistenttoken987654"
```

## Sanitized results

“Strong alternates” counts alternates with a title, file, or workstream-name
signal. “Top felt correct” is a qualitative assessment from the returned signal
structure and known query intent, without exposing private result content.

| Query                        | Results | Top kind | Confidence | Resume command | Top felt correct | Strong alternates | Top signals            | Archived/noisy results |
| ---------------------------- | ------: | -------- | ---------- | -------------- | ---------------- | ----------------: | ---------------------- | ---------------------- |
| `worktrail daily report`     |       5 | run      | high       | yes            | plausible        |                 3 | content, file, recency | none observed          |
| `fast resume`                |       5 | run      | high       | yes            | yes              |                 1 | title, file, recency   | none observed          |
| `control tower`              |       5 | run      | high       | yes            | plausible        |                 3 | content, recency       | top less specific      |
| `git signals`                |       5 | run      | high       | yes            | plausible        |                 3 | content, recency       | top less specific      |
| `shipready`                  |       0 | none     | n/a        | n/a            | yes              |                 0 | none                   | archived only          |
| `fodmapp`                    |       5 | run      | high       | yes            | yes              |                 4 | file, recency          | none observed          |
| `safe apply`                 |       5 | run      | high       | yes            | plausible        |                 4 | content, recency       | several close matches  |
| `resume.ts`                  |       5 | run      | high       | yes            | yes              |                 4 | title, file, recency   | none observed          |
| `raycast`                    |       5 | run      | high       | yes            | uncertain        |                 0 | content, recency       | content-only matches   |
| `zzzznonexistenttoken987654` |       0 | none     | n/a        | n/a            | yes              |                 0 | none                   | none observed          |

All repeated results retained the same ordering after excluding `generatedAt`
from comparison. The default result set did not leak archived runs. The
`shipready` query returned no active result but did return archived results when
explicitly requested, demonstrating that the archive boundary affected real
data. The deliberately absent query produced one clear human-output line.

The JSON and human-output checks found no evidence excerpt field, raw home path,
or common credential marker. Commands remained inert data; no Codex process was
executed.

## Contract issue found and fixed

Initial dogfood omitted every resume command and emitted multiple
`unsafe-resume-ref` diagnostics. Current Codex source references use UUIDv7,
while the validator accepted only UUID versions 1 through 5. The validator now
accepts RFC 9562 UUID versions 1 through 8 while preserving the UUID variant and
canonical-shape checks. A regression test covers a UUIDv7 command and rejection
of a shell-unsafe reference.

This changes contract values, not the JSON shape: valid UUIDv7 targets now have
`resumeCommand`, structured `command`, and a `copy-command` action. The schema
and score versions remain `1`.

## What worked

- Current-feature and file-oriented queries produced explainable top results.
- Older-project retrieval worked through file signals.
- Copyable text commands and structured commands agreed after the UUIDv7 fix.
- Alternates were useful when title or file signals were present.
- Ordering, limit behavior, archive exclusion, and privacy behavior were stable.
- Human output remained compact and the no-result state was explicit.

## What was noisy

- All non-empty queries reported high confidence, including content-only
  matches. Confidence therefore did not distinguish the strongest title/file
  matches from the less independently trustworthy `raycast` result.
- Content signals explain which query term matched, but intentionally do not
  reveal enough private evidence to independently verify the match.
- Several broad queries returned four close alternates. That is useful for
  selection but indicates lexical ambiguity rather than a decisive best target.

## What is missing

- This database had no active canonical workstream represented in the result
  set, so real canonical rendering was not exercised.
- Candidate workstreams remain intentionally absent.
- Confidence calibration needs a larger labeled corpus, especially for
  single-term content-only matches. This is evaluation work, not a reason to
  expose excerpts or add semantic retrieval in this slice.

## Raycast readiness

**Is the `ResumeSearchResult` JSON contract ready for a thin Raycast wrapper?**
Yes, for a thin local search-and-copy wrapper after the UUIDv7 fix.

Each target has sufficient display metadata, ordered signals, related-run/file
context, and declared copy actions. The structured command is sufficient for a
client that renders or copies commands without executing them. Alternates are
deterministically ordered, diagnostics are actionable, and no JSON field appears
likely to require an immediate shape change. Raycast should treat confidence as
a ranking label rather than a calibrated probability and should keep the signal
labels visible for content-only results.

Raycast should proceed next as a deliberately thin wrapper over schema version
1: query, render ordered targets, and copy declared actions. It should not own
ranking, infer commands, execute Codex, or add candidate grouping. A small
labeled launcher dogfood set should accompany that spike to measure whether
content-only high-confidence results cause wrong selections.
