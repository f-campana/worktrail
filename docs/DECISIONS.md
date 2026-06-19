# Worktrail V0 Decisions

## Product Name

Working name: **Worktrail**

This is provisional. Do not spend implementation time on naming, branding, or logo work during V0.

## Product Thesis

Worktrail is a local-first workstream memory layer for AI-assisted development.

The user should never need to browse agent thread sidebars to recover context. They should be able to type what they remember about a project, feature, bug, file, or decision and get back where work happened, what the latest state is, where things were left, and what evidence supports the answer.

## Core Promise

**No more thread archaeology.**

User action:

```txt
Type what you remember.
```

System output:

```txt
Best matching work
Current state
Where things were left
Evidence
Related repo/files/branches when available
```

## V0 Goal

Build a local-first prototype that can index local Codex sessions, persist normalized session data into SQLite, search across indexed work, and return an evidence-backed state card.

The first successful demo should be:

```txt
User opens Worktrail.
User indexes local Codex sessions.
User searches “resume ShipReady safe apply GUI”.
Worktrail returns the best matching thread/work item, last activity, likely repo, current state, where things were left, and evidence snippets.
```

## V0 Scope

V0 includes:

- Local-first app
- Codex-first source adapter
- Adapter-based architecture for future tools
- SQLite persistence
- Full-text search
- Basic ranking
- Evidence-backed state cards
- Source/indexing status screen
- Basic redaction utility
- Manual correction data model
- Minimal manual correction UI if cheap to include
- Tests for parsing, indexing, search, ranking, evidence, and redaction

## V0 Sources

Initial sources:

- Local Codex session/thread history
- Local repo path / working directory metadata when available
- Local git context only if it is cheap and safe to include during the first slice

Future sources should be supported architecturally but not implemented in V0:

- Claude Code
- Cursor
- Windsurf
- Aider
- Cline
- GitHub PRs/issues
- Notion
- Obsidian
- Linear

## Core Object: Workstream

A **workstream** is a durable piece of work that may span multiple agent sessions, repos, branches, commits, PRs, files, and notes.

Examples:

- ShipReady safe apply GUI
- Fodmapp mobile prototype
- fabien-campana.dev content engine
- Codex Control Tower research
- Jade Stockroom V1 scope

The product is workstream-first, not thread-first.

Threads are evidence attached to workstreams. Threads should not be the primary information architecture.

## UX Direction

Primary interface:

```txt
Ask where work happened…
```

Example queries:

```txt
Resume ShipReady safe apply GUI
Where did we implement sitemap.ts?
What happened last on Fodmapp mobile?
Show latest work on Codex Control Tower
Which thread handled invalid URL validation?
```

The app should return a strong answer, not a raw list of matching conversations.

A good state card includes:

- Best match
- Confidence
- Source tool
- Last activity
- Repo path if known
- Likely project/workstream
- Current state
- Where things were left
- Evidence snippets
- Related files if detected
- Alternate matches when confidence is not high

## Explicit Non-Goals for V0

Do not build:

- Visual graph
- Next-prompt generation
- Autonomous continuation
- Agent orchestration
- Team features
- Cloud sync
- SaaS backend
- Public plugin packaging
- Multi-user permissions
- Complex analytics
- Full semantic/vector pipeline unless clearly needed
- Non-Codex adapters
- Full GitHub integration
- Notion/Obsidian integration

## Architecture Decisions

Use an adapter-based architecture.

The first adapter is Codex, but the core product must not be Codex-specific.

Expected shape:

```txt
SourceAdapter
  discover()
  ingest()
  normalize()
```

Canonical entities should be separate from source-specific parsing.

Suggested entities:

- Source
- SourceThread
- SourceTurn
- Repo
- Workstream
- WorkstreamAssignment
- Evidence
- Summary
- ManualCorrection
- IndexedFileReference

## Storage Decision

Use SQLite for local persistence.

Use SQLite full-text search for V0 search.

Avoid introducing infrastructure that requires a hosted backend.

## Privacy Decision

Worktrail is local-first by default.

V0 should not upload transcripts, summaries, repo data, or search queries to a remote backend.

Include a basic redaction utility for common secret-looking patterns. This is not a full security guarantee, but it should prevent casual exposure of obvious tokens, keys, and credentials.

## Evidence Decision

Trustworthiness is a core product requirement.

Every displayed state summary should be grounded in evidence when possible.

Evidence can include:

- Thread excerpt
- Turn timestamp
- Source file/session reference
- Repo path
- File path
- Command output
- Git branch
- Git commit
- Manual correction

If a summary cannot be strongly supported, the UI should make confidence clear.

## Manual Correction Decision

State reconstruction will be imperfect.

The data model must support manual corrections from the start:

- Assign thread to workstream
- Rename workstream
- Ignore thread
- Mark source/thread as irrelevant
- Later: merge duplicate workstreams

Manual corrections should influence future search/ranking.

## Testing Decisions

Tests should target stable seams, not implementation details.

Primary seams:

1. Source adapter seam
   Can the adapter discover, parse, normalize, and tolerate malformed source data?

2. Ingestion/indexing seam
   Can normalized threads and turns be persisted, updated, deduplicated, and searched?

3. Search/ranking seam
   Can queries return expected work/thread candidates using fixtures?

4. State answer seam
   Can the app produce a useful state card with evidence?

5. Evidence seam
   Can displayed claims link back to source evidence?

6. Redaction seam
   Are common secret-looking values redacted before display or derived persistence?

7. Manual correction seam
   Do user corrections affect future results?

## Implementation Principle

Build a thin vertical slice before expanding.

Preferred order:

```txt
Discover source
Normalize
Persist
Index
Search
Show state card
Show evidence
Add correction
Then expand
```

Do not start with the visual graph.
Do not start with dashboards.
Do not start with multi-tool support.

## First Milestone

The first milestone is a source availability spike.

Questions to answer:

- Where are local Codex sessions stored on this machine?
- What file formats are present?
- What metadata can be reliably extracted?
- Can repo path / working directory be found?
- Can timestamps be found?
- Can thread/session IDs be found?
- Can turn content and tool calls be found?
- Are file references available?
- What must be treated as unstable?
- What sanitized fixtures can be created for tests?

Expected output:

```txt
docs/spikes/codex-source-availability.md
sanitized fixture sample if safe
recommended Codex adapter shape
risks and unknowns
```
