# Fast Resume ranking evaluations

Validated on 2026-06-21 against the local dogfood index. Titles and
home-normalized project paths are included only where needed to explain ranking
behavior; no transcript excerpts, credentials, remotes, or raw home paths are
recorded.

## Source metadata audit

| Metadata                                   | Available per thread? | Source and limitation                                                                                                                                                                                             |
| ------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User-visible Codex title                   | Yes                   | Latest `thread_name` from `~/.codex/session_index.jsonl`; the observed file exposes only `id`, `thread_name`, and `updated_at`.                                                                                   |
| Codex project/sidebar group                | No                    | Neither the rollout importer nor the observed session index exposes the sidebar grouping.                                                                                                                         |
| cwd                                        | Yes                   | `session_meta.payload.cwd`, persisted on `source_threads` and indexed separately.                                                                                                                                 |
| Repository path/name                       | Partial               | cwd can act as a project-path proxy, but there is no normalized repository identity.                                                                                                                              |
| Git remote, repository URL, branch, commit | No in Worktrail       | Synthetic/raw `session_meta` can contain a `git` object, but `CodexLocalAdapter` does not normalize it and the database has no corresponding columns. The report-time Git probe is separate from resume indexing. |
| Related file paths                         | Yes                   | Structured file changes plus conservatively detected paths; persisted in `file_references`.                                                                                                                       |
| Session UUID/resume reference              | Yes                   | Codex session ID is persisted as `external_id` and `resume_ref`.                                                                                                                                                  |
| Codex archived state                       | Yes                   | Derived from whether the rollout lives under `~/.codex/archived_sessions`; the session title index itself has no archive field.                                                                                   |
| Worktrail archived state                   | No separate concept   | Worktrail has no manual per-run archive mutation. `source_threads.archived` represents source/Codex archive location.                                                                                             |
| Worktrail ignored state                    | Yes                   | Separate `ignored_threads` table. Ignored runs remain excluded from resume search.                                                                                                                                |
| Last activity                              | Yes                   | Maximum imported event timestamp on `source_threads.updated_at`.                                                                                                                                                  |
| Manual workstream/entity and alias         | Yes, when configured  | Workstream assignments and aliases are separate Worktrail metadata. No aliases were configured in the live index during this audit.                                                                               |

The expected thread `SC | Review PieChart component` is present, active, and has
cwd `~/Documents/scaleway`. The original `scaleway` failure was therefore not a
stale index or missing-title problem. It was score saturation: the expected
thread was sixth in the FTS candidate set, then all one-token candidates became
`0.99/high` and were reordered by recency.

Worktrail can associate this thread with the `scaleway` project path because its
cwd basename is exactly `scaleway`. It cannot see or verify the Codex
sidebar/project group. `SC` is present as a delimited title prefix and can be
matched directly, but Worktrail cannot prove that `SC` is an alias for
`scaleway` without future source metadata or a manual Worktrail alias.

Future importer work is required for an authoritative Codex project/group
identifier and persisted git remote/repository/branch metadata. No schema
migration was needed for this pass.

## Evaluation policy

High confidence is reserved for strong title, project, workstream, or known
alias evidence. Medium covers partial title, meaningful path, and multi-token
coverage. Single-token content-only and generic-file matches are low. Recency
only orders equal relevance scores.

## Dogfood corpus

| Query                | Expected top target / acceptable alternate                                      | Before                                                                                       | After                                                          | Failure class before                                         | Ambiguous?                                           | Source sufficient?                                  |
| -------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `scaleway`           | `SC                                                                             | Review PieChart component`; other active cwd=`scaleway` PieChart threads acceptable below it | `Review backend positioning`, 0.99 high, content-only          | expected target, 0.94 high, exact project-path match         | score saturation caused recency promotion            | No                                                  | Yes: title, cwd, UUID, archive state     |
| `SC`                 | `SC                                                                             | Review PieChart component`; other `SC                                                        | …` titles acceptable                                           | `Inspect Roundtable domain model`, 0.99 high, content-only   | expected target, 0.95 high, title-prefix match       | weak content/file candidates flattened to high      | Low                                      | Yes for title-prefix search; no explicit `SC`→`scaleway` alias  |
| `review piechart`    | `SC                                                                             | Review PieChart component`; `Review PieChart public types` acceptable                        | expected target, 0.99 high, two generic title-term signals     | expected target, 0.93 high, title-phrase match               | correct order but saturated and generic explanation  | No                                                  | Yes                                      |
| `piechart component` | `SC                                                                             | Review PieChart component`                                                                   | expected target, 0.99 high                                     | expected target, 0.93 high, title-phrase match               | correct order but saturated                          | No                                                  | Yes                                      |
| `github profile`     | `Job                                                                            | Audit GitHub profile`                                                                        | `Plan                                                          | fabien-campana.dev launch`, 0.99 high, content+file          | expected target, 0.93 high, title-phrase match       | file/content outranked title phrase                 | No                                       | Yes                                                             |
| `profile`            | `Job                                                                            | Audit GitHub profile`; profile-related project work acceptable                               | `Plan                                                          | fabien-campana.dev launch`, 0.99 high, file                  | expected title target, 0.72 medium                   | one-token coverage and generic-file saturation      | Yes                                      | Sufficient to prefer the title, not to infer one certain intent |
| `fast resume`        | `Validate resume usefulness`                                                    | expected target, 0.99 high                                                                   | expected target, 0.73 medium, title token plus meaningful path | confidence saturation                                        | Moderate                                             | Yes for plausible ranking, not exact intent         |
| `raycast`            | `Validate resume usefulness` acceptable; other Raycast work acceptable          | same target, 0.99 high, content-only                                                         | same target, 0.34 low, weak content-only                       | content-only labeled high                                    | Yes                                                  | No authoritative project/title target in this index |
| `worktrail`          | `Master                                                                         | worktrail`; current Worktrail implementation threads acceptable below it                     | `Validate resume usefulness`, 0.99 high, content-only          | `Master                                                      | worktrail`, 0.96 high, title+exact project path      | content/recency outranked title+project             | Moderate                                 | Yes                                                             |
| `control tower`      | `Cleanup Hygiene                                                                | Control Tower Daily`                                                                         | `Validate resume usefulness`, 0.99 high, content-only          | expected target, 0.93 high, title-phrase match               | content/recency outranked title phrase               | No                                                  | Yes                                      |
| `shipready`          | `Master                                                                         | ship-ready`                                                                                  | no result                                                      | expected target, 0.94 high, exact compact project-path match | punctuation/identity token mismatch                  | No                                                  | Yes: cwd is `ship-ready`                 |
| `safe apply`         | No single known target; Safe Apply workflow or safe-application work acceptable | `Master                                                                                      | ship-ready`, 0.95 high, content-only                           | best partial title/path candidate, 0.73 medium               | saturated broad query                                | Yes                                                 | Insufficient to name one intended target |
| `fodmapp`            | `Nightly Loop                                                                   | FODMAPP Simplification`; active FODMAPP project threads acceptable                           | `FM                                                            | Audit branches and worktrees`, 0.99 high, file               | expected target, 0.96 high, title+exact project path | file/recency flattened with stronger context        | Moderate                                 | Yes                                                             |

## Deterministic changes justified by the corpus

- FTS remains local and OR-based, but up to 100 candidates are field-scored
  before the public top 20 is selected.
- Exact title, delimited title prefix, title phrase, exact cwd basename/project,
  manual workstream, and known alias matches dominate content.
- Compact title/cwd identity fallback handles punctuation variants such as
  `shipready` → `ship-ready` when FTS returns no candidates.
- Common filenames such as `Profile.tsx`, `App.tsx`, `README.md`, `SKILL.md`,
  `Providers.tsx`, `UserContext.ts`, and common config/entry files are
  downweighted when only the basename matches.
- Archived results receive a deterministic penalty. Strong exact evidence can
  remain high confidence, but an equivalent active result ranks first.
- No RAG, embeddings, LLM summaries, graph UI, or network dependency was added.
  The observed failures were explainable from already indexed deterministic
  metadata.

## Remaining limitations

- `scaleway` uses cwd as a project-path proxy, not an authoritative Codex
  sidebar group.
- Acronyms such as `SC` are only title prefixes unless a manual Worktrail alias
  exists; their expansion cannot be inferred reliably.
- Broad terms such as `profile`, `raycast`, and `safe apply` remain inherently
  ambiguous. Calibration now communicates that ambiguity instead of claiming
  uniform high confidence.
- Current git remote, repository name, and branch are unavailable to resume
  ranking without future importer/schema work.
