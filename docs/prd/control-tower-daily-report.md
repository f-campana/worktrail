# PRD: Control Tower Daily Report

## Problem Statement

Worktrail can retrieve where a remembered piece of work occurred, but users returning after time away still have to reconstruct what changed, what needs review, and where to resume. Activity will eventually span agent runs, local Git, pull requests, checks, reviews, and issues. A search-first screen or source-by-source feed does not provide a trustworthy daily orientation.

## Target Users

- Individual developers using Codex across multiple concurrent workstreams.
- Power users who prefer terminal and global-shortcut workflows.
- Developers who need private, local orientation before opening external tools.

## Solution

Introduce a source-neutral, headless daily report model. Its baseline deterministically composes indexed facts for a requested time window without model tokens. The CLI exposes retrieval and report results through versioned JSON. A launcher provides rapid lookup and resume actions. The GUI renders the report as a Control Tower with drill-down to workstreams and explicitly disclosed evidence. Local Git, GitHub, and Linear signals enter incrementally through isolated adapters after the existing-data baseline proves the model.

## Core User Stories

- As a returning developer, I can see which workstreams were active since a specified time and their supported latest activity.
- I can see a safe resume reference for relevant agent runs without Worktrail executing it.
- I can distinguish factual activity from items conservatively classified as needing review or blocked.
- I can retrieve a workstream from CLI or launcher using what I remember and receive the same core answer.
- I can open GUI detail for provenance and request sensitive evidence explicitly.
- As Git and hosted connectors arrive, I can see their status attached to a workstream rather than in separate tool dashboards.

## Non-Goals

- Generating prompts, autonomously resuming work, or orchestrating agents.
- A graph visualization, cloud sync, team features, or generalized analytics.
- Implementing non-Codex agent adapters in this initiative.
- Depending on LLM summarization for report correctness or availability.
- Building a complete GitHub or Linear dashboard.

## Product Surfaces

- **CLI/core:** primary retrieval and report contract; human output plus stable JSON.
- **Command/launcher:** thin keyboard-first client for lookup, top result, copyable `codex resume <SESSION_ID>`, and local detail links.
- **GUI Control Tower:** daily report, review queue, evidence inspection, workstream detail, and later proven correction workflows.

## Implementation Decisions

- Define a versioned `DailyReport` domain result independent of CLI, HTTP, React, and connector payloads.
- Accept an explicit time window and injectable clock/time zone policy; avoid reading wall-clock time deep in report logic.
- Compose normalized facts by workstream. Preserve unassigned agent runs without inventing canonical assignments.
- Keep Codex parsing, local Git collection, GitHub API mapping, and Linear API mapping in separate adapters. Adapters normalize facts; they do not classify or render reports.
- Put report inclusion, ordering, and conservative review/blocker rules in one headless application module.
- Treat CLI, API, launcher, and GUI as clients of public core interfaces. GUI components receive report view data and do not join source tables.
- Future connector credentials and caches must be source-scoped and must not alter the existing SQLite schema until a separately reviewed slice requires it.

Deep seams should remain: source discovery/normalization, persistence/querying, workstream organization, state/report composition, and presentation transport. This avoids tangling GUI logic, report policy, GitHub/Linear semantics, and Codex parsing.

## Testing Decisions

- Test report behavior through the public report builder using synthetic databases, a fixed clock, and explicit time zones.
- Golden-test the versioned JSON contract, including empty windows, boundary timestamps, ignored records, manual assignments, aliases, merged workstreams, and unassigned runs.
- Add adapter contract tests for malformed, partial, missing, duplicated, and incrementally updated source data.
- Test every review/blocker classification with positive and negative fixtures; expose supporting signals.
- API and CLI tests verify serialization and evidence omission by default. Browser tests verify rendering, navigation, error/empty states, and opt-in evidence loading.
- Preserve redaction-before-persistence, byte limits, loopback binding, read-only default, and correction authorization tests.

## Privacy/Safety Requirements

- The no-token baseline performs no LLM call and requires no model credential.
- Raw transcript content is never copied into report metadata. Excerpts remain bounded, redacted, and opt-in.
- Reports do not expose write tokens, secrets, or unnecessary absolute paths.
- Resume commands are copyable text, never automatically executed.
- Connector access is least-privilege; retained data is minimized and provenance remains visible.
- Derived labels must not claim completion, blockage, or review need without a documented source signal.

## Out of Scope

This PRD does not authorize a database migration, new runtime command, connector implementation, launcher, GUI redesign, scheduling, export, or correction UI. Those are separately reviewable vertical slices.

## Further Notes

Existing `StateResponse` and `StateCard` demonstrate the intended public-core pattern but are query-centric. The report should reuse workstream and evidence semantics rather than overload a state card into a time-window aggregate. Compatibility guarantees should initially cover the explicit versioned JSON schema, not incidental human formatting.
