# Raycast Fast Resume dogfood validation

Validated on 2026-06-20 against the existing default local Worktrail database.
This note contains structural observations only. It excludes result titles,
source IDs, transcript excerpts, diffs, credentials, remote URLs, private
content, and raw home paths.

## Method

Each query was run through the Raycast extension's actual client path. That path
uses argument-array process execution, invokes `pnpm --silent --dir <project>
worktrail resume <query> --json --limit 5`, and parses the result with the local
schema-v1 compatibility layer. The database was not re-indexed or mutated.

The Raycast production build, TypeScript check, and helper tests passed. A
`ray develop` session compiled successfully against the running Raycast app.
Direct end-to-end keyboard/copy interaction was not automated because the
command requires its one-time project-path preference and this environment does
not grant terminal UI automation permission. The UI-actionability assessments
below therefore review the compiled native `List`, detail, empty-state, and
`Action.CopyToClipboard` paths with the real parsed results; they do not claim a
manual clipboard verification.

## Sanitized results

“Useful alternates” counts alternates supported by a title, file, or workstream
name signal. “UI easier” compares the compiled launcher interaction to selecting
and copying text from CLI output.

| Query                        | Results | Top kind | Confidence | Copy command | Top assessment  | Useful alternates | UI easier                                       | Contract gap |
| ---------------------------- | ------: | -------- | ---------- | ------------ | --------------- | ----------------: | ----------------------------------------------- | ------------ |
| `worktrail`                  |       5 | run      | high       | yes          | plausible       |                 2 | yes; one primary copy action                    | none         |
| `fast resume`                |       5 | run      | high       | yes          | correct         |                 1 | yes; strong file/title signals are visible      | none         |
| `control tower`              |       5 | run      | high       | yes          | plausible       |                 3 | yes; alternates remain keyboard-selectable      | none         |
| `git signals`                |       5 | run      | high       | yes          | plausible       |                 3 | yes; alternates remain keyboard-selectable      | none         |
| `shipready`                  |       0 | none     | n/a        | n/a          | correct empty   |                 0 | yes; explicit no-result state                   | none         |
| `fodmapp`                    |       5 | run      | high       | yes          | correct         |                 4 | yes; file signal and copy action reduce steps   | none         |
| `safe apply`                 |       5 | run      | high       | yes          | plausible/broad |                 4 | yes; details help compare close matches         | none         |
| `resume.ts`                  |       5 | run      | high       | yes          | correct         |                 4 | yes; title/file signals are immediately visible | none         |
| `raycast`                    |       5 | run      | high       | yes          | noisy/uncertain |                 0 | somewhat; content-only uncertainty is visible   | none         |
| `zzzznonexistenttoken987654` |       0 | none     | n/a        | n/a          | correct empty   |                 0 | yes; explicit no-result state                   | none         |

Every non-empty top result exposed a text resume command and a declared
`copy-command` action. All ten responses had zero diagnostics. No canonical or
candidate workstream appeared in this real-data corpus.

## Finding fixed during dogfood

The first wrapper invocation used `pnpm --dir ...`, which prepended pnpm's
lifecycle banner to stdout and made the otherwise valid JSON unparsable. The
wrapper now passes `--silent` as a separate pnpm argument. Stdout then contains
only `ResumeSearchResult`, and the full corpus parses through the extension.
This was an invocation issue, not a JSON schema or Worktrail CLI contract gap.

## Live user test: pnpm not found from Raycast

A live launch of **Resume Worktrail** reached the extension UI, but searching
failed before results rendered because the Raycast process could not start
`pnpm`. The likely cause is the macOS app environment not inheriting the
interactive Terminal `PATH`.

The extension now accepts an optional absolute **pnpm executable path** and
resolves pnpm in this order: the configured executable, Raycast's `PATH`, then
common Homebrew and user-local installation paths. Resolution checks and CLI
execution remain argument-array based; no query or path is interpolated into a
shell. If resolution fails, the UI directs the user to run `which pnpm` and set
the command preference.

Automated helper tests cover every resolution branch. Post-fix checks through
the extension's actual client path returned five results each for `profile
github`, `fast resume`, and a known-good Worktrail query; every top result
exposed a copy-command action. The production build and a `ray develop` session
both compiled successfully.

An additional process-level check removed pnpm's installation directory from
`PATH`. Automatic common-path fallback and an explicit executable preference
both still returned ranked results. The child process receives the resolved
pnpm directory and active Node runtime directory on its private `PATH`, which
supports pnpm launchers that use `#!/usr/bin/env node` without changing the
extension process environment.

Native search and clipboard interaction could not be driven because this Codex
environment has no Raycast UI automation access. A user pass is still required
to confirm the configured executable inside the native command. The extension
continues to depend on pnpm until an installed Worktrail binary mode is added.

## Privacy and safety observations

- The structural capture contained no target titles, source IDs, evidence
  excerpts, transcript content, diffs, credentials, remote URLs, or raw home
  paths.
- The UI never renders signal source IDs or related-run source IDs.
- Errors are bounded and scrub configured paths, home paths, and URL
  credentials; stdout and stderr are not logged.
- Copy actions remain inert. Neither the dogfood client nor the UI invokes
  Codex, Terminal, or a Worktrail mutation.

## Remaining limitations

- Confidence remains weakly discriminating: all non-empty top results were
  `high`, including the content-only `raycast` result.
- Broad queries still require comparing alternates.
- Candidate workstreams are supported by the local type/parser but are not
  generated by Worktrail.
- Canonical/candidate rendering was not exercised by this dataset.
- A manual Raycast pass should confirm the global-hotkey-to-clipboard feel after
  the one-time local preferences are configured.
