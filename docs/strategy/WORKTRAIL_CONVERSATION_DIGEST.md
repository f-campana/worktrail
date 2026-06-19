# Worktrail Strategy Digest

This is a curated strategy digest based on prior planning discussion and the current repository state. It is not a complete transcript.

## Original problem

AI-assisted work becomes fragmented across sessions. A user remembers a feature, bug, file, or decision but not the thread where it happened or the exact point where work stopped. Worktrail began by replacing thread archaeology with local, evidence-backed retrieval.

## Evolution of the idea

The first thesis was “local-first memory for AI coding threads.” Implementation and dogfooding sharpened two distinctions. First, the durable object is a workstream, while threads are source evidence. Second, fast retrieval and operational oversight are different jobs. The product thesis is now “local-first control tower for AI-assisted development”: track agent runs, workstreams, branches, pull requests, and issues so users can see what changed, what is blocked, and where to resume.

## What exists today

The repository implements a Codex local rollout adapter; streamed normalization; SQLite/FTS persistence; redaction and byte limits; title enrichment; canonical workstreams; aliases; reversible ignore; manual assignment; non-destructive CLI merge; explainable state cards; stable JSON state output; evaluation fixtures; and unit, golden-state, API, and browser tests.

The local React/Vite UI supports deep-linked search, recent workstreams, workstream details, status refresh, copied resume references, and evidence fetched only after explicit disclosure. Its Node server binds to loopback, is read-only by default, and exposes correction APIs only with `--allow-write` plus a per-process token returned by `/api/bootstrap`. Correction controls are not implemented in the UI.

## Major decisions

- Workstreams, not threads, are the canonical information architecture.
- Stored and displayed claims are evidence-backed and provenance-aware.
- Manual corrections override heuristic grouping and remain non-destructive where possible.
- Core domain results must be usable headlessly. CLI, launcher, API, and GUI are clients rather than owners of domain logic.
- Source-specific parsing stays behind adapters; reporting and presentation stay source-neutral.
- The product remains local-first, with bounded redacted persistence and explicit sensitive-evidence disclosure.

## Rejected or paused ideas

A visual graph, prompt generation, autonomous continuation, cloud sync, multi-user/team features, and non-Codex agent adapters remain out of scope. A search-centric GUI is no longer the primary direction. Correction UI is deferred until daily use proves which controls merit prominent placement. GitHub and Linear are future metadata sources, not immediate implementation commitments.

## Surface strategy

1. **CLI/core first:** fastest retrieval, scripting, and stable JSON contracts for terminal use, Codex, CI, and integrations.
2. **Command/launcher second:** a global-shortcut workflow to type remembered context, see the best result, copy `codex resume <SESSION_ID>`, and open local detail when needed.
3. **GUI third:** a Control Tower for daily reports, review queues, evidence inspection, corrections, and eventually cross-tool state.

The CLI or launcher answers “Where did we leave X?” The GUI answers “What happened while I was away, what needs review, what is blocked, and where should I resume?”

## Control Tower insight

The GUI becomes more valuable when organized around time and attention rather than another search box. Its central objects are a daily report and review queue composed from the same headless domain model used by other clients. Search remains useful as navigation, but it does not define the GUI.

## Self-reflection update: Fast Resume as adoption wedge (2026-06-19)

Dogfooding changed the next priority. Real reports contained many unassigned runs, no active canonical workstreams, resume references for every run, and no Git repositories resolved from indexed working directories. The report contract remained safe and useful, but a flat unassigned-run list did not create an actionable daily loop. More GUI presentation would expose the same missing primitive rather than fix it.

The adoption wedge is therefore fast resume: `worktrail resume <query>` should return ranked, stable `ResumableTarget` JSON suitable for terminal and launcher clients. A resumable target can be a canonical workstream, a provisional candidate workstream, or an individual run. It carries the best safe resume action, confidence, explainable signals, related files and runs, and alternates. `resume` names the user's job more precisely than generic `search`.

Workstreams should emerge primarily from source activity and links across Codex, Git, and later GitHub, Linear, and other agents. Users should not have to maintain Worktrail workstreams as a second source of truth. Candidate workstreams let Worktrail propose conservative groupings; corrections are feedback that stabilizes or rejects those inferences, not routine bookkeeping.

The surface order remains CLI/core, launcher, then GUI. CLI provides the fastest scriptable contract. A Raycast-style launcher can turn that contract into a global shortcut and copyable `codex resume <SESSION_ID>` action. The GUI remains important as the Control Tower for reports, review, evidence inspection, and correction, but it is not the primary retrieval surface and should not expand before the resumable-target contract is proven.

TypeScript remains the right implementation language for this phase: the work is still domain and product discovery around JSONL parsing, SQLite, CLI contracts, React/Vite, and future APIs. Rust may later suit a packaged local engine, indexing daemon, file watching, or demonstrated performance constraints. A rewrite now would delay learning without addressing the product gap.

## Daily report insight

The baseline report must require no model tokens. Indexed activity and connector metadata can deterministically establish time windows, changed workstreams, resume points, dirty repositories, commits, PR/check states, and issue states as those sources become available. Optional LLM summarization may improve prose later, but correctness and availability cannot depend on it.

## Privacy and local-first posture

Raw rollouts remain source of truth. Worktrail stores bounded, redacted searchable material and normalized metadata locally. It does not need cloud sync to provide its core value. Transcript-like evidence remains opt-in at presentation boundaries. Any future API connector must minimize requested scope, retain only necessary metadata, and preserve provenance and deletion boundaries.

## Open questions

- What deterministic rules constitute “needs review” or “blocked” without overstating source metadata?
- What is the canonical report time-zone and boundary behavior, especially across machines and daylight-saving changes?
- Which report fields deserve long-term compatibility guarantees for launcher and CI consumers?
- How should workstream-to-repository, PR, and issue links be established and corrected without fragile inference?
- Which GitHub and Linear authentication/storage approach satisfies the local-first threat model?
- After dogfooding, which corrections belong in the Control Tower rather than remaining CLI-only?

## Recommended next milestones

1. Specify and implement `worktrail resume <query>` and a stable `ResumableTarget` JSON contract over existing indexed data.
2. Dogfood ranking across canonical workstreams, conservative candidate workstreams, and unassigned runs using an evaluation corpus.
3. Spike a thin Raycast/launcher client that consumes the public contract and never executes resume commands.
4. Render the existing report model in a minimal Control Tower page.
5. Add correction UI and remote connector enrichment only after observed workflows justify them.
