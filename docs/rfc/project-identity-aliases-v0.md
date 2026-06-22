# RFC: Project Identity + Aliases v0

- **Status:** Proposed
- **Scope:** Specification only; no runtime change
- **Date:** 2026-06-21

## Summary

Project Identity v0 should give Worktrail a deterministic, local way to group
source threads by repository or project context and to resolve explicit user
aliases such as `SC -> scaleway`. It should not create another project list that
the user has to maintain.

The recommended v0 is a source-neutral identity projection backed by SQLite:

1. Derive a project identity from read-only local Git facts when possible.
2. Fall back conservatively to the source thread's working directory.
3. Link source threads to the derived identity with explicit provenance and
   confidence.
4. Store user-confirmed aliases as correction feedback on that identity.
5. Use identity and alias matches as explainable Fast Resume ranking signals.

Codex sidebar grouping is not available in the currently observed local source
data. V0 must not invent or imply that field.

This RFC deliberately narrows “project” to repository/project context. A
feature or long-running body of work such as “Fast Resume” remains a workstream.
Project identity and workstream identity are related, but they are not the same
primitive.

## Problem statement

Fast Resume and the Raycast client can rank a remembered phrase and open the
exact Codex thread. Ranking currently treats the basename of `cwd` as a
“project” signal. That was sufficient to make `scaleway` prefer a thread whose
working directory ends in `scaleway`, but the relationship is only a query-time
heuristic:

- there is no durable project identity;
- linked worktrees or alternate paths can appear to be different projects;
- a title prefix such as `SC` cannot be proven to mean `scaleway`;
- existing aliases belong to canonical workstreams and only affect their
  manually assigned threads;
- there is no source-backed place to explain which observation established a
  thread's project membership.

Requiring users to create projects and assign every thread would reproduce
organization already present in the filesystem and Git. Conversely, silently
turning title prefixes into aliases would create false identities. V0 needs a
small derived layer between those two extremes.

## Current codebase facts

The recommendation is based on the current implementation:

- `source_threads` persists Codex session ID, resume reference, title, `cwd`,
  timestamps, source metadata, and archive state.
- `CodexLocalAdapter` normalizes `session_meta.payload.cwd`, but not
  `payload.git` or `turn_context.workspace_roots`.
- `session_index.jsonl` enrichment supplies the newest observed thread title.
- FTS indexes title, `cwd`, file references, and bounded redacted evidence.
- Fast Resume computes `projectExact` and `projectTerms` from the basename of
  `cwd`; there is no project table.
- Local Git inspection exists for daily reports, but its results are not
  persisted as identity and are not used by Fast Resume.
- Canonical workstreams, manual assignments, aliases, ignore state, merge
  state, and correction audit records already exist in SQLite.
- Workstream aliases are globally unique, exact phrase/full-term vocabulary.
  They are not project aliases and do not help an unassigned thread unless the
  thread is first manually assigned to that workstream.
- `ResumeSearchResult` is schema version 1 and ranking uses score version 2.
  Raycast consumes that contract and maps explainable signals to compact
  display text.

One implementation caveat matters for later work: import redaction replaces
the local home prefix with `~` before `cwd` is persisted. That is correct for
display and search, but the display-safe value is not a canonical filesystem
key and cannot always be passed directly to Git. Project resolution should use
the raw path transiently, before persistence, or explicitly expand a verified
local `~` path. It should persist an opaque key plus a redacted display path,
not a raw home path.

## Goals

- Recognize source threads that belong to the same local Git repository or
  conservative directory-based project.
- Keep inferred identity useful without initial manual setup.
- Let an explicit alias such as `SC -> scaleway` correct and strengthen query
  resolution.
- Preserve the distinction between project context and a workstream.
- Make every identity match explainable through stored, bounded provenance.
- Improve Fast Resume ordering without semantic retrieval, model calls, or
  nondeterministic scoring.
- Keep core identity source-neutral so future adapters can contribute their own
  stable project observations.
- Keep Raycast a thin renderer over the CLI/JSON contract.
- Preserve local-only processing, redaction, archive semantics, and inert open
  actions.

## Non-goals

V0 will not add:

- Codex sidebar/project grouping unless a later source audit finds and verifies
  it;
- automatic aliases inferred solely from title prefixes;
- a project-management UI or required project setup flow;
- a replacement for canonical workstreams;
- project-to-workstream ownership rules;
- cross-machine repository identity or cloud synchronization;
- remote URL as a required identity key;
- RAG, embeddings, LLM classification, or summarization;
- fuzzy or semantic aliases;
- GitHub, Linear, Notion, Obsidian, or non-Codex adapters;
- graph UI, automatic Codex execution, or autonomous continuation.

## Primitives

### ProjectIdentity

A durable local projection of repository/project context. It is derived from
source observations, not manually created as a prerequisite.

```ts
type ProjectIdentity = {
  id: string;
  keyKind: "git-common-dir" | "cwd";
  opaqueKey: string;
  name: string;
  displayPath?: string;
  status: "active" | "merged";
  confidence: "high" | "medium";
};
```

The opaque key should be a deterministic digest of a canonical local path. It
is an identifier, not a security boundary. `displayPath` must be home-normalized
and bounded.

### ProjectObservation

A source-backed fact used to derive or link an identity.

```ts
type ProjectObservation = {
  projectId: string;
  threadId: string;
  type: "git-common-dir" | "git-root" | "cwd" | "source-project";
  displayValue?: string;
  confidence: "high" | "medium" | "low";
  adapterId: string;
  observedAt: string;
};
```

`source-project` is reserved for a future adapter field that has been audited
as authoritative. It does not describe current Codex sidebar grouping.

### ProjectMembership

The link between a source thread and a project identity. V0 chooses one primary
identity from the thread's launch context, while the schema should not prevent
future secondary memberships.

Membership derived from a Git common directory is stronger than membership
derived from a plain `cwd`.

### ProjectAlias

Explicit vocabulary that resolves to one project identity.

```ts
type ProjectAlias = {
  projectId: string;
  alias: string;
  normalizedAlias: string;
  source: "manual" | "source";
  createdAt: string;
};
```

For v0, only `manual` aliases are writable. `source` is reserved for a future
adapter-provided alias with verified provenance. A title prefix is an identity
signal, not a source alias.

### IdentityMatch

A query-time result that records the resolved identity and the reasons it
matched. It should produce stable signal types such as:

- `project-alias-match`;
- `project-identity-match`;
- `project-path-match`;
- `project-membership`.

Signals identify the participating source threads and never include transcript
excerpts.

## Source metadata audit

| Input                                     | Current availability                                      | V0 use                                        | Limitation                                                                             |
| ----------------------------------------- | --------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex session UUID                        | Reliable                                                  | Thread key and resume reference               | Identifies a thread, not a project                                                     |
| Thread title                              | Reliable after optional index enrichment                  | Thread ranking; possible weak prefix signal   | A prefix such as `SC` is not proof of an alias                                         |
| `session_meta.payload.cwd`                | Available and persisted                                   | Project fallback and Git probe starting point | Launch directory, not guaranteed repository root; persisted form is display-normalized |
| `turn_context.workspace_roots`            | Observed in some rollout shapes, not normalized           | Deferred                                      | Internal shape, can be absent or contain multiple roots                                |
| `session_meta.payload.git`                | Observed in some rollout shapes, not normalized           | Audit candidate only                          | Optional internal schema; branch and commit are ephemeral; remote can be sensitive     |
| Read-only local Git root/common directory | Derivable when the path still exists and Git is available | Preferred local identity observation          | Local-only; repositories can move; current report probe is not persisted identity      |
| File references                           | Available with mixed confidence                           | Supporting signal only                        | A thread can touch files outside its primary project                                   |
| `session_index.jsonl` title               | Available as newest row per ID                            | Display/title ranking                         | Observed rows expose no project/sidebar group                                          |
| Codex archive location                    | Reliable                                                  | Preserve existing exclusion/penalty behavior  | Not project identity                                                                   |
| Codex sidebar/project group               | Not found                                                 | None                                          | Must not be invented                                                                   |
| Existing workstream assignment/alias      | Available when manually configured                        | May support ranking independently             | Workstream identity is not project identity                                            |

The current data is sufficient for local project identity based on Git and
`cwd`. It is not sufficient to claim Codex sidebar grouping or to infer
`SC -> scaleway` as an authoritative alias.

## Identity resolution rules

Resolve each source thread conservatively in this order:

1. **Verified adapter project key:** reserved for future adapters; unavailable
   for current Codex data.
2. **Local Git common directory:** from the raw/expanded launch directory, run
   bounded, argument-safe read-only Git commands. Use the canonical absolute
   Git common directory to compute an opaque identity key. This groups linked
   worktrees of the same local clone.
3. **Canonical cwd:** if Git resolution is unavailable, compute a distinct
   lower-confidence opaque key from the canonical existing directory or the
   normalized source value.
4. **No identity:** missing or unusable paths remain unassigned. Do not derive a
   project from evidence text.

Display name selection is separate from identity:

1. existing confirmed name/correction;
2. repository directory name;
3. `cwd` basename;
4. source-provided display name from a future verified adapter.

Renaming a display label must not change the opaque identity key.

Repository remotes should not be persisted or displayed in v0. They are not
needed for local grouping, may contain credentials or private hostnames, and do
not distinguish multiple local clones safely.

## Alias rules

- Normalize aliases with the same Unicode/case/whitespace policy used for
  lookup, plus the existing compact separator-insensitive comparison where
  appropriate.
- Require at least two alphanumeric characters.
- Keep aliases globally unambiguous across active project identities.
- Reject aliases that conflict with another active project name or alias.
- An exact manual alias match is high confidence and outranks weaker derived
  project candidates.
- A project name or alias does not become a workstream alias automatically.
- A title prefix may make a matching thread easier to retrieve, but it does not
  create or label a project alias.
- Alias add/remove operations must use the existing correction/audit pattern.
- Repeated source evidence may be used to propose an alias in a later slice;
  automatic promotion is outside v0.

## Storage options

### Option A: `.worktrail/project-aliases.json`

Advantages: inspectable, portable, and simple to edit.

Problems: it creates a second persistence mechanism, lacks transactional links
to indexed threads, duplicates normalization/conflict logic, complicates merge
and audit behavior, and encourages manual bookkeeping. It also cannot represent
source observations cleanly.

**Decision:** reject for v0.

### Option B: reuse workstreams and `workstream_aliases`

Advantages: no migration and existing correction commands already work.

Problems: it conflates project context with a durable body of work, requires
manual assignment before aliases help unassigned threads, and makes examples
such as `fast resume -> worktrail` ambiguous. It would turn workstreams into a
manual project registry.

**Decision:** reject.

### Option C: dedicated SQLite identity projection

Advantages: one local transactional store; source observations, memberships,
aliases, merge state, and correction audit can remain explicit; ranking can join
identity without duplicating data into transcript search; future adapters can
contribute observations behind the same contract.

Costs: a migration, reconciliation logic, and lifecycle rules for moved or
deleted repositories.

**Decision:** recommended.

## Recommended v0 storage shape

The later implementation should add a migration conceptually containing:

```sql
project_identities(
  id, public_id, key_kind, opaque_key, name, normalized_name,
  display_path, confidence, status, merged_into_id, created_at, updated_at
)

project_thread_memberships(
  project_id, thread_id, role, confidence, basis, created_at, updated_at
)

project_identity_observations(
  project_id, thread_id, adapter_id, observation_type,
  display_value, confidence, observed_at
)

project_aliases(
  project_id, alias, normalized_alias, source, created_at, updated_at
)
```

Constraints should make active names/aliases unambiguous and thread membership
idempotent. Observations must be bounded and redacted. Do not persist raw Git
remote URLs, transcript text, command output, diffs, or raw home paths.

The derived identity rows are a rebuildable projection. Manual aliases and
corrections are durable user feedback and must survive re-indexing. Rebuilding
derived memberships must never delete manual metadata merely because a path is
temporarily unavailable.

## Ranking and contract impact

Identity augments the current field-aware ranking; it does not replace title,
file, workstream, or content signals.

Recommended precedence by intent strength:

1. exact thread-title phrase/prefix for a specific remembered thread;
2. exact manual project alias or canonical project name;
3. verified project membership and exact project-path match;
4. canonical workstream name/alias and manual assignment, according to the
   query's matched entity;
5. partial title/project terms;
6. meaningful file paths;
7. content-only evidence;
8. recency as a tie-breaker only.

These categories should not be implemented as one permanently saturated score.
Golden tests must decide ambiguous ordering. Manual corrections override weaker
inference, but should not force an unrelated exact thread-title query below a
whole-project result.

The initial implementation can keep `ResumeSearchResult.schemaVersion` at 1 if
it only adds new signal types and uses existing subtitle fields. Any new
structured `projectIdentity` response field requires a schema-version decision
and matching Raycast contract update. Ranking changes require incrementing
`RESUME_SCORE_VERSION` from 2.

Raycast should render at most one compact identity reason, for example:

```txt
Codex · 3w ago · project: scaleway
Codex · 3w ago · alias: SC -> scaleway
```

Raw keys, paths, and debug provenance remain in neither the row subtitle nor the
default detail pane.

## Success criteria

V0 succeeds when:

- project identities appear without requiring manual project creation;
- threads from the same local Git common directory resolve to one identity;
- a non-Git thread can use a conservative `cwd` identity without claiming Git
  certainty;
- `scaleway` ranks `SC | Review PieChart component` first through derived
  project membership;
- `SC` ranks that thread through its title prefix before alias configuration,
  and can explicitly report `SC -> scaleway` after a manual alias is added;
- `shipready` and `ship-ready` resolve the same `ship-ready` identity through
  separator-insensitive exact identity matching;
- `worktrail` resolves current Worktrail runs through project membership;
- `fast resume` remains a title/workstream query rather than being silently
  converted into a project alias;
- `github profile` prefers the specific title match and `profile` remains
  visibly ambiguous when evidence does not justify certainty;
- identity signals are deterministic and visible in CLI JSON and Raycast;
- archive and ignored-thread behavior is unchanged;
- no transcript excerpt, raw home path, credential, or remote URL is added to
  output or validation artifacts.

## Failure criteria

The slice fails if:

- users must manually create or assign projects before project queries work;
- workstreams become a project registry;
- aliases are hardcoded in application code or inferred from one title prefix;
- `SC` is labeled as an alias for `scaleway` without source proof or correction;
- a project identity is derived from content-only transcript evidence;
- moved/missing repositories erase manual aliases or corrections;
- raw home paths, credential-bearing remotes, or transcript content are stored
  in identity audit data or printed in reports;
- ranking becomes nondeterministic or recency becomes primary relevance;
- active/archived/ignored semantics change;
- the Raycast client starts owning identity or ranking logic;
- Codex is executed rather than opened through the existing inert action;
- schema or score changes are made without version and compatibility tests.

## Closing-the-loop plan

The implementation task must produce privacy-safe before/after evaluation for:

```txt
scaleway
SC
shipready
ship-ready
worktrail
fast resume
github profile
profile
zzzznonexistenttoken987654
```

For each query record:

- top target before and after;
- confidence and score version;
- compact signal types;
- whether project identity or alias participated;
- whether archive state affected the result;
- whether the selected inert action opened the exact thread in Codex.

The report must not include transcript excerpts, raw home paths, source UUIDs,
credentials, or repository remotes. A synthetic corpus should cover:

- two linked Git worktrees;
- same-basename unrelated directories;
- non-Git cwd fallback;
- manual alias success and conflict;
- a misleading title prefix that must not become an alias;
- stale and archived threads;
- ignored threads;
- missing/moved repository paths;
- project and workstream names that overlap;
- deterministic repeated ordering.

Manual native Raycast verification is required for one project query and one
alias query after core/CLI tests pass. Opening must remain user initiated and
must not submit a prompt.

## Quality gate

Root validation:

```sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm ui:build
git diff --check
```

Raycast validation when its display or contract changes:

```sh
pnpm --dir extensions/raycast format:check
pnpm --dir extensions/raycast typecheck
pnpm --dir extensions/raycast test
pnpm --dir extensions/raycast build
```

`ray lint` may remain blocked only by the already documented private-author and
ESLint limitation. The implementation quality gate also requires:

- no network or model dependency;
- no raw private rollout fixtures;
- no raw home-path or transcript leakage in tests and validation docs;
- deterministic identity keys, membership, ranking, and output ordering;
- idempotent re-index/reconciliation;
- migration compatibility from existing databases;
- unchanged read-only/default server and correction capability boundaries.

## Implementation plan for a later task

1. **Lock fixtures and contract decisions.** Add the synthetic identity corpus,
   decide whether schema version 1 is sufficient, and reserve signal names.
2. **Add migration and repository functions.** Introduce the four identity
   tables, constraints, alias correction records, and non-destructive merge or
   redirect semantics. Do not expose UI controls.
3. **Add a source-neutral resolver.** Accept transient raw source paths, perform
   bounded read-only Git discovery, compute opaque keys, and emit redacted
   observations. Keep Codex parsing behind its adapter.
4. **Reconcile after import.** Upsert identities and memberships idempotently.
   Missing paths produce diagnostics and retain prior manual feedback.
5. **Integrate retrieval.** Resolve query names/aliases, join project members,
   add explainable signals, increment the score version, and retain current
   archive/ignore behavior.
6. **Update CLI and Raycast rendering.** Show one compact project/alias reason.
   Keep ranking and action construction in core.
7. **Add correction commands/API contracts.** Support alias add/remove/list and
   identity rename/merge only behind the existing local write boundaries.
   Editing UI remains out of scope.
8. **Dogfood and close the loop.** Run the fixed query set, record sanitized
   before/after results, and complete native Raycast checks.

## Open questions

- Should v0 expose structured project identity in JSON, or are signals and
  subtitle sufficient until a second client needs the field?
- Should a thread with multiple verified workspace roots have one primary
  membership or multiple memberships in the first implementation?
- What explicit command should merge duplicate identities after a repository
  move without weakening the default inferred model?
- Should project names be user-renamable in v0, or should only aliases be
  correctable until identity reconciliation has been dogfooded?
- Is a source-provided Git common directory enough to group all desired
  worktrees, or do submodules and nested repositories require a separate rule?

These questions do not block the recommended storage direction. They should be
resolved against the synthetic corpus before ranking code changes.
