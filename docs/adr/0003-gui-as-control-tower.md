# ADR 0003: GUI as a Control Tower

## Status

Accepted

## Context

The existing GUI proves local search, detail, and evidence disclosure. The larger unsolved need is operational: understand activity while away, identify items needing review, recognize supported blockers, and choose a resume point across agent and delivery systems.

## Decision

Evolve the GUI into a local Control Tower centered on a daily report, review queue, workstream detail, evidence inspection, and warranted correction controls. Search remains navigation but is not the primary information architecture. GUI views render headless domain results; they do not query connector-specific storage or derive independent state.

## Consequences

- A source-neutral report and review model must precede substantial GUI expansion.
- “Blocked” and “needs review” require explicit, explainable rules.
- Future connector data can appear incrementally without reorganizing the UI around each tool.
- Existing retrieval routes remain useful and need not be removed.

## Alternatives considered

- **Keep a search-centric GUI:** paused because it does not answer the daily oversight problem.
- **Tool-specific dashboards:** rejected because they fragment a workstream across Codex, GitHub, and Linear.
- **Build all correction controls immediately:** deferred until report dogfooding identifies high-value correction workflows.
