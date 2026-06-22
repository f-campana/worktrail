# Project Identity + Aliases v0 — Phase 1 dogfood

Date: 2026-06-22

Environment: local installed Worktrail CLI, local SQLite index, macOS

Resume schema version: 1

Resume score version: 3

## Setup and migration

The local CLI was rebuilt and installed with:

```sh
pnpm build
npm install --global --prefix "$HOME/.local" .
```

The installed `~/.local/bin/worktrail index` command applied migration 004 and
reconciled the existing Codex source threads. The first pass discovered 1,109
sources, indexed 31 changed sources, and skipped 1,078 unchanged sources. A
second pass after the alias correction indexed one changed source and skipped
1,108 unchanged sources. Both completed without malformed, partial, or unknown
record errors.

Migration 004 adds `project_identities`, `project_thread_memberships`,
`project_identity_observations`, and `project_aliases`, plus a nullable project
reference on `manual_corrections`. Existing source, archive, ignore, workstream,
and search data were retained.

## Source metadata and sanitized observations

Resolution used only source thread ID/adapter, launch cwd, title/timestamp
metadata, and local read-only Git common-dir probing. It did not use transcript
content, Git remotes, Codex sidebar grouping, or title-prefix alias inference.

Relevant derived rows:

| Project      | Key kind       | Confidence | Sanitized display path   | Primary threads observed | Manual aliases |
| ------------ | -------------- | ---------- | ------------------------ | -----------------------: | -------------- |
| `scaleway`   | cwd            | medium     | `~/Documents/scaleway`   |                        8 | `SC`           |
| `ship-ready` | Git common dir | high       | `~/Documents/ship-ready` |                       35 | none           |
| `worktrail`  | Git common dir | high       | `~/Documents/worktrail`  |                       22 | none           |

Opaque keys are SHA-256 digests of canonical local identity keys. The table and
observation inspection found no raw home prefix, remote URL, transcript excerpt,
diff, or command output.

## Explicit alias correction

Before mutation, `worktrail projects aliases list --json` returned no aliases.
`SC` still selected `SC | Review PieChart component`, but only through the
existing title-prefix signal.

The guarded command succeeded:

```sh
~/.local/bin/worktrail projects aliases add scaleway SC --allow-write --json
```

It recorded a manual project alias and a `project.alias.add` correction audit.
The alias remained after the second installed-CLI index/reconciliation pass.
No source title was promoted into an alias.

## Query closure

| Query             | Top target                                     | Confidence | Score | Identity/alias result                       |
| ----------------- | ---------------------------------------------- | ---------- | ----: | ------------------------------------------- |
| `scaleway`        | `SC \| Review PieChart component`              | high       | 0.960 | project identity + membership               |
| `SC`              | `SC \| Review PieChart component`              | high       | 0.985 | explicit `SC → scaleway` alias + membership |
| `shipready`       | `Write MCP plan spec`                          | high       | 0.960 | `ship-ready` project identity               |
| `ship-ready`      | `Write MCP plan spec`                          | high       | 0.960 | same project identity                       |
| `worktrail`       | `Add project identity aliases`                 | high       | 0.960 | Worktrail Git identity + membership         |
| `fast resume`     | `Refine Fast Resume UX` with archived included | high       | 0.950 | title phrase; no project alias              |
| `github profile`  | `Job \| Audit GitHub profile`                  | high       | 0.980 | title phrase; no project alias              |
| `profile`         | `Job \| Audit GitHub profile`                  | medium     | 0.720 | broad title/path evidence stayed medium     |
| required sentinel | baseline no result; final self-match           | low        | 0.340 | content-only after request text was indexed |
| fresh sentinel    | no result                                      | —          |     — | zero targets                                |

Archived runs remained hidden by default. With `--include-archived`, the
specific archived Fast Resume title outranked active path-only candidates and
carried `archived-penalty`. Ignored-thread behavior is unchanged and remains
covered by root tests.

Every selected live target declared `Open in Codex` first and `Copy Codex
resume command` second. The declared deep links remained exact
`codex://threads/<UUID>` actions; UUID values are intentionally omitted here.

## Raycast closure

Raycast remains a thin CLI JSON renderer. Helper/client tests verified:

- `project-identity-match` renders as `project: scaleway`;
- `project-alias-match` renders as `alias: SC → scaleway`;
- `project-membership` does not clutter the compact subtitle;
- the exact-thread Open in Codex action remains primary;
- Copy Codex resume command remains secondary;
- score version 3 is accepted under response schema version 1.

Native Raycast UI automation was not available in this closure pass. The
installed CLI and Raycast production/helper checks were run; manual native
verification is to open **Resume Worktrail**, search `SC`, confirm the compact
alias subtitle, press Enter to open the exact thread, and confirm the copy
command remains the second declared action.

## Limitations

- Identity is local to one filesystem/clone; it is not cross-machine identity.
- `scaleway` currently uses the conservative cwd fallback because that local
  path did not yield a Git common directory during reconciliation.
- Codex sidebar grouping is unavailable and is not inferred.
- Aliases are explicit correction feedback only; there is no rename/merge UI.
- The identity projection adds no RAG, embeddings, LLM calls, network lookup,
  graph UI, project-management workflow, or new source adapter.
- The literal required no-result sentinel became present in the active source
  corpus during dogfood; the evaluation records both the clean baseline and a
  fresh final sentinel rather than hardcoding an exception.
