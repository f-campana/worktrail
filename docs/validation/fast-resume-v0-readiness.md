# Fast Resume v0 readiness

Status: ready for daily local dogfood after the validation checklist below
passes. Fast Resume remains a local, read-only launcher path; this note does not
start Control Tower or add a daemon.

## What works

The daily loop is Raycast → `worktrail resume` → ranked, project/alias-aware
targets → bounded Codex source-state freshness check → click-time `target
validate` → exact `codex://threads/<UUID>` open. **Open in Codex** remains the
primary action and the inert **Copy Codex resume command** remains secondary.
Raycast consumes versioned JSON and does not read SQLite, inspect Codex files,
rank results, or run migrations.

## Install, update, and index

From the repository root:

```sh
pnpm install
pnpm build
npm install --global --prefix "$HOME/.local" .
"$HOME/.local/bin/worktrail" index
```

Repeat the build, install, and index commands after updating local source. The
index is incremental and skips unchanged sources. `resume` does not full-index
on every query because launcher search must remain fast and read-only. If a
read-only command says the database needs an update, run `worktrail index` once
and retry. If it says the database is newer than the CLI, update and reinstall
the CLI first.

Import or update the private Raycast extension with:

```sh
pnpm --dir extensions/raycast install
pnpm --dir extensions/raycast dev
```

Configure **Worktrail executable path** as `~/.local/bin/worktrail` (or a
working command on Raycast's `PATH`), leave the project/pnpm development
fallback empty for normal use, optionally select the Worktrail database, keep
the default result limit of 5, and assign the `resume` alias or a global hotkey.

## Codex home, aliases, and freshness

Without configuration, Worktrail uses `$CODEX_HOME` or `~/.codex`. For a custom
location, use the same path for indexing and Raycast's optional **Codex home
path** preference. Raycast expands `~`, validates that the preference is a
directory, passes it as `--codex-home` to both `resume` and `target validate`,
includes it in the cache key, and home-normalizes it in debug commands. Raycast
still never inspects that directory directly.

Project aliases are explicit corrections and survive reindexing:

```sh
worktrail projects aliases list --json
worktrail projects aliases add PROJECT "ALIAS" --allow-write --json
worktrail projects aliases remove "ALIAS" --allow-write --json
```

Search checks only the bounded top candidate set against Codex rollout
metadata. Active targets remain, archived/missing targets are hidden by
default, `--include-archived` retains penalized archived targets, and unknown
state stays searchable but fails closed at open time. Raycast's short cache may
render while a background refresh runs, but every open is revalidated; an
archived or missing click invalidates the cached query.

When results seem stale, run `worktrail resume "query" --json` in Terminal,
then `worktrail target validate <UUID> --json`. Run `worktrail index` when the
database schema, project membership, alias-derived membership, or persistent
archive flags need refreshing. Do not use `--force` unless unchanged source
files genuinely need reparsing.

## Dogfood validation

The hardening pass checks sanitized metadata only—no transcript excerpts, raw
home paths, private UUIDs, secrets, or raw Codex records are recorded here.

| Check                                             | Observed readiness signal                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `resume scaleway`, `SC`                           | same high-confidence project target; explicit `SC` alias kept the higher alias score   |
| `resume shipready`, `worktrail`                   | same high-confidence project targets                                                   |
| `resume fast resume`, `github profile`, `profile` | expected title/path targets and confidence behavior remained stable                    |
| `target validate <active UUID>`                   | schema v1 `openable`; returned URL exactly matched the selected sanitized UUID         |
| Raycast client search                             | installed CLI returned five schema-v1 targets for `SC`                                 |
| Raycast validate-before-open                      | client validation returned `openable` with an exact matching URL                       |
| Codex home unset and explicit `~/.codex`          | sanitized schema-v1 responses matched after removing only `generatedAt`                |
| synthetic stale/newer schemas                     | non-zero exit, empty JSON stdout, actionable index/update instruction, no SQLite trace |

Representative serial warm installed-CLI timings were 67.6 ms (`scaleway`),
127.7 ms (`SC`), 151.7 ms (`github profile`), and 184.1–193.0 ms (`fast
resume`). The new schema-version read took roughly 0.3–1.4 ms in recorded runs.
All remained below the previous acceptable 300 ms CLI budget. Native Raycast UI
automation was unavailable; the production build, client-path smoke, and helper
tests cover search, action order, cache behavior, and validate-before-open.

## Known limitations and next step

- Codex freshness depends on the current local `sessions/` and
  `archived_sessions/` layout; unrecognized layouts report unknown and fail
  closed when opening.
- Persistent archive flags and derived project memberships update during
  indexing, not launcher search.
- The installed CLI still requires Node.js 22.5 or newer.
- Raycast alias argument routing is owned by Raycast; a dedicated hotkey is the
  most reliable entry path.
- There is no cross-machine identity, automatic Codex execution, terminal
  auto-open, daemon, watcher, or external-source adapter in v0.

Recommended next product step: dogfood this hardened loop for a short period
and collect failure/latency evidence before deciding the first Control Tower
slice. Do not add a server or redesign ranking merely to extend Fast Resume v0.
