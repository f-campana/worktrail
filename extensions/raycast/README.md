# Worktrail for Raycast

This private Raycast extension provides one command, **Resume Worktrail**. It
searches Worktrail's versioned Fast Resume JSON contract and copies inert Codex
resume commands. Raycast is only a client: ranking, confidence, signals,
archive filtering, and command construction remain owned by Worktrail.

## Requirements

- Raycast for macOS
- Node.js 22.5 or newer
- pnpm 10 or newer, available to the Raycast process
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

- **Worktrail Project Path** (required): the repository containing the
  `worktrail` pnpm script.
- **Database Path** (optional): passed to Worktrail as `--db PATH`. If omitted,
  Worktrail uses its normal default database.
- **Result Limit**: 3, 5 (default), 10, or 20.
- **Include archived runs**: disabled by default.

## Invocation and behavior

For non-empty search text, the extension uses argument-safe process execution;
the query is never interpolated into a shell command. Conceptually it invokes:

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
Current API and workflow references are the official Raycast documentation for
[file structure](https://developers.raycast.com/information/file-structure),
[preferences](https://developers.raycast.com/api-reference/preferences),
[actions](https://developers.raycast.com/api-reference/user-interface/actions),
and the [Raycast CLI](https://developers.raycast.com/information/developer-tools/cli).

## Current limitations

- Invocation currently supports the repository's pnpm script, not a separately
  installed `worktrail` binary.
- `pnpm` must be on the environment path visible to Raycast.
- Confidence is displayed as supplied by Worktrail; it is not a calibrated
  probability.
- Candidate workstreams appear if the CLI returns them, but Worktrail does not
  currently generate them.
- The extension does not provide workstream correction or GUI navigation.
