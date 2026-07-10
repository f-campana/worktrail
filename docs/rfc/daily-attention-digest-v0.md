# RFC: Daily Attention Digest v0

- **Status:** Proposed; implementation contract, not runtime authorization
- **Date:** 2026-07-10
- **Schema:** `AttentionDigestResult` v1 (proposed)
- **Depends on:** `DailyReport` v1, Fast Resume v0, Project Identity + Aliases
  v0, and the Control Tower / Watch Tower v0 RFC

## 1. Decision

Daily Attention Digest v0 is a deterministic, local, explicit-window report
that composes existing activity, canonical workstream and project context,
bounded Codex source-state observations, local Git facts, source health, and
validated Fast Resume actions. It helps the user choose one justified next
action while making gaps and uncertainty visible.

The thesis is accepted with two qualifications:

1. “Attention” means a documented local rule fired, not that Worktrail knows a
   task is blocked, ready, complete, or important.
2. Resume actions are derived from the same action and freshness semantics as
   Fast Resume, but an open action is offered only for a currently validated
   target. Unknown, archived, or missing targets fail closed.

V0 is stateless. It requires explicit `--since` and accepts explicit `--until`;
there are no checkpoints, dispositions, migrations, scheduler, or notification
semantics. It uses the same since-inclusive, until-exclusive boundary as
`DailyReport` v1. Given identical indexed data, Git observations, source-state
observations, window, options, and injected clock, it must return identical
JSON.

## 2. What it is and is not

The digest is a decision aid over bounded facts. It contains three deliberately
separate things:

- **attention items:** conservative rules whose conditions warrant inspection;
- **changed work:** activity grouped for orientation, without pretending all
  activity is attention;
- **source health and limitations:** coverage needed to judge the first two.

It is not a generic activity feed with priority labels, task manager, source of
delivery truth, transcript summarizer, agent orchestrator, or replacement for
Fast Resume. Recent activity remains useful context even when it fires no
attention rule. `unknown`, `stale`, `source unavailable`, and `needs evidence`
are valid results and are preferred to unsupported claims.

V0 performs no network or model calls, exposes no transcript excerpts by
default, makes no external writes, and adds no daemon, scheduler, GUI, Raycast,
or external integration behavior.

## 3. Command and compatibility boundary

The implementation should add a distinct command:

```sh
worktrail attention --since ISO --until ISO --timezone Europe/Paris --json
```

`--since` is required. `--until` defaults to the command's injected/current
clock, and `--timezone` defaults to `UTC`, matching `report`. The implementation
must reject invalid instants and `since >= until`. JSON is the versioned public
contract; human formatting is intentionally less stable.

The alternative `report --attention` is rejected. The current `report` command
returns `DailyReport` v1 directly and is explicitly activity-only. A mode flag
would make one command return materially different schemas and tempt attention
fields into the stable activity contract.

`DailyReport` v1 remains unchanged. `AttentionDigest` composes the public report
builder/result rather than evolving it or duplicating its activity and Git
queries. It may reuse these fields directly:

| `DailyReport` field        | Digest use                                                          |
| -------------------------- | ------------------------------------------------------------------- |
| `window` and `generatedAt` | Preserve boundaries, timezone policy, and clock.                    |
| `activeWorkstreams`        | Build canonical-workstream changed-work groups.                     |
| `unassignedRuns`           | Resolve project fallback groups or retain unassigned runs.          |
| `git`                      | Attach repository context and evaluate the conservative dirty rule. |
| `omitted.ignoredRuns`      | Preserve omission accounting.                                       |
| `limitations`              | Carry forward, deduplicate, and add digest limitations.             |

It is insufficient for current Codex availability/freshness, project identity
fallback, action validation, source/read-schema health, rule provenance, and
attention classification. Those are additive digest composition stages.
`AttentionDigestResult` must not embed a complete second copy of `DailyReport`.

Compatibility risks are accidental changes to report ordering or fields,
double collection of Git, divergent clocks, and weakening Fast Resume action
validation. Tests must prove `buildDailyReport` output is unchanged and the
digest uses one window and clock throughout. The later command should open the
database read-only and preserve existing actionable stale/newer-schema errors;
the present `report` database-open behavior is not a precedent for a new write
path.

## 4. Versioned JSON contract

Names follow current `schemaVersion`, `generatedAt`, `sourceId`, `resumeRef`,
`relatedFiles`, `openActions`, `omitted`, and `limitations` conventions.

```ts
type SourceRef = {
  sourceTool: string;
  sourceId?: string;
  observation: string;
  observedAt?: string;
};

type EvidenceRef = {
  kind: "activity" | "git" | "source-state" | "index-diagnostic";
  ref: string; // stable safe identifier, never transcript text
  occurredAt?: string;
};

type DeclaredAction = {
  kind: "open-codex" | "copy-command" | "copy-id" | "copy-title" | "open-path";
  label: string;
  value: string;
  target?: { sourceTool: string; resumeRef?: string };
  validation:
    | "validated-at-generation"
    | "validate-before-open"
    | "not-required";
};

type AttentionItem = {
  id: string; // deterministic rule-version + subject + window key
  ruleId: string; // versioned identifier, e.g. dirty-recent/v1
  kind: AttentionKind;
  subject: {
    kind: "workstream" | "project" | "run" | "repository" | "source";
    id: string;
    title: string;
  };
  title: string;
  reason: string;
  priority: "high" | "medium" | "low" | "info";
  confidence: "high" | "medium" | "low";
  freshness: "fresh" | "stale" | "unknown";
  changedAt?: string;
  sourceRefs: SourceRef[];
  evidenceRefs: EvidenceRef[];
  actions: DeclaredAction[];
  limitations: string[];
};

type ChangedWorkGroup = {
  group: {
    kind: "canonical-workstream" | "project-context" | "unassigned";
    id: string;
    title: string;
    provisional: boolean;
  };
  latestActivity: string;
  runs: DailyReportRun[];
  relatedFiles: string[];
  repositories: string[];
  actions: DeclaredAction[];
  limitations: string[];
};

type SourceHealthItem = {
  source: "codex-local" | "git-local" | "worktrail-index" | "worktrail-schema";
  status: "healthy" | "degraded" | "unavailable" | "unknown";
  observedAt: string;
  freshness: "fresh" | "stale" | "unknown";
  summary: string;
  diagnostics: Array<{ code: string; message: string; count?: number }>;
  actions: DeclaredAction[];
};

type AttentionDigestResult = {
  schemaVersion: 1;
  generatedAt: string;
  window: DailyReport["window"];
  summary: {
    attentionCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
    changedWorkCount: number;
    sourceHealth: "healthy" | "degraded" | "unknown";
  };
  attentionItems: AttentionItem[];
  changedWork: ChangedWorkGroup[];
  sourceHealth: SourceHealthItem[];
  omitted: {
    ignoredRuns: number;
    archivedTargets: number;
    missingTargets: number;
    unavailableSourceObservations: number;
  };
  limitations: string[];
};
```

`AttentionKind` is closed to the kinds in section 5 for schema v1. Strings in
`reason`, `summary`, and diagnostics are bounded templates populated only with
safe metadata. They never contain transcript content. IDs and ordering are
deterministic; ordering is priority (`high`, `medium`, `low`, `info`), then
freshness (`fresh`, `stale`, `unknown`), `changedAt` descending, `ruleId`, and
item ID. Counts are derived from the returned arrays.

Human output renders: summary and top attention first; changed work grouped by
canonical workstream/project/unassigned context next; source health and
limitations next; then safe resume/open/copy actions. Empty windows explicitly
say that no indexed activity was observed and still show source coverage. Human
output never hides a JSON limitation or upgrades an informational item.

## 5. Allowed attention rules

V0 has no opaque score. Each item is produced by exactly one rule; multiple
facts may support it. Similar items for the same subject and rule are
deduplicated. Recent workstream/project/run activity belongs in `changedWork`,
not `attentionItems`, unless one of these rules fires.

| Kind (`ruleId`)                                                      | Rule and required facts                                                                                                                                       | Default priority / confidence                                                                          | Freshness and false-positive control                                                                                                                                                                                                               | Declared actions                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `dirty-repository-after-recent-activity` (`dirty-recent/v1`)         | `DailyReport.git` says `dirtyFileCount > 0` **and** the same normalized repository is linked to at least one non-ignored run with activity inside the window. | `low` / `high`; `medium` only if dirty files also intersect the report's bounded files-in-window list. | Git observation is fresh only when collection succeeded during this build. Chronic dirt remains possible; reason says “inspect uncommitted changes,” never “unfinished” or “blocked.” A dirty repo without recent linked activity is context only. | Open repository/path only if safe support exists; copy title/path. |
| `archived-or-missing-resume-target` (`resume-target-unavailable/v1`) | A run that would otherwise supply a changed-work resume action has a bounded current Codex observation of `archived` or `missing`.                            | `medium` / `high`                                                                                      | Fresh only at observation time. Archived and missing counts are explicit. No open action; copy ID/title is allowed. The item says the target is unavailable, not that work is done.                                                                | Copy ID/title only.                                                |
| `stale-source` (`source-stale/v1`)                                   | A required source observation has a documented freshness policy and its last successful observation exceeds it.                                               | `low` / `high`                                                                                         | Freshness is `stale`. No stale item is emitted until a concrete threshold exists in code and tests; age alone never changes work state.                                                                                                            | Existing manual index/correction command may be copied.            |
| `source-unavailable` (`source-unavailable/v1`)                       | A bounded Codex state check or Git collection attempted for an in-window subject and returned an unavailable/error diagnostic.                                | `medium` / `high` when explicit error, otherwise `info` / `medium` for unknown layout.                 | `unknown`; scope and affected subjects must be named. Do not claim all data is absent when collection was partial.                                                                                                                                 | Copy existing manual index command where relevant.                 |
| `index-diagnostics` (`index-diagnostic/v1`)                          | Existing read-only schema/index diagnostics report stale schema, newer schema, omitted records, or another enumerated actionable diagnostic.                  | `medium` for unusable schema; otherwise `info`; `high` confidence                                      | Uses diagnostic observation freshness. Ignored-run counts alone remain coverage, not attention. Unknown diagnostics stay in source health until mapped by a reviewed rule.                                                                         | Copy `worktrail index` only; never execute it.                     |
| `unknown-state` (`resume-state-unknown/v1`)                          | A changed-work run has a resume reference, but bounded current validation cannot establish active/archived/missing state.                                     | `info` / `high` about the unknown observation                                                          | Freshness `unknown`. This is a limitation item, not an urgency claim. No open action because click-time validation would fail closed.                                                                                                              | Copy ID/title or inert resume command; no open.                    |

The candidate names `recent-workstream-activity`, `recent-project-activity`,
`unassigned-recent-run`, and `resume-candidate` are intentionally **not**
attention kinds. They are changed-work grouping and action affordances. An
unassigned run is visible but not urgent by default. `stale-source`,
`source-unavailable`, and non-fatal index diagnostics appear both as a concise
attention item when a rule fires and as the authoritative detailed entry in
`sourceHealth`; IDs link the two without duplicating prose.

## 6. Explicitly disallowed claims

V0 must not emit or imply `blocked`, `ready-to-review`, `ready-to-merge`,
`done`, `waiting-on-agent`, `waiting-on-user`, `open-loop`, `decision-needed`,
completion, delivery, liveness, responsibility, or review need. Current local
sources do not authoritatively provide those states. Transcript words, an
assistant's last message, a completed turn, dirty/clean Git, recency, silence,
archival, file changes, and grouping are insufficient evidence.

Adding one of these kinds requires a separately reviewed authoritative source
mapping, positive and negative fixtures, freshness policy, and action safety
contract. An LLM or transcript heuristic cannot satisfy that requirement.

## 7. Grouping

Grouping is deterministic and does not require maintenance:

1. Use the canonical workstream from `DailyReport.activeWorkstreams`, including
   merged assignment resolution already performed by the report builder.
2. For a report run without a canonical workstream, use its durable canonical
   Project Identity membership when exactly one project identity resolves.
   Label the group `project-context`, set `provisional: true`, and never call it
   a workstream. Alias-derived membership may help retrieve the project but an
   alias match by itself does not manufacture membership.
3. Ambiguous or absent project identity remains in one `unassigned` group (or
   deterministic source-specific subgroups if needed for bounded output).
   Runs remain individually visible; no attention item fires merely because
   they are unassigned.

Canonical workstream wins over project context. A run appears in exactly one
changed-work group. Groups order by latest activity descending, then kind,
title, and ID. Related files and repositories are normalized and deduplicated.
Candidate workstream inference is out of scope for v0.

## 8. Source health and freshness

Every digest contains a source-health section, including for an empty window.
It reports:

- Codex-local availability and bounded active/archived/missing/unknown checks;
- Worktrail index/schema read health and actionable stale/newer diagnostics;
- local Git collection availability, bounded diagnostics, and truncation;
- ignored, archived, missing, unavailable, omitted, and truncated counts;
- observation time, freshness category, partial coverage, and limitations.

`healthy` means every source required by returned claims was checked
successfully and is within a documented freshness policy. `degraded` means a
required check is stale, partial, or unavailable but a bounded digest can still
be returned. `unknown` means health cannot be established. The aggregate is
the worst applicable status; it never implies sources outside the attempted
scope are healthy.

Archived or missing targets and mapped actionable failures can be attention.
Ignored counts, truncation, an uninspected source, lack of Git for a non-Git
directory, and a dirty repository without in-window activity are coverage or
context only. Schema incompatibility may prevent a result entirely; the CLI
must preserve the current explicit update/upgrade error rather than fabricate a
partial healthy digest.

Freshness is about the supporting observation, not inferred work state.
Codex checks reuse `active | archived | missing | unknown` and `observedAt` from
the current adapter. Git is fresh for the instant of successful command
collection only. V0 must not invent a stale threshold; `stale-source/v1` stays
dormant until an explicit source-specific threshold is approved and tested.

## 9. Actions and Fast Resume reuse

Actions remain inert declared data. The digest reuses Fast Resume's safe
`open-codex`, `copy-command`, and `copy-id` representations and the same Codex
UUID safety checks, source-state provider, exact `codex://threads/<UUID>` URL,
and `target validate` contract. Shared construction should be extracted or
called; it must not be independently reimplemented.

- `open-codex` appears only after generation-time validation says `active`, is
  marked `validate-before-open`, and clients must call the existing validator
  immediately before opening.
- `copy-command` may expose inert `codex resume <UUID>` data for active or
  unknown state, with the limitation that unknown was not openable. It never
  executes the command.
- archived or missing targets expose no open or resume command action; copy ID
  or title is allowed.
- `open-path` is allowed only for an already supported, normalized local file or
  repository path and requires no shell interpolation. If safe support is not
  shared today, omit it from the first implementation.
- the existing manual `worktrail index` command or existing correction command
  may be represented as copyable data, never run automatically.

V0 cannot resume an agent, run a prompt, archive a source thread, mutate a
correction, create a PR/issue/document, send a message, notify, schedule, or
write any external service.

## 10. Privacy-safe evaluation corpus

Implementation begins with synthetic metadata fixtures using fixed UUIDs,
paths, timestamps, clock, Git command results, and source observations. No real
transcript excerpt, private path, credential, or source record is committed.

| Scenario                                       | Expected behavior                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recent active project with multiple Codex runs | One `project-context` group, all runs once, ordered by latest activity; activity alone creates no attention.                                       |
| Recent run with validated active target        | Changed-work group has an open action marked validate-before-open plus inert copy actions.                                                         |
| Archived/missing top candidate                 | `resume-target-unavailable` medium item; omitted count increments; no unsafe open/resume action; another active run may become the group's action. |
| Source unknown/freshness degraded              | `unknown-state` or `source-unavailable` as applicable, aggregate health degraded/unknown, explicit limitation, no open action.                     |
| Dirty Git with recent linked activity          | One `dirty-recent/v1` low item; medium only with file-window intersection; bounded Git evidence.                                                   |
| Dirty Git with no recent linked activity       | Repository context/health only; no attention item.                                                                                                 |
| Ignored run                                    | Absent from items and changed work; `ignoredRuns` increments.                                                                                      |
| Unassigned run                                 | Visible in `unassigned`, no urgency by default, validated action allowed.                                                                          |
| Canonical workstream present                   | Canonical group wins over project membership and carries manual-assignment provenance.                                                             |
| Project identity fallback                      | Clearly provisional `project-context`; never labeled workstream.                                                                                   |
| No activity window                             | No changed work or work-derived attention; source health and zero summary remain present.                                                          |
| Stale schema/source diagnostic                 | Incompatible schema returns current actionable CLI error; a representable stale source yields degraded health and only a mapped rule item.         |

Golden tests assert complete v1 JSON, deterministic ordering/IDs, inclusive and
exclusive boundaries, partial/truncated diagnostics, zero-state shape, and no
transcript fields. Negative assertions search every result for disallowed state
labels and unsafe actions. Existing `DailyReport`, Fast Resume, target
validation, and Raycast tests remain unchanged and passing.

## 11. Dogfood closure and validation

Dogfood uses local data but records only sanitized counts, rule IDs, timings,
and answers to these questions:

1. Did the digest help choose one next action within two minutes?
2. Were any items false blocker, review, done, merge, or liveness claims?
3. Were reasons understandable without transcript disclosure?
4. Did actions open the right current target after click-time validation?
5. Were source gaps explicit?
6. What useful item was missing?
7. What noisy item should be suppressed?

For each session record the chosen action (safe category only), time to choice,
false/unclear rule IDs, missing facts, and noisy rule IDs. Do not record private
titles, UUIDs, paths, or excerpts. V0 is ready only after the synthetic corpus
passes and repeated dogfood shows the digest can guide a choice without
unsupported claims. Noise is fixed by tightening or removing a rule, not by
adding opaque ranking.

Success requires:

- identical inputs, clock, and observations produce identical JSON;
- every item has a bounded fact, provenance, documented versioned rule,
  uncertainty, and applicable limitations;
- no unsupported completion/blocker/review/merge/liveness claim exists;
- archived, missing, and unknown targets never expose unsafe open actions;
- stale/unavailable/partial sources and omissions are visible;
- ignored and redacted behavior matches existing boundaries;
- one justified next action can be chosen within two minutes;
- the result works without network, model, daemon, scheduler, GUI, or
  notifications; and
- `DailyReport` v1, Fast Resume, target validation, and Raycast behavior are not
  weakened.

The direction fails if it becomes an activity feed with priority labels,
requires manual workstream upkeep or persisted checkpoints, derives status from
transcripts/LLMs, needs an external adapter before local value, hides coverage
gaps, exposes excerpts, weakens Fast Resume/Raycast, or introduces autonomous
execution, scheduling, or notification behavior.

## 12. Later implementation plan

1. Add `AttentionDigestResult` v1 types and a pure builder contract with fixed
   clock/observations; no CLI yet.
2. Compose one unchanged `DailyReport` v1 result and add project fallback
   grouping without duplicating report queries.
3. Share Fast Resume source-state and declared-action construction, with
   validation tests for active/archived/missing/unknown targets.
4. Add only the six deterministic rules in section 5 and the source-health
   aggregation, using synthetic positive and negative fixtures.
5. Add the read-only `worktrail attention --since --until --timezone --json`
   command and stable JSON serialization.
6. Add the human formatter in the prescribed section order.
7. Publish the privacy-safe golden/evaluation corpus and regression checks.
8. Dogfood locally, record sanitized closure results, and tighten noisy rules.

The **first implementation task** should do steps 1–2 only: introduce the
headless types/builder, compose `DailyReport` exactly once, and prove grouping,
window, clock, omissions, and unchanged `DailyReport` output with synthetic
tests. It must not add the command, migration, source checks, rules, or actions.
This creates the smallest reviewable seam before volatile validation and
attention policy are added.

## 13. Deferred questions

No open question blocks the first implementation slice. Dogfood must answer
whether dirty-with-file-intersection deserves `medium`, whether unassigned
groups need deterministic source-specific splitting at scale, and what explicit
source-specific threshold can activate `stale-source/v1`. Persisted
seen/snoozed checkpoints, project ambiguity UI, safe local path opening, and
external delivery state require later evidence and separate contracts.

This RFC does not authorize runtime code, commands, migrations, tests, Raycast,
GUI, adapters, integrations, or external writes. Its recommendation is ready
for the scoped first implementation task above.
