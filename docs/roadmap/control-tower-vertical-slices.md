# Control Tower Vertical Slices

Each slice is independently demoable and should ship as a focused change. Later slices depend on lessons and contracts from earlier ones; naming a connector here is not authorization to implement it in this documentation task.

## 1. Existing-data daily report

**Goal:** Prove useful daily orientation using only indexed Worktrail/Codex data.

**User-visible behavior:** Given a fixed time window, return active workstreams and unassigned runs with latest activity and resume references; ignored runs are absent.

**Data/source changes:** Read existing tables only. Add no adapter or schema change.

**CLI/API/UI impact:** Public headless report builder only, exercised by a small development harness or tests; no new product command yet.

**Tests:** Fixed clock/time-zone boundaries, empty report, manual and candidate organization, merge redirect, ignored runs, deterministic ordering, evidence omitted from baseline.

**Out of scope:** Git signals, generated prose, GUI, scheduling, persistence of reports.

**Acceptance criteria:** The same database, window, and clock produce byte-equivalent structured output; every item has source IDs and a resume reference where available; no token/network use occurs.

## 2. Stable `worktrail report --since` contract

**Goal:** Make the report a scriptable product capability.

**User-visible behavior:** `worktrail report --since <ISO>` prints concise human output; `--json` returns a documented, versioned contract with explicit window metadata.

**Data/source changes:** None beyond slice 1.

**CLI/API/UI impact:** Add CLI parsing and serialization over the public report builder; no report logic in `cli.ts`.

**Tests:** CLI success/error behavior, ISO validation, golden JSON, human smoke output, exit status, no evidence leakage.

**Out of scope:** HTTP endpoint, launcher, aliases for flags, scheduled execution.

**Acceptance criteria:** Output is stable for fixtures; invalid time input fails clearly; JSON includes a schema version; existing commands remain unchanged.

## 3. Local Git signal for one linked workstream

**Goal:** Demonstrate source-neutral report enrichment with local repository facts.

**User-visible behavior:** One linked workstream shows current branch, commits in the window, and dirty/clean state with collection time.

**Data/source changes:** Add an isolated local Git adapter and an explicit, minimal workstream-repository link mechanism. Normalize command output; do not parse Git in report code.

**CLI/API/UI impact:** Report human/JSON output gains optional versioned Git facts.

**Tests:** Temporary repositories covering clean/dirty, detached HEAD, no commits, renamed paths, command failure, and repositories outside configured scope.

**Out of scope:** Watching repositories, remote status, GitHub, automatic multi-repo inference.

**Acceptance criteria:** The report remains usable when Git collection fails; adapter errors are bounded and attributable; one fixture workstream demonstrates the complete path.

## 4. GUI Daily Report page

**Goal:** Validate the GUI's Control Tower role using the headless model.

**User-visible behavior:** A local route shows the report window, activity groups, resume actions, empty/error states, and drill-down to existing workstream detail.

**Data/source changes:** None; use a read-only report endpoint backed by the core builder.

**CLI/API/UI impact:** Add versioned HTTP serialization and one React route. Keep existing search/detail routes.

**Tests:** API parity, browser rendering, deep link/history, loading/error/empty states, keyboard navigation, evidence remains opt-in.

**Out of scope:** Correction controls, charts, generated narrative, broad visual redesign.

**Acceptance criteria:** Browser fixtures render the same items and ordering as core JSON; no component reads connector-specific shapes; no transcript request occurs on initial load.

## 5. GitHub PR/check status for one workstream

**Goal:** Show actionable delivery state without building a general GitHub dashboard.

**User-visible behavior:** A linked workstream report item shows one PR's state and latest check summary, timestamp, and source link.

**Data/source changes:** Add a least-privilege GitHub metadata adapter and bounded cache/refresh policy reviewed separately.

**CLI/API/UI impact:** Optional PR/check facts appear consistently in report JSON, human CLI, and GUI detail.

**Tests:** Recorded contract fixtures for open/merged/closed PRs, pending/failing/passing checks, missing permissions, rate limits, stale cache, and redacted diagnostics.

**Out of scope:** PR creation, review submission, comments, repository-wide dashboard.

**Acceptance criteria:** One linked workstream demonstrates end to end; auth or network failure does not suppress local report facts; source freshness is visible.

## 6. Workstream-to-PR linking

**Goal:** Make PR association explicit and correctable.

**User-visible behavior:** A user can link/unlink a PR to a workstream and subsequent reports use that association; any suggestion is visibly non-canonical until accepted.

**Data/source changes:** Add the smallest auditable link representation and correction history required by the accepted design.

**CLI/API/UI impact:** CLI-first mutation and read contract; GUI may display the link but does not need editing controls.

**Tests:** Idempotency, relinking, merge redirect behavior, unknown identifiers, authorization, and report propagation.

**Out of scope:** Bulk inference, automatic mutation, linking issues.

**Acceptance criteria:** A link survives reindex/refresh, is reversible, and deterministically controls which PR facts appear for the workstream.

## 7. Linear issue state for one linked workstream

**Goal:** Test whether issue state adds useful planning context to the same report model.

**User-visible behavior:** One workstream shows a linked Linear issue's identifier, title, state, assignee when available, and freshness.

**Data/source changes:** Add isolated Linear metadata normalization and an explicit link using the connector boundary established by GitHub.

**CLI/API/UI impact:** Optional issue facts in core JSON, CLI, and GUI report item.

**Tests:** API contract fixtures, missing/deleted issues, permission failure, state changes, stale data, and local report fallback.

**Out of scope:** Issue mutation, projects/cycles dashboard, automatic synchronization.

**Acceptance criteria:** One linked issue renders end to end without Linear types escaping the adapter; unavailable Linear data cannot break Codex/Git reporting.

## 8. Raycast command spike

**Goal:** Validate the keyboard-first retrieval surface before committing to packaging.

**User-visible behavior:** Type remembered text, see the top workstream/run, copy a Codex resume command, or open its local GUI detail.

**Data/source changes:** None; consume stable CLI JSON or a documented local API.

**CLI/API/UI impact:** Thin spike only; any missing core behavior is fixed in core rather than duplicated.

**Tests:** Contract fixture, escaping of copied commands, no-result/error state, local server unavailable behavior, and no automatic execution.

**Out of scope:** Marketplace publication, background indexing, report browsing, mutations.

**Acceptance criteria:** The spike completes the lookup-to-copy flow using public contracts and contains no ranking or connector logic.

## 9. Report scheduling and export

**Goal:** Deliver the deterministic report at a useful cadence without adding cloud infrastructure.

**User-visible behavior:** A user can explicitly configure local generation and export to a documented local format, with visible last-run status.

**Data/source changes:** Store minimal local schedule/export configuration and generated artifact metadata only if required.

**CLI/API/UI impact:** Explicit setup/status/remove operations over an OS-appropriate scheduling boundary; exporter consumes the same report model.

**Tests:** Idempotent setup/removal, time-zone/DST cases, missed run, atomic export, permissions, and no-token/network baseline.

**Out of scope:** Hosted scheduler, email/Slack delivery, automatic connector credential setup.

**Acceptance criteria:** A scheduled fixture report is reproducible and locally inspectable; disabling removes Worktrail-owned scheduling state cleanly; failures are reported without transcript content.

## 10. Correction UI, if dogfooding warrants it

**Goal:** Put only demonstrated high-frequency corrections into the Control Tower.

**User-visible behavior:** Users can perform the selected correction with confirmation, see its effect immediately, and reverse it when the domain operation supports reversal.

**Data/source changes:** Reuse existing correction functions/APIs or separately accepted link corrections; add no duplicate UI-owned state.

**CLI/API/UI impact:** React controls consume capability-gated APIs; server remains loopback-only, read-only by default, same-origin checked, and token protected.

**Tests:** Browser happy/error/conflict paths, disabled mode, invalid/missing token, refresh persistence, keyboard accessibility, and unchanged evidence policy.

**Out of scope:** Implementing every CLI correction, enabling writes by default, redesigning correction semantics.

**Acceptance criteria:** Dogfooding evidence identifies the chosen workflow; all write-safety invariants remain covered; report and CLI reflect the correction through shared core state.
