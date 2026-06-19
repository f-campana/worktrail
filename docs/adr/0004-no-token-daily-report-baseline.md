# ADR 0004: No-token daily report baseline

## Status

Accepted

## Context

A daily report must be dependable, private, fast, and available without model credentials or usage cost. Indexed records and source metadata already support useful factual reporting; generated prose can obscure uncertainty if treated as the source of truth.

## Decision

The baseline daily report is deterministic and no-token. A headless engine composes time-bounded facts from indexed Worktrail data and future connector metadata into a versioned model. Ordering, classification, and inclusion rules are testable and explainable. Optional LLM summarization may later transform that model for presentation, but it cannot add unsupported facts or be required for report generation.

## Consequences

- The report works offline for local sources and is reproducible for a fixed dataset and clock.
- Tests can use injected time, fixtures, and public report interfaces.
- Initial prose may be less fluent, and deterministic blocker/review semantics must remain conservative.
- Optional summaries need a distinct privacy and evidence contract.

## Alternatives considered

- **LLM-generated report as baseline:** rejected due to cost, privacy, nondeterminism, and unverifiable inference.
- **GUI-only aggregation:** rejected because launchers, CLI, scheduling, and tests need the same model.
- **Raw activity feed:** rejected because it does not organize attention or resume decisions.
