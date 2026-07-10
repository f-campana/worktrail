# RFC: Control Tower / Watch Tower v0

- **Status:** Proposed
- **Scope:** Product and architecture specification only; no runtime change
- **Date:** 2026-07-10

## 1. Summary

Worktrail should become a local-first control tower for AI-assisted work. It
should assemble source-backed observations about work already happening in
agent tools, repositories, and later delivery systems so one person can answer:
what changed, what remains open, what needs attention, what is blocked, what is
safe to resume, and why Worktrail believes each answer.

Fast Resume v0 proves the first action surface: remembered intent becomes a
ranked, explainable, freshness-checked Codex target that opens only after
click-time validation. Control Tower extends that pattern from one requested
target to ongoing orientation across bodies of work. It is not a dashboard
project. It is a source-neutral state, attention, evidence, and action model
that CLI, launcher, digest, and eventually GUI surfaces can render without
owning domain logic.

The thesis is directionally correct but needs one constraint:

> Worktrail is a local-first control tower for AI-assisted work. It reports
> what changed, what may still be open, what has source-proven attention or
> blocker signals, what can be resumed, the evidence and freshness behind each
> claim, and the explicit safe actions available next.

“May still be open” and “source-proven” matter. Worktrail must prefer `unknown`
to an attractive but unsupported status.

## 2. Problem statement

Fast Resume answers “where did I leave this?” It does not answer “what deserves
my attention now?” Long-running work creates a broader reconstruction problem:

- many agent runs, code branches, documents, messages, and decisions remain
  active at once;
- changes made since the last review are distributed across tools;
- a completed agent turn is easy to confuse with completed work;
- a dirty branch, failing check, pending review, archived thread, or missing
  decision can each interrupt progress, but they mean different things;
- related runs, repositories, pull requests, and documents are not reliably
  linked into one body of work;
- source facts become stale at different rates;
- generated summaries can sound authoritative without proving their claims;
- manually recreating this state in Worktrail would create a second project
  management system that immediately drifts.

The user needs a trustworthy orientation layer over existing work, not another
place to maintain tasks. Worktrail should observe sources, retain only the
minimum durable projection and corrections it needs, derive conservative state
and attention, and return the user to the authoritative source for action.

## 3. Product principles

The following principles are requirements for Control Tower v0:

1. **Infer from existing tools first.** Prefer source observations and links
   over user-authored Worktrail records.
2. **Corrections are feedback, not bookkeeping.** A correction should repair an
   inference or suppress noise, not create a parallel daily maintenance loop.
3. **Local-first by default.** Local sources and the local projection must work
   offline. Remote sources are optional enrichments with isolated credentials.
4. **Source-backed evidence over generated claims.** Every material status and
   attention reason must point to bounded provenance.
5. **No hidden autonomous actions.** Observation never grants authority to
   mutate a source.
6. **Read-only before write.** A new adapter must prove useful facts and trust
   boundaries before it exposes mutations.
7. **Safe actions are explicit and user-initiated.** Actions are declarative
   data; clients validate applicable targets at execution time.
8. **CLI/core contracts first.** State and attention policy belongs in
   source-neutral, versioned results.
9. **Launcher/action surfaces second.** Raycast remains a thin client for fast
   retrieval and explicit actions.
10. **GUI/control room third.** Persistent visual space is warranted after the
    state and attention contracts survive dogfood.
11. **Deterministic state first.** LLMs may summarize a proven model later, but
    cannot supply missing facts or make the baseline available.
12. **Unknown is a valid result.** Absence of evidence is not evidence of done,
    blocked, ready, or abandoned.
13. **No second source of truth.** Worktrail owns its projection, corrections,
    attention dispositions, and digest checkpoints; source tools own their
    native work state.

## 4. Naming and scope

The existing repository already uses **Control Tower** in `CONTEXT.md`, ADR
0003, the daily-report PRD, and the roadmap. V0 should retain **Control Tower**
as the internal umbrella rather than introduce `Worktrail Tower`, `Worktrail
Console`, or another competing domain name.

The useful distinction is behavioral:

- **Watch Tower** describes observation: notice changes, freshness, risks, and
  evidence without coordinating mutations.
- **Control Tower** describes the larger product role: combine observation with
  explicit, validated, user-initiated actions across active work.

Therefore “watch mode” can describe the read-only v0 posture, but should not be
a separate product or persisted entity. `ControlTower*` is the recommended
internal vocabulary for future source-neutral contracts. Surface names should
describe the user job—`attention`, `digest`, `review`, `resume`—rather than the
metaphor.

The scope is individual, local-first orientation across AI-assisted work.
Control Tower may eventually observe non-development tools, but the first
contracts must remain grounded in Codex-local, project identity, workstreams,
SQLite, and read-only Git facts already present.

## 5. Core primitives

The primitives below define the domain. “Durable” means persisted by Worktrail;
it does not mean Worktrail becomes authoritative for the source fact.

| Primitive            | Definition and creator                                                                                                                                            | Origin and lifetime                                                                                | Required evidence                                                                                                  | Possible actions                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Source**           | A system or bounded store from which facts are observed, such as Codex local sessions or one Git repository. Declared by configuration or discovery.              | Imported/discovered; durable identity with ephemeral health observations.                          | Adapter identity, source URI or opaque key, observation time, permission scope.                                    | Inspect health, refresh explicitly, open source settings.                            |
| **Source Adapter**   | An isolated reader that discovers and normalizes one source. Created in code and configured by the user.                                                          | Durable capability; runtime observations are ephemeral or cached.                                  | Adapter version, supported fact types, read/write scope, diagnostics.                                              | Test connection, index, revoke credentials; no domain classification.                |
| **Run**              | One bounded execution or interaction history produced by an agent tool. The current Codex thread/session is a source-specific run.                                | Imported and durable as a local projection; source remains authoritative.                          | Source ID, external ID, timestamps, lifecycle events, resume reference.                                            | Open, copy resume reference, inspect bounded evidence, ignore.                       |
| **Thread**           | A source-native conversational container. It can contain one or more turns/runs depending on source semantics.                                                    | Imported; durable projection. Never assume every source's thread equals an execution.              | Source-native identifier and adapter semantics.                                                                    | Open, resume when supported, archive only through an explicit source action later.   |
| **Project Identity** | Durable repository/project context that groups runs by verified Git common directory or conservative cwd fallback. Created by deterministic reconciliation.       | Inferred, durable, user-correctable through explicit aliases.                                      | Project observations, opaque identity key, provenance, confidence.                                                 | List, add/remove alias, inspect members.                                             |
| **Workstream**       | A user-meaningful body of work spanning runs and artifacts. It is not synonymous with repository or task record.                                                  | Candidate workstreams are ephemeral; canonical workstreams and corrections are durable.            | Strong source links or explicit correction; current manual assignments remain authoritative only inside Worktrail. | Resume best run, inspect evidence, correct membership, merge duplicates.             |
| **Agent**            | The actor or execution capability that produced a run, not a person-like status inferred from prose.                                                              | Imported when the source exposes stable identity; otherwise ephemeral/unknown.                     | Source-provided agent/model/tool identity and run relationship.                                                    | Open run; later resume only through an explicit validated action.                    |
| **Event**            | An immutable normalized observation at a time: message, tool call/result, file change, turn boundary, source state change, check result, assignment, or decision. | Imported or locally generated; durable when needed for audit, otherwise reducible.                 | Source, external record identity, observed/occurred times, normalized kind.                                        | Open provenance; events do not expose actions by themselves.                         |
| **State Card**       | A point-in-time, evidence-backed projection for one run, project, or workstream. It separates observed facts, derived state, freshness, and limitations.          | Derived at read time; snapshots may be cached with `asOf`.                                         | Constituent observations, derivation rule/version, confidence, freshness.                                          | Open best target, inspect why, correct a link, mark attention disposition.           |
| **Attention Item**   | A ranked claim that user review or a decision may be warranted. It is not a source task.                                                                          | Derived and usually ephemeral; disposition may be durable.                                         | Triggering rule, evidence, `asOf`, priority inputs, reason, uncertainty.                                           | Open evidence/target, ignore/snooze locally, perform a separately classified action. |
| **Open Loop**        | A supported unresolved obligation, question, requested review, or promised follow-up.                                                                             | Imported when explicit; inferred candidates remain ephemeral; user confirmation may stabilize one. | Explicit assignment/request/status or multiple corroborating events; silence alone is insufficient.                | Open source, mark ignored/resolved locally, later correct linkage.                   |
| **Blocker**          | A condition explicitly preventing progress, such as a failing required check or a source-declared blocked issue.                                                  | Imported or conservatively derived; ephemeral until refreshed.                                     | Blocking source state, affected entity, observed time, rule mapping.                                               | Open failing check/source, copy remediation command; no auto-fix.                    |
| **Decision**         | A committed choice with scope, time, author/source, and supporting context.                                                                                       | Imported or user-captured; durable. A proposal is not a decision.                                  | Explicit decision record or user confirmation plus provenance.                                                     | Open source, copy citation, supersede through an explicit correction later.          |
| **Artifact**         | A durable output or work object: file, commit, branch, PR, issue, document, message, build, or report.                                                            | Imported/reference-only; Worktrail stores normalized identity and metadata.                        | Source identifier, type, location, timestamps, relationships.                                                      | Open, copy reference, create draft only with explicit write scope.                   |
| **Evidence**         | A bounded, redacted observation that supports a claim.                                                                                                            | Imported and durable within retention policy, or fetched on demand.                                | Provenance, excerpt/hash, timestamp, truncation/redaction metadata.                                                | Disclose explicitly, open source location, copy safe citation.                       |
| **Action**           | A declarative next operation with target, risk class, permission requirement, and validation policy.                                                              | Derived at read time; action audit becomes durable only if executed by Worktrail.                  | Source capability, target identity, current validation result.                                                     | Copy, open, local correction; external writes are deferred by default.               |
| **Freshness**        | The age and verification status of an observation relative to source-specific expectations.                                                                       | Derived and ephemeral; last successful check is durable source health metadata.                    | `observedAt`, source time, check result, freshness policy.                                                         | Recheck, reindex, open source; never silently refresh through broad writes.          |
| **Confidence**       | A categorical statement about inference support, not a probability and not a substitute for evidence.                                                             | Derived at read time from versioned rules.                                                         | Signal types, coverage, conflicts, calibration fixtures.                                                           | Show why; invite correction.                                                         |
| **Correction**       | An explicit local fact that overrides, links, renames, ignores, or disposes derived organization.                                                                 | User-created and durable; auditable and reversible where possible.                                 | User intent, previous state, timestamp, affected entity.                                                           | Undo, inspect audit, apply to future inference.                                      |
| **Digest**           | A time-bounded rendering of changes and attention since an explicit checkpoint.                                                                                   | Derived; checkpoint/disposition may be durable, content can be regenerated.                        | Window boundaries, source coverage, state/attention cards, omissions.                                              | Open items, copy report, mark digest reviewed locally.                               |

Two additional primitives are implicit in every row:

- **Relationship:** a source-backed or corrected edge between entities. Suggested
  relationships remain distinct from accepted relationships.
- **Permission Grant:** the least-privilege authority for an adapter or action.
  Observation permission never implies mutation permission.

## 6. State model

### 6.1 Layered state

Worktrail must not flatten different kinds of state into one status:

| Layer                | Question answered                                             | Owner                                                           | Examples                                                                                  |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Source state**     | What does the authoritative source currently report?          | Source; Worktrail caches an observation.                        | Codex thread active/archived/missing/unknown; Git worktree dirty; future PR check failed. |
| **Run state**        | What can be proven about one agent execution or conversation? | Source semantics plus Worktrail projection.                     | observed-active, waiting-on-user, waiting-on-agent, finished-turn, stale, unknown.        |
| **Workstream state** | What conservative aggregate describes the body of work?       | Worktrail derivation plus corrections; never overrides sources. | active, blocked, ready-to-review, done, stale, unknown.                                   |
| **Attention state**  | Does the user need to look now, and why?                      | Worktrail policy and user disposition.                          | critical, action-needed, review, watch, suppressed, none, unknown.                        |

Each state observation should carry `value`, `asOf`, `sourceEvidence`,
`confidence`, `freshness`, and `ruleVersion`. Source and derived state must be
separate fields in contracts.

### 6.2 Conservative vocabulary

The following vocabulary is allowed, subject to proof rules:

- **active:** recent source activity or an explicitly active source object. It
  does not mean useful work is currently executing.
- **waiting-on-user:** only an explicit source lifecycle signal or a supported
  request directed to the user. An assistant ending a message is insufficient.
- **waiting-on-agent:** only a source-proven in-progress execution or queued
  agent job. An old turn-start without a reliable liveness contract becomes
  stale/unknown, not indefinitely waiting.
- **blocked:** an explicit blocker or deterministic blocking source rule with a
  named dependency.
- **ready-to-review:** an explicit review request or reviewable artifact with
  source-proven readiness. Dirty files alone do not qualify.
- **ready-to-merge:** a linked change with source-proven mergeability and
  required checks/reviews satisfied. This cannot exist before a delivery
  adapter provides those facts.
- **stale:** evidence exceeded a source-specific freshness threshold. Stale is
  a property, not proof that work is abandoned or blocked.
- **done:** explicit authoritative completion or a user correction. A completed
  turn, clean tree, merged PR, or closed issue may be evidence but must not
  silently complete a broader workstream.
- **archived:** the source or user explicitly archived the entity. It is a
  lifecycle fact, not the same as done.
- **unknown:** current evidence cannot support another state.

Run and workstream state should be multi-fact rather than a lossy enum where
needed. For example, a workstream may be `active` with a `blocked` delivery
facet and stale documentation evidence. Presentation may choose one headline
state, but the contract must retain the contributing facets.

### 6.3 Workstream aggregation

Workstream state is derived only from linked entities:

1. Preserve each source state and its freshness.
2. Apply explicit corrections.
3. Identify conflicts rather than choosing the most convenient source.
4. Emit a headline only when a documented rule is satisfied.
5. Otherwise emit `unknown` plus known facts.

V0 must not infer workstream completion, readiness, or blockage from transcript
language, recency alone, or the absence of recent activity.

## 7. Attention model

An attention item is warranted when a source-backed condition changes the
user's likely next decision. It must contain:

```ts
type AttentionItem = {
  id: string;
  subject: { kind: string; id: string; title: string };
  category:
    | "failure"
    | "review"
    | "decision"
    | "waiting"
    | "freshness"
    | "source-health"
    | "open-loop";
  priority: "critical" | "high" | "normal" | "low";
  reason: string;
  changedAt: string;
  asOf: string;
  confidence: "high" | "medium" | "low";
  evidence: EvidenceRef[];
  actions: Action[];
  disposition?: "new" | "seen" | "snoozed" | "ignored" | "resolved";
};
```

Initial and future qualifying examples include:

- a source-proven agent job finished and exposes an artifact for review;
- a linked required CI check failed;
- a repository with recent relevant activity has uncommitted changes;
- a previously resumable Codex thread is now archived or missing;
- a source adapter failed, lost permission, or is too stale for a claim;
- an explicit request, assignment, mention, or decision dependency is open;
- a linked document or artifact changed since the last digest;
- multiple strongly linked runs contain the same explicit unresolved request.

The following do not qualify by themselves: age, a completed turn, an assistant
asking a generic question, a content match for “blocked”, an unassigned run, or
a low-confidence candidate grouping.

### Ranking model

Ranking is specified, not implemented here. Order should consider:

1. **Severity and reversibility:** data loss/security and hard failures first.
2. **Direct responsibility:** explicit assignment/mention before ambient change.
3. **Blocking impact:** number and importance of linked entities prevented from
   progressing.
4. **Change novelty:** new or worsened since the last acknowledged checkpoint.
5. **Confidence and freshness:** fresh high-confidence evidence before stale or
   inferred candidates.
6. **Actionability:** a safe, concrete next action before an informational item.
7. **User disposition:** unseen before seen; snoozed/ignored suppressed until
   their policy says otherwise.
8. **Recency:** a tie-breaker, not a proxy for importance.

Every rank must expose a compact “why this is attention-worthy” explanation.
No opaque cross-category score should be declared stable until evaluated on a
privacy-safe corpus.

## 8. Source inventory and future adapters

### Current sources and surfaces

| Source               | Facts available now                                                                                                                   | Boundary                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Codex local sessions | Threads, turns, messages, tool calls/results, file changes, titles, cwd, archive location, resume reference, bounded freshness state. | Internal formats may change; transcripts are bounded/redacted; current freshness is metadata-only. |
| Local Git            | Repository root, branch, short HEAD, dirty count, bounded commits/files in a report window.                                           | Read-only subprocesses; no remotes, diffs, PRs, checks, or review inference.                       |
| Worktrail SQLite     | Imported facts, evidence, project identities, workstreams, corrections, index diagnostics, stable public projections.                 | Local projection, not source authority; read-only launcher paths do not migrate.                   |
| Raycast launcher     | User query, selected declared action, click-time target validation, transient client state.                                           | It is a surface, not a source of work state; no SQLite/Codex inspection or ranking.                |

### Adapter posture

| Possible source            | Timing                                   | Read-only first? | Useful facts                                                               | Main privacy/permission risk                                                                       | Needed before v0?                                         |
| -------------------------- | ---------------------------------------- | ---------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Local filesystem**       | v0 candidate, narrowly                   | Yes              | File existence/mtime for already linked artifacts.                         | Broad path traversal and sensitive content. Restrict to explicit/project roots and metadata first. | No; Git and indexed file references suffice initially.    |
| **Terminal logs**          | Later                                    | Yes              | Command completion/failure and working directory when explicitly captured. | Secrets, credentials, enormous noisy history.                                                      | No.                                                       |
| **GitHub**                 | Next enrichment after local digest proof | Yes              | PR state, reviews, required checks, assignments, links, updated times.     | Repository breadth, private code metadata, tokens, comments.                                       | No; required for trustworthy ready-to-review/merge later. |
| **CI/CD**                  | Later, preferably through GitHub first   | Yes              | Job/check result, required status, failure URL.                            | Logs contain secrets; provider credentials and retention.                                          | No.                                                       |
| **Linear**                 | Later                                    | Yes              | Issue state, assignee, blocker relationships, explicit completion.         | Workspace-wide issue/customer metadata.                                                            | No.                                                       |
| **Notion**                 | Later                                    | Yes              | Document identity, last edited time, explicit decision/task metadata.      | Broad workspace content and people data.                                                           | No.                                                       |
| **Obsidian**               | Later/local candidate                    | Yes              | Linked local notes, mtimes, explicit frontmatter.                          | Personal notes outside work scope.                                                                 | No.                                                       |
| **Gmail**                  | Not now                                  | Yes              | Direct requests, replies, timestamps, thread links.                        | Extremely broad personal/business communications and attachments.                                  | No.                                                       |
| **Slack**                  | Not now                                  | Yes              | Mentions, assignments, decisions, thread activity.                         | High-volume conversation, third-party data, ambiguous commitments.                                 | No.                                                       |
| **Google Calendar**        | Not now                                  | Yes              | Upcoming decision/review events and temporal context.                      | Attendee, title, location, and personal schedule exposure.                                         | No.                                                       |
| **Claude Code**            | Later                                    | Yes              | Agent runs, lifecycle, files, resume references if stable.                 | Transcript and local credential boundaries; source format drift.                                   | No; prove the source-neutral run contract first.          |
| **Cursor**                 | Later                                    | Yes              | Agent/chat runs, files, project context, resume target if supported.       | Private editor state and unstable local formats.                                                   | No.                                                       |
| **Gemini**                 | Later                                    | Yes              | Agent runs and source-native lifecycle if available.                       | Transcript, credentials, source format variance.                                                   | No.                                                       |
| **Browser bookmarks/tabs** | Not now                                  | Yes              | Explicitly linked research artifacts and recent context.                   | Browsing history is highly sensitive and semantically noisy.                                       | No.                                                       |

The strict sequence is: prove a local deterministic attention contract, then
add one adapter that supplies a currently impossible high-value fact. GitHub is
the leading remote candidate because it can prove review/check/merge state, but
it is not a prerequisite for the first Control Tower slice. No general
integration hub is proposed.

## 9. Surfaces

| Surface                     | Role                                                                                                        | V0 posture                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **CLI**                     | Canonical way to request and serialize state, attention, provenance, and declared actions.                  | First. Stable versioned JSON plus compact human output.                                                |
| **Raycast/global launcher** | Fast lookup, open, copy, and later a small attention peek.                                                  | Thin client only; Fast Resume remains its proven primary job.                                          |
| **Daily digest/report**     | Time-bounded orientation: changes, supported attention, unknowns, coverage, and resume points.              | First product slice after Fast Resume. Render through CLI before scheduling or notifications.          |
| **Local GUI**               | Sustained review, filtering, evidence drill-down, corrections, and source health once contracts are proven. | Later. Existing read-only UI is a useful shell, not authorization for dashboard-first work.            |
| **MCP/server/tool API**     | Let local clients query the same headless contracts.                                                        | Later and demand-driven. The current local server does not justify a daemon or persistent MCP service. |
| **Notifications**           | Interrupt only for proven urgent changes with explicit opt-in.                                              | Not v0. A digest should prove precision before push interruption.                                      |

The first surface after Fast Resume should be a CLI-rendered **Daily Attention
Digest v0**, not a GUI control room. It reuses the existing `DailyReport`, state,
project, Git, freshness, evidence, and action patterns while forcing the missing
attention contract to become explicit.

## 10. Evidence and trust

Control Tower is useful only if users can audit it. Every claim should carry:

- source and adapter identity;
- source entity/reference and observation timestamp;
- derivation rule and version for non-source state;
- freshness state and last successful source check;
- confidence category with contributing signals;
- bounded evidence references, with sensitive excerpts omitted by default;
- a plain-language reason for attention inclusion;
- the previous observation or checkpoint needed to explain what changed;
- explicit limitations, conflicts, omissions, and unknown state.

Trust rules:

1. Redact and bound content before persistence, preserving the current importer
   boundary. Raw source content remains at the source.
2. Cite metadata by default; disclose transcript-like excerpts only on explicit
   request.
3. Keep `occurredAt`, `observedAt`, and digest/checkpoint time distinct.
4. A stale source cannot support a fresh status. Retain the last observation but
   label it stale and lower or suppress dependent attention.
5. Conflicting sources produce a conflict, not silent precedence, unless an
   explicit authority rule exists.
6. Generated prose may paraphrase only the deterministic model and must retain
   citations. It cannot introduce a status, blocker, decision, or open loop.
7. “No evidence” renders as unknown or unavailable, not as clear, healthy, or
   done.
8. “What changed” compares normalized observations/checkpoints, not generated
   descriptions.

## 11. Actions

Actions are capabilities, not commands hidden in prose.

| Class                      | Examples                                                                                                                                   | V0 policy                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read-only / navigation** | Copy command or ID; open validated Codex thread; open file, repository, PR, or document; inspect evidence; refresh a bounded source check. | Allow when declared, target-scoped, and user-initiated. Validate volatile targets before open where possible.                                                                            |
| **Local Worktrail write**  | Mark attention seen/ignored/snoozed; add/remove alias; correct assignment; mark digest reviewed; create a local draft.                     | Allow only behind explicit write capability, audit, and reversible semantics. V0 digest should need at most attention disposition/checkpoint writes; it must remain useful without them. |
| **External write**         | Comment, assign, archive source thread, update issue, create PR/document draft, resume agent.                                              | Defer. Each requires a separate adapter/action RFC, least-privilege grant, preview, confirmation, idempotency, and audit.                                                                |
| **Dangerous/autonomous**   | Merge, push, send message, approve, deploy, delete, repeatedly resume agents, notify others automatically.                                 | Prohibited in v0. Never implied by connector access.                                                                                                                                     |

`summarize` is read-only only when it operates on already permitted, bounded
data and writes nowhere. `create draft` is a local or external write depending
on destination. `resume agent` is an external action even if opening a thread is
read-only: opening must not submit a prompt or start work.

## 12. Non-goals

Control Tower v0 is not:

- a full project management system, task database, Linear clone, or Notion
  clone;
- an agent orchestrator, autonomous continuation loop, or action runner;
- a cloud sync product, team workspace, or permissions administration suite;
- a generic source-by-source dashboard or integration hub;
- a graph visualization or relationship toy;
- a RAG chatbot or LLM-dependent status summarizer;
- a second source of truth for PRs, issues, documents, messages, or agent runs;
- a daemon, watcher, background scheduler, or notification service;
- a replacement for Fast Resume, search, or authoritative source tools.

## 13. Candidate first slices

### A. Daily Attention Digest v0 — recommended

- **Goal:** Explain what changed in an explicit window and surface only
  deterministic local attention candidates with safe resume/open actions.
- **Why it matters:** It addresses the return-to-work problem and turns the
  existing activity report into a decision aid without requiring a GUI or
  remote connector.
- **Inputs:** Existing `DailyReport`, project/workstream membership, Codex
  active/archive/missing/unknown checks, indexing diagnostics, local Git facts,
  ignored records, and explicit window/checkpoint.
- **Output:** A source-neutral versioned digest rendered by a CLI command or a
  compatible evolution of `report`; no scheduling.
- **Success criteria:** Users can identify recent change, supported attention,
  source gaps, and one safe resume point in under two minutes; every item has a
  reason and evidence; false blocker/review/done claims are zero in the dogfood
  corpus.
- **Risks:** “Attention” can become a renamed activity feed; dirty repositories
  can be noisy; report contract compatibility needs an explicit decision.
- **Why now:** All inputs are local and mostly implemented. Fast Resume supplies
  trusted actions. **Why not later:** A GUI or GitHub adapter built first would
  hide the missing attention contract.

### B. Source Health / Freshness Monitor

- **Goal:** Show which source observations are current, stale, unavailable, or
  incompatible.
- **Why it matters:** State claims cannot be trusted without coverage and
  freshness.
- **Inputs:** Indexing runs/diagnostics, schema checks, Codex source-state
  checker, adapter configuration, last successful observation.
- **Output:** CLI/source-health section embeddable in a digest.
- **Success criteria:** Every status claim can identify its freshness; source
  failures degrade to bounded actionable diagnostics.
- **Risks:** Useful infrastructure can feel like product progress without
  answering what needs attention.
- **Why now / not now:** Implement as a bounded component of the digest; do not
  lead with a standalone monitoring product.

### C. Workstream State Cards v0

- **Goal:** Produce query-independent cards that separate source facts,
  workstream derivation, attention, freshness, and actions.
- **Why it matters:** Current `StateCard` is query-centric and includes evidence
  relevance; Control Tower needs repeatable point-in-time projections.
- **Inputs:** State/search results, workstream assignments/candidates, project
  identity, run/source observations.
- **Output:** Versioned core contract and CLI inspection command.
- **Success criteria:** The same card renders consistently in digest and future
  GUI, with unsupported fields unknown.
- **Risks:** Prematurely stabilizing a broad schema; sparse canonical
  workstreams may limit dogfood.
- **Why now / not now:** Design alongside the digest, but implement only fields
  proven necessary by it.

### D. Review Queue v0 with GitHub read-only enrichment

- **Goal:** Surface linked PRs with explicit review requests or failing required
  checks.
- **Why it matters:** It adds high-signal delivery attention that local activity
  cannot prove.
- **Inputs:** A separately reviewed GitHub adapter, repository/PR linking,
  credentials, cache/freshness rules.
- **Output:** CLI review queue and later digest/GUI section.
- **Success criteria:** Required review/check facts match GitHub, remain useful
  with connector failure, and request least privilege.
- **Risks:** Credential scope, entity-link errors, API limits, premature remote
  complexity.
- **Why now / not now:** It is the strongest second slice after local attention
  semantics work, not the first Control Tower slice.

### E. Open Loops Report v0

- **Goal:** List explicit unresolved requests, assignments, and decisions across
  linked work.
- **Why it matters:** Open loops are closer to human intent than activity.
- **Inputs:** Source-native assignment/status facts or a rigorously evaluated
  candidate extractor, relationship model, correction/disposition feedback.
- **Output:** CLI report with evidence and confidence.
- **Success criteria:** High precision on explicit loops and clear separation of
  candidates from confirmed loops.
- **Risks:** Transcript language invites hallucinated commitments and requires
  semantic interpretation not yet proven deterministically.
- **Why now / not now:** Specify now, defer implementation until a source
  exposes explicit obligations or a privacy-safe corpus supports conservative
  rules.

The local GUI Control Room shell and Agent Run Status are not top-five first
slices. The existing GUI is enough to render later contracts, and current Codex
events do not provide a reliable cross-process liveness contract for agent
waiting/running claims.

## 14. Recommended first slice: Daily Attention Digest v0

### What it does

For an explicit `[since, until)` window, build one deterministic, source-neutral
digest with four ordered sections:

1. **Attention:** only rule-backed local items, initially source-health failure,
   previously open Codex target now archived/missing, and a recently active
   linked repository with current uncommitted changes. Labels must describe the
   fact—never “blocked” or “needs review” unless proven.
2. **Changed:** active canonical workstreams, project-grouped runs when no
   canonical workstream exists, bounded commit/file facts, and newly observed
   source changes.
3. **Resume:** the best current validated resume action for each displayed body
   of work, using existing Fast Resume action and freshness conventions rather
   than executing Codex.
4. **Coverage and unknowns:** ignored counts, stale/unavailable sources,
   diagnostics, unsupported state categories, and exact report boundaries.

Every attention item includes subject, reason, current and previous/checkpoint
fact where available, evidence references, freshness, confidence, and declared
safe actions. Ordering follows the attention model; deterministic ties use
change time and stable ID.

### What it does not do

It does not:

- infer completion, blockage, review readiness, merge readiness, agent
  liveness, promises, or decisions from transcript prose;
- add GitHub, Linear, document, messaging, or non-Codex adapters;
- schedule itself, notify, run in a daemon, or create a GUI;
- add an LLM summary;
- create canonical workstreams, tasks, or project records as user homework;
- execute resume, Git, or source mutation commands.

### Why it is the right next move

The slice joins two already proven contracts: the deterministic daily report
answers what was active, and Fast Resume answers where to go. It adds the
smallest missing layer—conservative attention and source coverage—using local
facts. It also produces the domain contract ADR 0003 requires before meaningful
GUI expansion and exposes which remote fact would be most valuable next.

### Data used

- `DailyReport` window, active workstreams, unassigned runs, omitted counts, and
  local Git signal/diagnostic data;
- durable project identities and explicit aliases;
- canonical/manual and candidate workstream semantics without auto-promotion;
- Codex-local source metadata and bounded active/archive/missing/unknown checks;
- Worktrail indexing runs and diagnostics;
- existing declared resume/open actions and validate-before-open policy;
- bounded redacted provenance, with excerpts omitted by default.

No migration should be assumed by the implementation RFC. If persisted
checkpoint or disposition state is necessary, it requires a separately
justified minimal migration and must not block a stateless explicit-window
baseline.

### Commands and surfaces

The implementation RFC should choose compatibility deliberately between:

```sh
worktrail report --since ISO --until ISO --attention --json
worktrail attention --since ISO --until ISO --json
```

The product recommendation is a distinct `attention` domain result and command,
because the existing `DailyReport` schema version 1 promises activity and
explicitly declines attention classification. Internally it should compose the
existing report builder rather than duplicate its queries. Human output and
schema-versioned JSON come first. Raycast may later show a small read-only peek;
the GUI and notifications are out of scope.

### Closing the loop

Dogfood should compare each digest item to its source and record:

- whether the item changed the user's next action;
- whether its category and priority were justified;
- whether the reason and provenance were understandable without transcript
  disclosure;
- whether the declared target was current and opened exactly;
- false-positive and false-negative attention candidates;
- time to orient and choose one next action;
- source gaps that prevented a useful state claim.

Corrections should initially be limited to existing ignore/alias/assignment
controls. Add attention snooze/seen state only after repeated items prove the
need.

### Validation of success

The first slice is successful when, on a representative privacy-safe and local
dogfood corpus:

- identical inputs, clock, and source observations produce identical JSON;
- every attention item has at least one bounded source fact and a documented
  rule;
- no item claims done, blocked, ready-to-review, ready-to-merge, or agent
  liveness without an authoritative signal;
- archived/missing targets never expose an unvalidated open action;
- stale or unavailable sources are visible and dependent claims are qualified;
- ignored records and redaction boundaries match current behavior;
- a user can choose one justified next action within two minutes;
- the report remains useful without network, model, daemon, scheduler, or GUI.

## 15. RFC success criteria

This RFC succeeds if it:

- establishes a direction beyond Fast Resume without weakening Fast Resume;
- defines source-neutral state, attention, evidence, freshness, and action
  primitives before surfaces;
- treats Worktrail as a projection and feedback layer, not a second source of
  truth;
- makes unknown, provenance, redaction, confidence, and permission boundaries
  product behavior;
- narrows future adapters to incremental fact providers;
- proposes realistic vertical slices and chooses one local, deterministic next
  slice;
- preserves read-only/default behavior and explicit user-initiated actions;
- remains consistent with the current code, ADRs, daily report, project
  identity, Fast Resume, and Raycast foundation.

## 16. Failure criteria

The direction fails if implementation:

- starts with a GUI, graph, generic dashboard, or source navigation shell;
- adds multiple integrations before proving the attention contract;
- asks users to maintain Worktrail tasks/workstreams to make the product useful;
- claims source or workstream state from unsupported transcript language;
- depends on LLM summaries for baseline correctness;
- requires cloud/team infrastructure, a daemon, or notifications for v0;
- hides privacy, permission, freshness, or redaction boundaries;
- lets clients reimplement ranking, state, attention, or action policy;
- treats opening a thread as authority to resume an agent;
- expands the first slice beyond a focused, locally testable contract.

## 17. Open questions and decision record

The following questions belong in the next implementation RFC:

1. Should `attention` be a new command/schema or an opt-in `DailyReport` v2?
   This RFC recommends a new domain result composed from `DailyReport` v1.
2. What exact Git condition makes a dirty repository attention-worthy without
   creating chronic noise: recent window activity, a changed dirty count, or an
   explicit checkpoint comparison?
3. Can current Codex metadata establish “previously open, now archived/missing”
   without persistent snapshots, or should v0 show current source health only?
4. Should project identity be the fallback grouping in the digest when no
   canonical workstream exists? This RFC recommends yes, visibly labeled as
   project context rather than a workstream.
5. Which source-health facts need persistence, and which can remain ephemeral
   for an explicit report run?
6. What is the smallest privacy-safe evaluation corpus for attention precision
   and time-to-orient?
7. After local dogfood, does GitHub review/check state provide more incremental
   value than local attention dispositions or richer source freshness?

This RFC does not authorize implementation, migrations, adapters, dependencies,
network/model calls, daemon work, scheduling, notifications, Raycast changes,
or GUI changes. Its recommendation is ready for a separate implementation RFC
only after these contract questions are resolved against current data.

## Quality gate for this specification

This documentation-only pass requires:

```sh
pnpm format:check
git diff --check
```

Repository typecheck, tests, and UI build remain the collaboration quality gate
before merge even though this RFC changes no runtime behavior.
