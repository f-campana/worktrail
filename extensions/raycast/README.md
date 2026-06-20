# Worktrail for Raycast

This private Raycast extension provides one command, **Resume Worktrail**. It
searches Worktrail's versioned Fast Resume JSON contract and copies inert Codex
resume commands. Raycast is only a client: ranking, confidence, signals,
archive filtering, and command construction remain owned by Worktrail.

## Requirements

- Raycast for macOS
- Node.js 22.5 or newer
- pnpm 10 or newer, available on Raycast's `PATH` or configured by absolute path
- A local checkout of Worktrail with dependencies installed

## Install locally

From this directory:

```sh
pnpm install
pnpm dev
```

`ray develop` builds and imports the extension into the local Raycast app. Once
it has been imported, stop the development process if desired; the command
remains available in Raycast. This extension is intentionally local/private and
is not configured for the public Raycast Store.

In Raycast, open **Extensions**, select **Worktrail**, and configure a global
hotkey for **Resume Worktrail** if desired.

## Preferences

- **pnpm executable path** (optional): absolute path to `pnpm`. Leave empty to
  use automatic resolution.
- **Worktrail Project Path** (required): the repository folder containing
  Worktrail's `package.json`. `~` and `~/...` paths are supported; for example,
  `~/Documents/worktrail`.
- **Database Path** (optional): passed to Worktrail as `--db PATH`. `~` and
  `~/...` paths are supported. If omitted, Worktrail uses its normal default
  database.
- **Result Limit**: 3, 5 (default), 10, or 20.
- **Include archived runs**: disabled by default.

## Invocation and behavior

For non-empty search text, the extension safely resolves `pnpm` from the
configured absolute path, Raycast's `PATH`, or common installation paths. It
expands local project/database path preferences without invoking a shell,
validates the project directory, and then uses argument-array process
execution. The query is never interpolated into a shell command. Conceptually
it invokes:

```text
pnpm --silent --dir <project-path> worktrail resume <query> --json --limit <limit>
```

The `--silent` pnpm option suppresses lifecycle banners so stdout contains only
the JSON contract. The extension adds `--db <database-path>` and
`--include-archived` only when their preferences are enabled. It parses
`ResumeSearchResult` schema version 1 and rejects unknown schema versions
instead of guessing.

The command shows empty, loading, no-result, ranked-result, diagnostic, and
sanitized-error states. Each result includes compact metadata, signals, related
files/runs, and every copy action declared in `openActions`. A target without a
declared or contract-provided resume command is clearly marked unavailable.

The primary action copies `codex resume <SESSION_ID>` when Worktrail declares
it. Secondary actions can copy a declared ID, the resume UUID, or the target
title. The extension never runs Codex, opens Terminal, mutates Worktrail, or
reimplements ranking.

## Troubleshooting

### Raycast cannot find pnpm

Raycast is launched as a macOS app and may not inherit the same `PATH` as an
interactive Terminal shell. This can make `pnpm` work in Terminal but fail from
the extension.

Run the following in Terminal:

```sh
which pnpm
```

Copy the returned absolute path into **pnpm executable path** in the **Resume
Worktrail** command preferences. Common values are:

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
arguments. A future packaged Worktrail binary may remove the pnpm dependency.

### Worktrail project path

Set **Worktrail Project Path** to the repository folder, normally
`~/Documents/worktrail` or its absolute path. The extension supports `~` and
`~/...`, resolves them internally, and requires the selected directory to
contain Worktrail's `package.json`.

If an older extension reports a command failure containing `--dir ~`, update
to the latest version or set the full absolute repository path. A value of `~`
alone refers to the home directory, not the Worktrail checkout, unless the
repository itself is located there.

The pnpm executable is configured separately. Run `which pnpm` when Raycast
cannot locate it, then copy that command's absolute result into **pnpm
executable path**.

## Privacy

- Searches and results stay local; the extension performs no uploads or network
  requests.
- Results are transient React state and are not persisted by the extension.
- Full stdout and stderr are never logged or shown. Error messages are bounded,
  flattened, and scrubbed of configured paths, raw home paths, and URL
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
[preferences](https://developers.raycast.com/api-reference/preferences),
[actions](https://developers.raycast.com/api-reference/user-interface/actions),
and the [Raycast CLI](https://developers.raycast.com/information/developer-tools/cli).

## Current limitations

- Invocation currently supports the repository's pnpm script, not a separately
  installed `worktrail` binary.
- The project path must point at the repository root; parent directories and
  arbitrary packages are rejected before pnpm starts.
- A local pnpm installation is still required, either discoverable by Raycast
  or selected in command preferences.
- Confidence is displayed as supplied by Worktrail; it is not a calibrated
  probability.
- Candidate workstreams appear if the CLI returns them, but Worktrail does not
  currently generate them.
- The extension does not provide workstream correction or GUI navigation.
