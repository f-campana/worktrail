# Control Tower Vertical Slices

Each slice is independently demoable and should ship as a focused change. Fast Resume is the adoption wedge; the GUI remains the Control Tower for sustained review. Future connectors enrich these contracts but are not prerequisites for retrieval.

## 1. Existing-data daily report — done

**Outcome:** A deterministic, no-token report returns active canonical workstreams and unassigned runs for an explicit window without evidence excerpts.

## 2. Stable `worktrail report --since` contract — done

**Outcome:** Human output and versioned JSON make the report scriptable, with explicit boundaries, deterministic ordering, and safe resume references.

## 3. Read-only local Git signals — done

**Outcome:** Reports are optionally enriched from indexed working directories using bounded, argument-safe local Git reads. Missing repositories degrade to diagnostics.

## 4. Fast Resume CLI and `ResumableTarget` JSON contract

**Goal:** Turn remembered context and unassigned runs into ranked, actionable resume choices.

**Behavior:** `worktrail resume <query>` returns the best canonical workstream, conservative candidate workstream, or run. Human output includes a copyable `codex resume <SESSION_ID>` command; versioned JSON exposes confidence, signals, related runs/files, actions, and alternates.

**Tests and acceptance:** Use an evaluation corpus for ordering, ambiguity, over-grouping negatives, ignored records, escaping, privacy, and no execution/network behavior. Candidate grouping remains provisional and the contract is suitable for a thin launcher. No schema, adapter, model, or GUI dependency is required by default.

## 5. Raycast/launcher spike over `ResumableTarget`

**Goal:** Validate the global-shortcut retrieval loop without duplicating domain logic.

**Behavior:** Type remembered context, select a ranked target, copy its resume command or ID, and optionally open declared detail.

**Tests and acceptance:** Cover contract fixtures, no-result/error states, safe copying, and no automatic execution. The launcher contains no ranking, grouping, connector, or mutation logic.

## 6. GUI Daily Report page

**Goal:** Advance the GUI's Control Tower role using the existing headless report model.

**Behavior:** A read-only local route shows the report window, activity groups, resume actions, empty/error states, and detail drill-down. It supports daily review rather than replacing fast retrieval.

**Tests and acceptance:** Verify API parity, browser rendering, keyboard navigation, deep links, and opt-in evidence. The GUI renders core ordering and requests no transcript content initially.

## 7. Triage/correction UI for unassigned runs and candidate workstreams

**Goal:** Let demonstrated corrections teach Worktrail without requiring users to maintain a second source of truth.

**Behavior:** Users can confirm, reject, assign, ignore, or reverse only high-frequency candidate/run corrections validated through dogfooding.

**Tests and acceptance:** Reuse capability-gated APIs and audit semantics; preserve loopback-only, read-only-by-default, same-origin, token, conflict, persistence, and accessibility protections. Add no UI-owned organization state.

## 8. GitHub PR/check metadata adapter

**Goal:** Add actionable delivery signals after local retrieval works.

**Behavior:** Linked results and reports can show bounded PR state, check summary, freshness, and source links.

**Tests and acceptance:** Use least privilege, isolated normalization, recorded fixtures, bounded caching, redacted diagnostics, and graceful failure. GitHub types do not escape the adapter or break local results.

## 9. Workstream ↔ PR linking

**Goal:** Make PR association evidence-backed, explicit, and correctable.

**Behavior:** A user can accept, link, unlink, or correct an association; suggestions remain visibly non-canonical until accepted.

**Tests and acceptance:** After separate schema review, cover idempotency, relinking, redirects, unknown IDs, and propagation. Links remain reversible and deterministically control enrichment.

## 10. Linear issue metadata adapter

**Goal:** Test issue metadata using established connector and entity-link boundaries.

**Behavior:** A linked result can show issue identifier, title, state, assignee when available, freshness, and source link.

**Tests and acceptance:** Cover missing issues, permissions, stale data, and local fallback. Linear data remains optional and source-neutral.

## 11. Report scheduling/export

**Goal:** Deliver deterministic reports at a useful local cadence without cloud infrastructure.

**Behavior:** Users explicitly configure, inspect, and remove local generation/export with visible last-run status.

**Tests and acceptance:** Cover idempotency, time zones/DST, missed runs, atomic export, permissions, and transcript-free errors. Disabling removes Worktrail-owned scheduling state cleanly.
