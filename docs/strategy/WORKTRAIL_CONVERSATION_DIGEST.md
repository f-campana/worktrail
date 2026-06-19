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

1. Specify and implement a deterministic, headless report from existing indexed Codex/workstream data.
2. expose the report through a versioned CLI JSON contract and dogfood its usefulness.
3. Add one local Git tracer slice to test source-neutral report composition.
4. Render that same report model in a minimal Control Tower page.
5. Validate one end-to-end GitHub PR/check slice before expanding connector scope.
