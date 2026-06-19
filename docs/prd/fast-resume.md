# PRD: Fast Resume

## Problem Statement

Developers remember a feature, file, failure, or decision but not the Codex session where work stopped. Current search can find runs and state cards can group evidence, yet dogfood reports show that long lists of unassigned runs remain hard to act on. Requiring users to manually create and maintain workstreams would duplicate organization already present in source tools.

## Target Users

- Individual developers using many Codex sessions across concurrent work.
- Terminal-first users who need a resumable result in seconds.
- Launcher users who want global, keyboard-only retrieval.

## Solution

Add a task-oriented `worktrail resume <query>` capability that ranks resumable targets across canonical workstreams and unassigned runs. Candidate workstreams may be returned when existing evidence supports a conservative grouping, but the first implementation must avoid automatic over-grouping or canonical creation. Human output provides a copyable `codex resume <SESSION_ID>` command; stable JSON supports thin clients such as Raycast. Worktrail never executes the command.

## User Stories

- I can describe remembered work and receive the best session or workstream to resume.
- I can understand why a target ranked highly and how confident Worktrail is.
- I can copy a safe resume command without Worktrail launching Codex.
- I can inspect related runs, files, and alternates when the top result is uncertain.
- I can consume the same result as stable JSON from a launcher or script.

## Product Surfaces

- **CLI/core:** owns query, ranking, contract, human formatting, and JSON serialization.
- **Raycast/launcher:** later thin client for querying, selecting, and copying/opening declared actions.
- **GUI:** optional later detail destination; no GUI work is required for the first implementation.

## Proposed ResumableTarget Contract

```ts
type ResumableTarget = {
  kind: "canonical-workstream" | "candidate-workstream" | "run";
  title: string;
  resumeRef?: string;
  resumeCommand?: string;
  lastActivity: string;
  sourceTool?: string;
  confidence: "high" | "medium" | "low";
  score?: number;
  signals: Array<{
    type: string;
    label: string;
    sourceIds?: string[];
  }>;
  relatedFiles: string[];
  relatedRuns: Array<{
    sourceId: string;
    title?: string;
    resumeRef?: string;
    lastActivity: string;
  }>;
  openActions?: Array<{
    kind: "copy-command" | "copy-id" | "open-gui" | "open-external";
    label: string;
    value: string;
  }>;
};
```

The implementation design should wrap results in a versioned response containing the query, ordered targets, and explicit limitations. It should reuse existing `StateCard`, `SearchResult`, confidence, signal, file-normalization, and resume-reference semantics where compatible. Field optionality, identifiers, score stability, and action escaping must be resolved before declaring version 1 stable.

## Ranking / Signal Inputs

Initial ranking may use existing lexical relevance, canonical name and alias matches, manual assignments, run titles, working directories, file references, evidence-text matches, recency, and ignored-run exclusion. Candidate grouping may use strong shared titles, working directories, and meaningful file references, but weak coincidence must not merge unrelated runs. Future repo, GitHub, or Linear signals are enrichment, not dependencies.

Every target must expose concise, source-attributable reasons for its rank. Confidence is a product claim and requires calibrated fixtures rather than being inferred from score labels alone.

## CLI UX

```sh
worktrail resume "safe apply GUI"
worktrail resume "safe apply GUI" --json
```

Human output should lead with one target, its confidence and last activity, a copyable `codex resume <SESSION_ID>` command when the source supports it, followed by compact signals and alternates. Empty and ambiguous results must be explicit. Query parsing and output must safely handle shell-significant text. The command formats actions but never executes Codex.

## Raycast/Launcher Implications

The JSON contract must let a launcher render ordered targets and declared actions without reimplementing ranking, grouping, or source rules. The launcher may copy a command or ID and open an explicitly supplied URL. Automatic command execution is prohibited. Extension implementation and distribution are a later slice.

## Implementation Decisions

- Build one source-neutral, versioned response in core; CLI and later clients are renderers.
- Query canonical workstreams and unassigned runs together.
- Reuse current deterministic ranking primitives before adding new persistence.
- Keep candidate workstreams provisional and read-time only initially.
- Preserve corrections as higher-priority feedback.
- Require no model, network, adapter, schema, or GUI change for the baseline unless separately justified during implementation review.

## Testing Decisions

- Golden-test versioned JSON and deterministic ordering through public core interfaces.
- Cover canonical, candidate, run-only, ignored, merged, empty, ambiguous, archived, and missing-resume-reference cases.
- Maintain an evaluation corpus with expected top targets and acceptable alternates; include negative cases against over-grouping.
- Test human output, shell-safe command formatting, action values, limits, and exit behavior.
- Assert no transcript evidence appears by default and no process execution or network call occurs.

## Privacy/Safety Requirements

- Operate from bounded, redacted indexed data and local metadata.
- Make no LLM or network call in the baseline.
- Do not expose evidence excerpts, raw home paths, secrets, or credentials by default.
- Preserve provenance for ranking signals and make provisional grouping visible.
- Treat commands and open actions as inert data; never execute Codex automatically.
- Honor ignore and future retention/exclusion policies consistently.

## Non-Goals

- Raycast extension implementation.
- GUI changes.
- GitHub or Linear adapters.
- Semantic embeddings.
- Automatic workstream creation without evidence.
- Executing Codex.
- Cloud sync.

## Further Notes

Fast Resume is the adoption wedge, not a replacement for the Control Tower. The GUI remains the right surface for daily review, evidence inspection, and correction once retrieval and grouping contracts are useful. TypeScript remains appropriate while the team is discovering these domain contracts across SQLite, CLI, and React. Rust may be evaluated later for a packaged engine, daemon, file watching, or measured performance needs; this PRD does not propose a rewrite.
