# ADR 0002: CLI, launcher, and GUI surface strategy

## Status

Accepted

## Context

Fast retrieval, keyboard-driven orientation, and sustained oversight are distinct jobs. Treating the GUI as the primary retrieval surface duplicates core behavior and adds interaction cost for the common “where did we leave this?” question.

## Decision

Prioritize surfaces in this order:

1. CLI/core interfaces with stable, versioned JSON results.
2. A Raycast/Alfred-style launcher as a thin power-user client for retrieval, copying resume commands, and opening detail.
3. A local GUI for reports, review, evidence, and corrections.

All surfaces consume source-neutral core contracts. No domain ranking or report policy belongs exclusively to a launcher or GUI.

## Consequences

- CLI contracts require compatibility discipline and behavior tests.
- Launchers can remain thin and replaceable.
- GUI work can optimize for attention management rather than duplicating terminal retrieval.
- Presentation needs may expose gaps in core contracts before UI implementation proceeds.

## Alternatives considered

- **GUI-first retrieval:** rejected as the primary strategy because it is slower to invoke and less composable.
- **CLI only:** rejected because review and cross-source orientation benefit from persistent visual space.
- **Independent logic per surface:** rejected because results would drift and testing costs would multiply.
