# Worktrail Domain Context

This document defines stable product vocabulary. It describes concepts, not an implementation backlog.

## Product and surfaces

- **Worktrail**: A local-first control tower for AI-assisted development. It connects evidence about agent activity and delivery state so a user can understand what changed, what needs attention, and where to resume.
- **CLI surface**: The primary, scriptable interface to Worktrail's core capabilities. Its machine-readable outputs are stable contracts for humans, automation, and other clients.
- **Command/launcher surface**: A keyboard-first client, such as Raycast or Alfred, for quick retrieval and daily orientation. It delegates domain work to Worktrail's core interfaces.
- **GUI surface**: The local Control Tower for reports, review, evidence inspection, and corrections. It is not the primary fast-retrieval interface.
- **Control Tower**: The GUI role that answers what happened, what is blocked, what needs review, and where work can resume across linked development activity.

## Core domain

- **Workstream**: A durable, user-meaningful unit of work that can span agent runs, repositories, branches, pull requests, and issues. It is an inferred or stabilized organizing object, not a second source of truth that users must maintain alongside their existing tools.
- **Candidate workstream**: A read-time, evidence-backed grouping that Worktrail suspects belongs together. It is not a persisted canonical assignment and must remain visibly provisional.
- **Canonical workstream**: A durable, named body of work stabilized by strong source signals or explicit correction. Canonical status does not make Worktrail the authority for facts owned by source tools.
- **Agent run**: One bounded execution or interaction history produced by an AI development tool. A run has source identity, time bounds, and a resume reference when the source supports resumption.
- **Codex thread/session**: Codex's source-specific form of an agent run, identified by its session UUID. “Thread” and “session” describe Codex source records, not Worktrail workstreams.
- **Connector/source**: A system from which Worktrail obtains facts, such as Codex rollouts, a local Git repository, GitHub, or Linear. A source may be local or API-backed.
- **Source adapter**: An isolated implementation that discovers and normalizes records from one connector into source-neutral Worktrail inputs. It does not own report or presentation policy.
- **Evidence**: A bounded, redacted fact with provenance that supports a displayed claim. Evidence remains attributable to its source and is disclosed only when requested where content may be sensitive.
- **State card**: An evidence-backed point-in-time answer about the best matching workstream or agent run, including resume information, activity, confidence, and supporting signals. It must not infer completion without evidence.
- **Resume reference**: An opaque source-provided value used to return to an agent run, such as a Codex session UUID. A client may copy or format it but must not silently execute it.
- **Resumable target**: A ranked, source-neutral answer to what the user can resume. It may represent a canonical workstream, candidate workstream, or run and includes a resume reference or command, confidence, supporting signals, related files and runs, and safe open actions when available.
- **Fast resume**: The CLI/launcher workflow that turns remembered context into ranked resumable targets with minimal interaction. It retrieves and formats actions but does not execute the source tool.
- **Signal**: An explainable fact used to rank, group, or qualify a result, such as a manual assignment, title match, shared file, repository identity, or recency. A signal retains enough provenance to audit its effect.
- **Entity link**: An evidence-backed or corrected relationship between source-neutral entities, such as a workstream and repository or pull request. Suggested links remain distinct from accepted links.
- **Repo identity**: A normalized identity for a local or hosted repository that allows signals from paths, Git, and future connectors to refer to the same repository without treating display paths as identity.
- **Open action**: A declarative, non-executing action offered by a result, such as copying a command or ID, opening local GUI detail, or opening an external source URL.

## User-authored organization

- **Correction**: A user-authored fact that overrides or refines derived organization. Corrections are explicit, auditable feedback that teaches Worktrail; they take precedence over heuristic grouping but are not intended as a daily parallel maintenance workflow.
- **Manual assignment**: A correction linking one agent run to one canonical workstream.
- **Alias**: User-authored vocabulary that refers to a canonical workstream and improves retrieval without renaming it.
- **Ignore**: A reversible correction excluding a source record from normal search, state, and report results.
- **Merge**: A non-destructive correction redirecting a duplicate workstream into a canonical target while retaining source identity and correction history.

The organizing progression is **Run → Candidate workstream → Canonical workstream → Resumable target**. The first three describe evidence and organization; the last is the user-facing retrieval answer assembled from them.

## Orientation and review

- **Daily report**: A time-bounded, structured view of workstream activity, changes, blockers, review needs, and resume points. It is a domain result that multiple surfaces can render.
- **No-token report**: A daily report produced deterministically from indexed local data and connector metadata, without an LLM call. Optional prose summarization is separate polish.
- **Review queue**: A prioritized set of evidence-backed items requiring user attention or a decision. Inclusion and priority must be explainable from available facts.
- **Evaluation corpus**: A privacy-safe, representative set of queries and expected outcomes used to measure retrieval, grouping, ranking, and regression behavior.
- **Retention / exclusion policy**: The documented rules governing which source facts Worktrail indexes or retains, for how long, and which ignored, sensitive, stale, or out-of-scope records are excluded from retrieval and reports.
