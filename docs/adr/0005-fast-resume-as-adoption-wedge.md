# ADR 0005: Fast Resume as the adoption wedge

## Status

Accepted

## Context

The no-token daily report and local Git enrichment established safe, source-neutral contracts. Dogfooding then found many unassigned runs, no active canonical workstreams, resume references for every run, and no Git repositories resolved from real indexed working directories. A flat report of unassigned runs is factual but does not quickly answer which session should be resumed.

Users already leave useful identity and relationship signals in agent runs, files, repositories, branches, and future delivery tools. Requiring them to recreate that organization as manually maintained Worktrail records would make Worktrail a second source of truth. Corrections should instead provide feedback to conservative inference.

## Decision

Worktrail will prioritize a `worktrail resume <query>` command and stable `ResumableTarget` JSON contract before further GUI Control Tower expansion, because the daily adoption loop is instant recovery and resume rather than dashboard browsing.

The command will rank canonical workstreams and unassigned runs, with conservative candidate-workstream support. Results will expose confidence and supporting signals and may format copyable resume commands, but Worktrail will not automatically execute them. The contract will be source-neutral and suitable for a thin Raycast/launcher client. The GUI remains the Control Tower for reports, review, evidence, and corrections after the retrieval primitive is proven.

## Consequences

- `resume` becomes the task-oriented retrieval entry point; generic search remains a lower-level capability.
- A versioned result contract requires compatibility, ranking, privacy, and escaping tests.
- Candidate groupings must be visibly provisional and must not create canonical workstreams without evidence or correction.
- Manual corrections are treated as learning feedback, not required daily organization.
- Raycast can validate the keyboard-first loop without owning ranking logic.
- GUI Daily Report work is deferred, not abandoned.
- GitHub and Linear enrichment can improve later ranking but are not prerequisites.

## Alternatives considered

- **Continue with the GUI Daily Report page next:** deferred because it would present the same flat unassigned-run bottleneck without creating a faster resume loop.
- **Build a GitHub adapter next:** deferred because remote metadata adds signal volume and credential scope before existing local runs are actionable.
- **Build correction UI next:** deferred because asking users to curate workstreams first would institutionalize a second source of truth; correction workflows should follow observed inference failures.
- **Keep generic `search` as the main command:** rejected as the primary user contract because it describes the mechanism, while `resume` describes the job and can return richer resumable targets.
