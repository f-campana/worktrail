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

## Live user test: project path passed as literal ~

After pnpm executable resolution was fixed, a live search started pnpm but
failed with a sanitized command containing `--dir ~`. The configured
**Worktrail project path** was `~`. Because the extension deliberately uses
shell-free argument-array execution, no shell expanded that token; pnpm
received a literal `~` directory.

The extension now expands `~` and `~/...` filesystem preferences with the local
home-directory API. It applies the same expansion to the optional database
path. Before resolving or spawning pnpm, it requires the resulting project path
to be a directory with a parseable Worktrail `package.json`. Invalid values
produce an actionable, home-normalized preference error instead of a generic
command failure. Unsupported other-user forms such as `~otheruser/...` are
rejected, and execution remains shell-free.

Automated helper coverage verifies expansion, pre-spawn rejection, resolved
`--dir` and `--db` arguments, home-normalized errors, and argument-safe queries.
Post-fix root formatting, typecheck, 45 tests, UI build, and diff checks passed.
The extension formatting, typecheck, 20 helper tests, production build, and a
`ray develop` compile/import also passed; the development process was then
intentionally stopped. `ray lint` remains blocked by the known private-author
lookup and missing-ESLint limitation.

A structural check through the actual extension client with
`~/Documents/worktrail` returned five results for `github profile`, `profile
github`, and `fast resume`; each top target exposed a copy-command action. A
guaranteed no-result query returned a clean zero-target response. A native user
pass is still required to verify the preference and rendering inside Raycast.
Recommended values are the absolute result of `which pnpm` and
`~/Documents/worktrail` (or the absolute repository path).

The remaining limitation is that Worktrail must still be run from a local
repository through pnpm; there is no installed-binary mode. A value of `~`
correctly resolves to the home directory but is rejected unless that directory
itself contains Worktrail's `package.json`.

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
- The global-hotkey timing comparison against Codex sidebar search was not
  measured in this pass.

## Raycast integration boundary research

Official Raycast documentation establishes that a native extension is a
TypeScript entry point plus a manifest, required command preferences are set
before the command opens, `Action.CopyToClipboard` is the native copy primitive,
and `ray develop` imports/reloads commands while surfacing logs and stack traces.
Script Commands are intentionally simpler: they execute a script, accept up to
three arguments, and present limited stdout-based output. References:
[file structure](https://developers.raycast.com/information/file-structure),
[preferences](https://developers.raycast.com/api-reference/preferences),
[actions](https://developers.raycast.com/api-reference/user-interface/actions),
[clipboard](https://developers.raycast.com/api-reference/clipboard),
[developer CLI](https://developers.raycast.com/information/developer-tools/cli),
and [Script Commands](https://manual.raycast.com/script-commands).

| Model                            | Setup friction                                                           | Raycast reliability                                                                                             | Privacy / locality                 | Distribution readiness    | Testability                           | CLI/JSON remains source of truth              | Drift risk                                                                     |
| -------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------- | ------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Repository `pnpm --dir`          | high: pnpm, checkout, dependencies, and two paths                        | medium after explicit executable/path hardening; nested tools still depend on child environment                 | local                              | poor                      | high at the process/contract boundary | yes                                           | low                                                                            |
| Installed `worktrail` executable | medium once, then low; configure an absolute executable or stable `PATH` | high; one process boundary and no repository launcher chain                                                     | local                              | best medium-term option   | high                                  | yes                                           | low                                                                            |
| Direct shared-library import     | medium/high packaging and version coupling                               | potentially high in-process, but Raycast bundling and native dependency compatibility become extension concerns | local                              | medium                    | high unit testability                 | no: bypasses the CLI/JSON boundary            | medium                                                                         |
| Local HTTP/API server            | high: lifecycle, port, authentication, and health handling               | medium only if the server is already supervised                                                                 | local but adds a listening surface | poor for this wedge       | high integration testability          | yes if the endpoint returns the same contract | low in Raycast, higher operationally                                           |
| Script Command                   | low for personal setup                                                   | medium: interpreter and `PATH` still vary                                                                       | local                              | poor for a ranked rich UI | good for shell/process smoke tests    | yes                                           | low, but its limited UI would discard the current result comparison experience |

Conclusion: `pnpm --dir <repo> worktrail resume ...` remains acceptable for
private dogfood, where the checkout and package manager are intentional setup
dependencies. It is not the correct long-term distribution boundary. The next
integration target should be an installed `worktrail` executable selected by
absolute preference or a stable `PATH`. Raycast should stay a thin client over
the versioned Worktrail CLI/JSON result; direct import is not preferred because
it bypasses that boundary, and a local server is unjustified operational scope.
A Script Command is useful as a smoke-test comparison but cannot replace the
native ranked list and declared copy actions.

## Native Raycast closing pass

Environment and artifact: macOS 26.2 arm64, Node 25.8.1, pnpm 10.28.2, and
`@raycast/api` 1.104.19. The privacy-safe structural capture is
[`raycast-fast-resume-logs/native-closing-pass.json`](raycast-fast-resume-logs/native-closing-pass.json).
Preferences were `/opt/homebrew/bin/pnpm`, `~/Documents/worktrail`, limit 5,
archived results off, and either no database preference or
`~/.worktrail/worktrail.db`.

The supplied native screenshot for `profile` captured the hardened failure
state: **Worktrail CLI exited with code 254**, no stdout/stderr, a
home-normalized command summary, and a visible **Copy Debug Command** action.
That made the failure actionable without exposing a home path, transcript,
diff, credential, source ID, or command UUID.

The root cause was reproduced exactly outside Raycast. Running the same pnpm
invocation with a reduced child `PATH` containing only `/opt/homebrew/bin`
returned code 254 with zero stdout/stderr. pnpm's error handler exits with the
underlying numeric `errno`; `ENOENT` is `-2`, which appears as process status
254, while `--silent` suppresses the reporter. A direct reduced-path probe of
the repository-local `tsx` launcher confirmed that `sed`, `dirname`, and `uname`
were unavailable, after which its module path could not be constructed. Those
standard macOS executables were not guaranteed by Raycast's inherited `PATH`.

The extension now appends `/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/sbin`, and
`/sbin` to the child `PATH` while retaining the configured pnpm directory, Node
directory, and inherited entries. Under the same reduced-path reproduction, the
patched environment exited 0, produced valid JSON-only stdout, returned five
targets, and emitted no stderr. This is the precise fix for the captured native
failure.

Both database modes were tested through the extension's actual client path and
returned identical results:

| Query                        | Results | Top target                          | Kind | Confidence | Copy action                                    | Diagnostics |
| ---------------------------- | ------: | ----------------------------------- | ---- | ---------- | ---------------------------------------------- | ----------: |
| `profile`                    |       5 | `Plan \| fabien-campana.dev launch` | run  | high       | declared value exactly matched `resumeCommand` |           0 |
| `github profile`             |       5 | `Plan \| fabien-campana.dev launch` | run  | high       | declared value exactly matched `resumeCommand` |           0 |
| `fast resume`                |       5 | `Validate resume usefulness`        | run  | high       | declared value exactly matched `resumeCommand` |           0 |
| `zzzznonexistenttoken987654` |       0 | none                                | n/a  | n/a        | n/a                                            |           0 |

The direct Terminal invocation exited 0, began stdout with JSON, parsed as one
`ResumeSearchResult` with five targets, and emitted empty stderr. The Node SQLite
experimental warning was not observed in this environment. The extension only
parses stdout, so a warning on stderr is harmless; a warning on stdout is
classified as invalid JSON instead of being guessed around.

The native extension compiled, imported, and registered successfully. A
deeplink reached Raycast's confirmation dialog, but this Codex process could not
send the confirmation keystroke because macOS denied `osascript` Accessibility
permission. The user's post-fix native screenshot then confirmed that `profile`
rendered five ranked targets with the selected target's confidence, match
signals, kind, score, resume availability, and **Copy Codex resume command**
primary action visible. The user pressed Enter on the selected target and pasted
the copied value into a non-executing text field. A process check compared the
clipboard value to the selected top target's declared `copy-command` action:
the action existed, the values matched exactly, and the value matched the inert
`codex resume <UUID>` shape. The command and UUID were not printed by the check
or stored in this repository. Codex was never executed. Temporary full-screen
screenshots were deleted because they contained unrelated desktop content. The
user's cropped screenshots were reviewed but not stored in the repository
because the success image contains a command UUID.

Ranking observation: `profile` is broad and noisy. Its first two results both
scored 0.99/high, but the file-matched `Plan | fabien-campana.dev launch` ranked
above the title-matched `Job | Audit GitHub profile`. `github profile` is the
better-intent query, although this corpus still returned the same top result.
Future ranking work should strengthen title/phrase weighting and make confidence
less saturated. Ranking is intentionally unchanged in this closing pass.

The functional loop is now native search → inspect ranked target → Enter to
copy, without automatic Codex or Terminal execution. A subjective timing
comparison against Codex sidebar search was not recorded, so this note makes no
unsupported speed claim. The recommended next task is to package an installed
`worktrail` executable and add a configurable executable preference, preserving
the current CLI/JSON contract and removing pnpm/repository setup from the
Raycast distribution boundary.

## Installed executable pass

Validated on 2026-06-21. Worktrail now compiles its TypeScript sources to ESM in
`dist`, copies the three SQLite migrations beside the compiled database module,
and exposes `dist/cli.js` through the package `worktrail` bin declaration. The
compiled entry point preserves its Node shebang and is marked executable. A
temporary-prefix `npm install --global` check created an executable
`<prefix>/bin/worktrail`; its help ran successfully and all three runtime
migrations were present. No global test installation was left behind.

Direct built-CLI checks for `resume "profile"`, `resume "github profile"`,
`search "profile"`, and a time-bounded `report` all exited zero and returned
parseable JSON on stdout. Both resume responses used schema version 1 and
returned five targets. The top `copy-command` value exactly matched the target's
declared `resumeCommand`. The existing `pnpm --silent worktrail resume ...`
development path returned the same schema and target count. All captured stderr
files were empty; a future Node SQLite warning on stderr remains harmless
because clients parse stdout only.

The four native-closing queries were then exercised through the Raycast
client's actual installed-executable branch using the absolute generated
`dist/cli.js` path and no project/pnpm preferences:

| Query                        | Schema | Results | Diagnostics | Copy action | Declared value match |
| ---------------------------- | -----: | ------: | ----------: | ----------- | -------------------- |
| `profile`                    |      1 |       5 |           0 | yes         | yes                  |
| `github profile`             |      1 |       5 |           0 | yes         | yes                  |
| `fast resume`                |      1 |       5 |           0 | yes         | yes                  |
| `zzzznonexistenttoken987654` |      1 |       0 |           0 | n/a         | n/a                  |

This confirms executable preference resolution, shell-free argument passing,
stdout-only parsing, schema validation, ranked results, and the clean empty
response without invoking pnpm. The UI and copy-action rendering code is
unchanged. Codex and Terminal were not executed.

Native interaction still requires the Raycast app and user input. To close that
last UI-specific check:

1. Build and install Worktrail, then set **Worktrail executable path** to the
   absolute installed path (for example
   `/Users/<name>/.local/bin/worktrail`).
2. Clear the Worktrail project and pnpm fallback preferences.
3. Run `profile`, `github profile`, `fast resume`, and
   `zzzznonexistenttoken987654` in **Resume Worktrail**.
4. Confirm three ranked-result views and one clean no-result view.
5. On one result, press Enter to copy, paste into a non-executing text field,
   and confirm it is the selected target's declared `codex resume <UUID>`
   action. Do not execute the pasted command.

The pnpm/project path remains supported strictly as development fallback. The
installed executable is now the preferred normal-use boundary, while Worktrail's
CLI/JSON contract remains the source of ranking and action data.

Validation completed with 46/46 root tests and 36/36 Raycast helper tests.
Root formatting, typecheck, CLI build, UI production build, and diff checks
passed. Raycast formatting, typecheck, production build, and a `ray develop`
compile/import passed. `ray lint` remains blocked only by the existing private
author lookup returning 404; it also reports that ESLint is not installed and
therefore skips that check.

## Installed executable native closing pass + Codex open investigation

Validated on 2026-06-21. Worktrail was built and installed at
`~/.local/bin/worktrail`; its default-database `resume` output used schema 1,
clean JSON stdout, empty stderr, and declared `open-codex` before
`copy-command`. The existing native Raycast setup remained in the
installed-executable branch with project/pnpm preferences absent from the
earlier installed-path pass. The database preference remained empty, so
Worktrail used `~/.worktrail/worktrail.db`; the earlier explicit-database check
had already produced identical results.

### Keyboard-first behavior

Raycast supports command aliases, global hotkeys, and manifest arguments. The
command now declares one optional text argument, **What you remember**. Native
screenshots confirmed that the alias `resume` exposes this argument and that
`github profile` reaches the extension search field and returns five ranked
targets. They also exposed an interaction boundary: typing `resume github
profile` as one uninterrupted Root Search string can remain an ordinary root
query. The reliable alias flow is to type `resume`, let Raycast enter the
argument field (alias plus space), then type the query and press Enter.

A dedicated hotkey is the shortest reliable route because it opens **Resume
Worktrail** directly and focuses its internal search. A Script Command would
add another launcher and shell boundary while losing the native ranked detail
view; it is not a better fit now that the extension has a supported argument.

### Direct Codex opening

Local `codex --help`, `codex resume --help`, and `codex app --help` established
that `codex resume <UUID>` resumes in the terminal TUI and `codex app [PATH]`
opens a workspace, not a selected thread. The installed app alone can be
launched with `open -a Codex`, but that does not select the target.

The current official Codex app command reference documents the canonical
`codex://threads/<thread-id>` deep link, with the session UUID as `thread-id`.
Worktrail now declares this inert URL only after the same UUID validation used
for its resume command. Raycast additionally requires that the URL be a
UUID-shaped `codex://threads/` URL exactly matching the selected target's
`resumeRef`, then renders it through native `Action.Open`. It does not construct
URLs, invoke a shell, or run Codex CLI.

Controlled local testing opened the top `github profile` result. Codex selected
the exact **Plan | fabien-campana.dev launch** thread shown by Worktrail. The
composer remained empty and no new turn or agent work started. This is outcome
A: exact-thread open is supported and verified, so **Open in Codex** is the
primary Enter action. **Copy Codex resume command** remains secondary.

### Query and action pass

The installed executable produced the following default-database results. The
native `github profile` view confirmed five targets, visible high confidence,
the selected target detail, and **Open in Codex** as the primary action. The
earlier native clipboard pass remains applicable to the same native
`Action.CopyToClipboard` path: its pasted value exactly matched the selected
target's declared `resumeCommand` without being executed.

| Query                        | State   | Top result                          | Confidence | Primary action | Assessment                       |
| ---------------------------- | ------- | ----------------------------------- | ---------- | -------------- | -------------------------------- |
| `profile`                    | results | `Plan \| fabien-campana.dev launch` | high       | Open in Codex  | plausible but broad/noisy        |
| `github profile`             | results | `Plan \| fabien-campana.dev launch` | high       | Open in Codex  | plausible; exact thread verified |
| `fast resume`                | results | `Validate resume usefulness`        | high       | Open in Codex  | correct/plausible                |
| `worktrail`                  | results | `Validate resume usefulness`        | high       | Open in Codex  | plausible but broad              |
| `shipready`                  | empty   | —                                   | —          | —              | clean empty state                |
| `zzzznonexistenttoken987654` | empty   | —                                   | —          | —              | guaranteed clean empty state     |

Every result-bearing top target declared a secondary copy action. Installed-CLI
checks confirmed that each copy value exactly matched its target's declared
`resumeCommand`; the native action remains visible behind the primary open
action. No Codex command was executed.

### Speed and friction

The reliable alias path is roughly: open Raycast, enter `resume` argument mode,
type the query, open results, press Enter on the target. A dedicated command
hotkey removes the Root Search/alias transition: hotkey, type query, Enter.
Codex sidebar search requires switching to Codex, opening thread search, typing
the query, and selecting a result. The hotkey route is materially shorter; the
alias route is similar in interaction count but benefits from Worktrail's
ranked signals and now lands directly on the exact thread. Copy-only resume was
too indirect for the intended loop, but it is useful as a fallback.

Broad `profile` remains noisy and overconfident: it returns the same top target
as `github profile`. This is a ranking follow-up, deliberately outside this
pass. The extension is ready to merge for the intended fast-resume loop. The
recommended next task is a focused ranking evaluation for broad versus
intent-qualified queries, not more launcher or packaging work.

### Final validation

- Root: format check, typecheck, 46/46 tests, UI production build, and
  `git diff --check` passed.
- Raycast: format check, typecheck, 37/37 tests, production build, and native
  `ray develop` compile/import passed.
- `ray lint` remains non-enforced for this private extension: Raycast's author
  lookup returns 404 for `fabiencampana`, and ESLint is not installed. Its
  Prettier phase passed independently through the enforced format check.

## Daily-use ranking and presentation pass (2026-06-21)

The focused source audit and before/after corpus are recorded in
[`fast-resume-ranking-evals.md`](fast-resume-ranking-evals.md). The live index
contains the user-expected `SC | Review PieChart component` target as an active
thread with cwd `~/Documents/scaleway`; ranking, not missing metadata or archive
filtering, caused the original failure.

### Specific failure before and after

| Query                | Before top result                 | Before                     | After top result      | After                      | Explanation after                |
| -------------------- | --------------------------------- | -------------------------- | --------------------- | -------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| `scaleway`           | `Review backend positioning`      | 0.99 high                  | `SC                   | Review PieChart component` | 0.94 high                        | exact project path `scaleway`; recency only breaks ties among active project matches |
| `SC`                 | `Inspect Roundtable domain model` | 0.99 high                  | `SC                   | Review PieChart component` | 0.95 high                        | delimited title prefix `SC`                                                          |
| `review piechart`    | expected target                   | 0.99 high                  | expected target       | 0.93 high                  | title phrase                     |
| `piechart component` | expected target                   | 0.99 high                  | expected target       | 0.93 high                  | title phrase                     |
| `github profile`     | `Plan                             | fabien-campana.dev launch` | 0.99 high             | `Job                       | Audit GitHub profile`            | 0.93 high                                                                            | title phrase                               |
| `profile`            | `Plan                             | fabien-campana.dev launch` | 0.99 high             | `Job                       | Audit GitHub profile`            | 0.72 medium                                                                          | title token; broad query remains ambiguous |
| `fast resume`        | `Validate resume usefulness`      | 0.99 high                  | same target           | 0.73 medium                | title token plus meaningful path |
| `raycast`            | `Validate resume usefulness`      | 0.99 high                  | same plausible target | 0.34 low                   | weak content-only match          |
| `worktrail`          | `Validate resume usefulness`      | 0.99 high                  | `Master               | worktrail`                 | 0.96 high                        | title plus exact project path                                                        |
| `shipready`          | no result                         | —                          | `Master               | ship-ready`                | 0.94 high                        | compact exact project-path identity                                                  |

No archived state affects the expected Scaleway target: it is active. Two other
`SC | … PieChart …` threads observed in the index are Codex-archived and remain
hidden by default.

### Archive and ignore semantics

- Default resume search excludes `source_threads.archived=1` and all rows in
  `ignored_threads`.
- `--include-archived` and the Raycast preference include Codex-archived source
  threads, apply a rank penalty, and expose additive `archived: true` target
  metadata for an `Archived` row badge.
- Ignored runs remain excluded even when archived results are included. There
  is no debug-mode override in Fast Resume.
- Worktrail has no separate per-run archive state. The archived flag is derived
  from Codex `archived_sessions`; Worktrail ignore is a distinct local state.

### Raycast UI before and after

Before, the detail pane was always open, reducing title width and producing
severe row truncation. Rows repeated source, full confidence text, file count,
and an open/copy icon. Detail markdown led with the shell resume command and
surfaced score/source/count metadata before decision context.

After:

- the full-width result list is the default; `Cmd-I` toggles detail on demand;
- row subtitle is decision context such as
  `Codex · 3w ago · project: scaleway`;
- row accessories contain only `High`/`Med`/`Low` and optional `Archived`;
- unlabeled open/copy icons, source accessory, and file-count accessory are
  removed;
- detail starts with the target title and Open in Codex availability, followed
  by why it matched, activity/source, confidence explanation, related files,
  resume-command fallback, and finally debug fields;
- **Open in Codex** remains the first declared action and **Copy Codex resume
  command** remains second. The extension opens a declared deep link and does
  not execute Codex or a shell command.

The in-app Browser cannot automate Raycast's native extension list because it
is not a browser/localhost surface. Validation therefore used the installed CLI
corpus, pure display/contract/action tests, Raycast TypeScript/build checks, and
code inspection. Manual native verification steps are:

1. Run `pnpm --dir extensions/raycast dev` and open **Resume Worktrail**.
2. Query `scaleway`; verify the complete expected title is readable in the
   full-width list with `Codex · … · project: scaleway` and a compact `High`
   badge.
3. Press `Cmd-I`; verify human-first detail ordering and press it again to
   restore the full-width list.
4. Open the action panel; verify **Open in Codex** is first and **Copy Codex
   resume command** is second.
5. Enable included archived results, query a known archived target, and verify
   the `Archived` badge and `Archived result ranked lower` explanation.

RAG, embeddings, LLM summarization, and graph UI remain deferred because the
measured failures were resolved with available deterministic metadata and
calibrated presentation.

### Validation results

- Required root command passed: `pnpm typecheck && pnpm test && pnpm ui:build`
  with 50/50 tests.
- Root format check and `git diff --check` passed.
- Raycast typecheck, 39/39 helper tests, production build, and format check
  passed.
- Installed executable checks used `~/.local/bin/worktrail`; score version 2
  was observed inside unchanged `ResumeSearchResult` schema version 1.
- The Raycast client successfully parsed installed-executable results for
  `scaleway`, `profile`, and `shipready`; each retained action order
  `open-codex, copy-command`.
- `ray lint` remains non-enforced for this private extension: Raycast's author
  API returns 404 for `fabiencampana`, and ESLint is not installed. Its
  independent Prettier check passed.
