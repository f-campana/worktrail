# Worktrail for Raycast

This private Raycast extension provides one command, **Resume Worktrail**. It
searches Worktrail's versioned Fast Resume JSON contract and opens exact local
Codex threads when Worktrail declares a verified deep link. Copying an inert
Codex resume command remains the secondary fallback. Raycast is only a client:
ranking, confidence, signals, archive filtering, and action construction remain
owned by Worktrail.

## Requirements

- Raycast for macOS
- Node.js 22.5 or newer
- An installed Worktrail CLI (preferred), configured by command name or path
- pnpm 10 and a Worktrail checkout only for extension development or the
  optional development fallback

## Install locally

First build and install Worktrail from the repository root:

```sh
pnpm build
npm install --global --prefix "$HOME/.local" .
"$HOME/.local/bin/worktrail" resume "profile" --json --limit 5
```

Then import the private extension from this directory:

```sh
pnpm install
pnpm dev
```

`ray develop` builds and imports the extension into the local Raycast app. Once
it has been imported, stop the development process if desired; the command
remains available in Raycast. This extension is intentionally local/private and
is not configured for the public Raycast Store.

In Raycast, assign the alias `resume` to **Resume Worktrail**. Type the alias,
enter its **What you remember** argument, and press Enter to open the ranked
results. Raycast's documented alias behavior focuses the first argument after
`resume` plus a space. In native testing, entering alias argument mode first was
reliable; typing the entire phrase as undifferentiated Root Search text could
remain a normal root query instead of passing `github profile` to Worktrail.

For the shortest reliable path, configure a global hotkey for **Resume
Worktrail**. The hotkey opens the command directly; type the query and press
Enter on the selected target.

## Preferences

- **Worktrail executable path** (recommended): installed command name or
  executable path, for example `worktrail`, `~/.local/bin/worktrail`, or
  `/opt/homebrew/bin/worktrail`. `~` and `~/...` are supported for paths.
- **Worktrail project path (development fallback)** (optional): repository
  folder containing Worktrail's `package.json`. Configure this only when
  developing without an installed executable.
- **pnpm executable path (development fallback)** (optional): pnpm command used
  with the project path. Leave empty for automatic pnpm resolution.
- **Database Path** (optional): passed to Worktrail as `--db PATH`. `~` and
  `~/...` paths are supported. A configured path must be an existing file. If
  omitted, Worktrail uses its normal `~/.worktrail/worktrail.db` default.
- **Result Limit**: 3, 5 (default), 10, or 20.
- **Include archived runs**: disabled by default.

## Invocation and behavior

For non-empty search text, the extension resolves its invocation in this order:

1. The configured **Worktrail executable path**, when executable or available
   on Raycast's `PATH`.
2. Bare `worktrail` on Raycast's `PATH`.
3. The pnpm/project development fallback when a project path is configured.
4. An actionable missing-executable error.

Normal installed mode uses argument-array process execution and conceptually
invokes:

```text
worktrail resume <query> --json --limit <limit>
```

Development fallback invokes:

```text
pnpm --silent --dir <project-path> worktrail resume <query> --json --limit <limit>
```

The fallback's `--silent` pnpm option suppresses lifecycle banners so stdout
contains only the JSON contract. The extension adds `--db <database-path>` and
`--include-archived` only when their preferences are enabled. It parses
`ResumeSearchResult` schema version 1 and rejects unknown schema versions
instead of guessing.

The child receives the resolved home directory and a deterministic executable
path containing the selected executable directory, Node, Raycast's inherited
entries, and standard macOS system directories. No shell is invoked, so the
query remains one process argument even when it contains shell-significant
text.

The command shows empty, loading, no-result, ranked-result, diagnostic, and
sanitized-error states. Each result includes compact metadata, signals, related
files/runs, and every copy action declared in `openActions`. A target without a
declared or contract-provided resume command is clearly marked unavailable.

Started-command failures show the exit code, one bounded sanitized line from
stderr (or stdout when stderr is empty), and a home-normalized command summary.
The error action **Copy Debug Command** copies the shell-safe equivalent for a
manual Terminal comparison. JSON parse, schema/version, timeout, preference,
spawn, and unknown failures are classified separately.

The primary action opens `codex://threads/<SESSION_ID>` when Worktrail declares
that exact-thread action. The extension accepts only a UUID-shaped Codex thread
URL matching the selected target's resume reference. The secondary action
copies `codex resume <SESSION_ID>`; other actions can copy a declared ID, the
resume UUID, or the target title. Opening the thread does not submit a prompt or
start agent work. The extension never runs Codex CLI, opens Terminal, mutates
Worktrail, or reimplements ranking.

## Troubleshooting

### Raycast cannot find Worktrail

Verify the installed CLI in Terminal first:

```sh
"$HOME/.local/bin/worktrail" resume "profile" --json --limit 5
```

Set **Worktrail executable path** to that absolute path. Alternatively, set it
to `worktrail` when the command is already on Raycast's `PATH`. Do not configure
the project and pnpm fields for normal installed use; they are fallback-only.

If no installed executable is available, configure both the Worktrail project
path and, when automatic resolution fails, the pnpm executable path.

### Raycast cannot find pnpm

Raycast is launched as a macOS app and may not inherit the same `PATH` as an
interactive Terminal shell. This can make `pnpm` work in Terminal but fail from
the extension.

Run the following in Terminal:

```sh
which pnpm
```

This applies only to the development fallback. Copy the returned absolute path
into **pnpm executable path (development fallback)**. Common values are:

```text
/opt/homebrew/bin/pnpm
/usr/local/bin/pnpm
~/Library/pnpm/pnpm
```

Use the fully expanded absolute path from `which pnpm`, not a path containing
`~`. Reopen **Resume Worktrail** and enter a known query. A ranked result or the
clean **No resumable work found** state confirms that pnpm started correctly.

The extension intentionally does not invoke `/bin/zsh -lc`: direct executable
resolution keeps project paths and search queries as separate process
arguments.

### Worktrail project path

For development fallback only, set **Worktrail project path** to the repository
folder, normally `~/Documents/worktrail` or its absolute path. The extension
supports `~` and `~/...`, resolves them internally, and requires the selected
directory to contain Worktrail's `package.json`.

If an older extension reports a command failure containing `--dir ~`, update
to the latest version or set the full absolute repository path. A value of `~`
alone refers to the home directory, not the Worktrail checkout, unless the
repository itself is located there.

The pnpm executable is configured separately. This project preference is not
validated or used when installed executable mode succeeds.

### Worktrail exits with code 254 and no output

In development fallback, pnpm can surface an underlying `ENOENT` (`errno -2`)
as exit code 254. With `--silent`, its reporter does not print the missing
nested executable. This can happen when Raycast's reduced `PATH` can start an
absolute pnpm binary but omits standard utilities needed by a repository-local
launcher.

The extension guarantees the standard macOS executable directories in the
child `PATH`. If code 254 persists, use **Copy Debug Command** and run the
copied command in Terminal; the displayed error remains bounded and contains
no full stdout/stderr dump.

### Database path

Leave **Database Path** empty to use Worktrail's normal default under `HOME`, or
select an existing SQLite database file. The extension expands `~`, validates
an explicit file before starting either invocation mode, and passes the same
resolved `HOME` to the child process.

## Why not call pnpm forever?

Repository-based pnpm invocation remains useful for private dogfood and source
development. It is fragile as a GUI application boundary because it depends on
a checkout, installed dependencies, a package manager, and nested launcher
environment details. The installed executable is one stable process boundary
for Raycast and a better base for later distribution. Both paths consume the
same CLI and `ResumeSearchResult` JSON contract; Raycast still owns no ranking
or resume-command construction.

## Privacy

- Searches and results stay local; the extension performs no uploads or network
  requests.
- Results are transient React state and are not persisted by the extension.
- Full stdout and stderr are never logged or shown. A failed command may show
  one bounded line from stderr, or stdout when stderr is empty. Messages are
  flattened and scrubbed of configured paths, raw home paths, and URL
  credentials.
- The UI does not render source IDs, evidence excerpts, transcript content,
  diffs, or remote credential material.
- Clipboard actions copy only values already declared by Worktrail plus the
  target's resume UUID/title. Copying is always user initiated.

## Development and validation

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

`pnpm build` runs Raycast's production extension build without publishing.
`ray lint` is currently blocked for this private extension because Raycast's
author lookup returns 404 for the configured private author; the lint command
also reports that ESLint is not installed. Prettier, TypeScript, helper tests,
and the production build remain the enforced local checks.

Current API and workflow references are the official Raycast documentation for
[file structure](https://developers.raycast.com/information/file-structure),
[arguments](https://developers.raycast.com/information/lifecycle/arguments),
[aliases and hotkeys](https://manual.raycast.com/command-aliases-and-hotkeys),
[preferences](https://developers.raycast.com/api-reference/preferences),
[actions](https://developers.raycast.com/api-reference/user-interface/actions),
and the [Raycast CLI](https://developers.raycast.com/information/developer-tools/cli).
The exact-thread URL is documented in the official
[Codex app deep-link reference](https://developers.openai.com/codex/app/commands#deep-links).

## Current limitations

- The local executable still requires Node.js 22.5 or newer; it is compiled
  JavaScript, not a standalone native binary.
- Development fallback project paths must point at the repository root; parent
  directories and arbitrary packages are rejected before pnpm starts.
- Confidence is displayed as supplied by Worktrail; it is not a calibrated
  probability.
- Candidate workstreams appear if the CLI returns them, but Worktrail does not
  currently generate them.
- The extension does not provide workstream correction or GUI navigation.
- Raycast must recognize the `resume` alias before it can route following text
  into the command argument; a dedicated hotkey avoids that Root Search timing
  boundary.
