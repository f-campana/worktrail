# Codex Source Availability Spike

Date: 2026-06-18
Status: Complete for the first local-machine spike
Decision context: [`docs/DECISIONS.md`](../DECISIONS.md)

## Summary

Local Codex session data exists and is sufficient for a Codex-first Worktrail V0.
The best primary source is the append-only JSONL rollout data under
`~/.codex/sessions/` plus `~/.codex/archived_sessions/`. Each observed rollout
has a session UUID, timestamps, working directory, user and assistant content,
tool calls, tool results, and source provenance. The session UUID is compatible
with the locally installed `codex resume SESSION_ID` command according to its
CLI help.

Titles, archive state, Git metadata, and previews are available from internal
indexes and SQLite databases, but those stores have already changed shape and
location across Codex versions. They should be optional enrichment sources,
never the only copy of normalized Worktrail data.

Observed snapshot counts (the stores were live and changed during inspection):

- 420 active rollout files under `~/.codex/sessions/`.
- 644 rollout files under `~/.codex/archived_sessions/`.
- 1,282 title-index rows for 930 unique IDs in `session_index.jsonl`; repeated
  rows appear to represent title updates.
- 1,050 rows in the current root `state_5.sqlite` during one query; a second
  copy under `~/.codex/sqlite/` contained 1,063 rows and had an older mtime.

The architectural conclusion is to stream rollout JSONL as the source of truth,
normalize only recognized record variants, preserve provenance for evidence,
and enrich opportunistically from title/state stores.

## Locations Inspected

| Location | Shape | V0 recommendation |
| --- | --- | --- |
| `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | Active session rollouts, about 2 GB | Primary source; discover recursively and stream |
| `~/.codex/archived_sessions/rollout-*.jsonl` | Archived session rollouts, about 1.1 GB | Primary source; discover flat directory and mark archived |
| `~/.codex/session_index.jsonl` | `{id, thread_name, updated_at}` rows | Optional title enrichment; latest row per ID wins |
| `~/.codex/state_5.sqlite` | Internal thread index and metadata | Optional enrichment for title, archive state, Git, preview, and parent/child relations |
| `~/.codex/sqlite/state_5.sqlite` | Older or alternate copy of the state database | Do not assume canonical; only use through a versioned enrichment reader |
| `~/.codex/.codex-global-state.json` | Desktop UI state and sparse thread/workspace maps | Do not ingest in the first slice |
| `~/.codex/history.jsonl` | `{session_id, ts, text}` prompt history | Do not ingest; redundant and especially sensitive |
| `~/.codex/shell_snapshots/` | Per-session shell snapshots | Do not ingest; high secret/environment risk |
| `~/.codex/attachments/` | Pasted text and attachment metadata | Defer; ingest only after explicit attachment policy |
| `~/.codex/config.toml`, `~/.codex/auth.json` | Configuration and credentials | Presence only was checked; never ingest or fixture |
| `~/.codex/logs_2.sqlite`, goals, memories, plugin state | Operational/internal databases | Out of scope for the Codex session adapter |
| `~/Library/Application Support/Codex` and `~/Library/Application Support/com.openai.codex` | Desktop/browser application state | Presence only was checked; not required for V0 |

Other Codex-related application-support, preference, log, cache, worktree,
generated-image, and browser directories exist. They are not needed to recover
the core work history and add disproportionate privacy and compatibility risk.

## Source Shapes Found

### Rollout JSONL envelope

Every observed record is one JSON object with this outer shape:

```ts
type RolloutRecord = {
  timestamp: string; // ISO-8601 in observed files
  type: string;
  payload: Record<string, unknown>;
};
```

Every inspected rollout began with `type: "session_meta"`. Its consistently
useful payload fields were:

```ts
type SessionMeta = {
  id: string;
  timestamp: string;
  cwd: string;
  cli_version?: string;
  source?: string;
  originator?: string;
  model_provider?: string;
  git?: {
    commit_hash?: string;
    branch?: string;
    repository_url?: string;
  };
  thread_source?: unknown;
};
```

The filename also embeds the timestamp and UUID. All inspected first records
had a `payload.id` matching the filename UUID.

Observed top-level record kinds include `session_meta`, `turn_context`,
`response_item`, `event_msg`, and older `compacted` records. The adapter must
ignore unknown kinds without failing the whole session.

### Messages and turns

User, assistant, and developer messages are present as `response_item` records
whose payload `type` is `message`, with `role` and `content` blocks such as
`input_text`, `output_text`, and `input_image`. User and assistant text is also
duplicated in some `event_msg` records such as `user_message` and
`agent_message`.

For V0, `response_item/message` should be canonical when present. Event messages
should supply lifecycle metadata and act as a fallback, not create duplicate
turn text.

`turn_context` records expose per-turn UUIDs, timestamps indirectly through the
record envelope, current working directory, model, timezone, workspace roots,
and sometimes a compaction summary. The available fields differ by CLI version.

### Tool calls, outputs, errors, and changes

Tool activity is available in several variants:

- `response_item/function_call` with `name`, `call_id`, and JSON encoded in an
  `arguments` string.
- `response_item/custom_tool_call` with `name`, `call_id`, `input`, and status.
- matching `function_call_output` or `custom_tool_call_output` records.
- specialized records such as `web_search_call`, `tool_search_call`, and MCP
  calls.

Tool output is not type-stable. It was observed as both a plain string and an
array of content blocks. Command exit status and errors can be embedded in the
output string or exposed through structured events. A recent `patch_apply_end`
event contained `success`, `status`, `stdout`, `stderr`, and a `changes` object
keyed by absolute file path. Change values may contain full file content or a
unified diff.

There is no single stable, complete `changed_files` field. File references must
be assembled from structured patch/change events first, then tool arguments,
command output, and message text as lower-confidence evidence.

### Titles, summaries, and state indexes

Thread titles are not part of the core `session_meta` record. They are available
from:

- `session_index.jsonl` as `thread_name`, with multiple updates per ID.
- the `threads.title` column in `state_5.sqlite`.
- a sparse desktop global-state title map, which is unsuitable as a source of
  truth.

The current state database also exposes rollout path, created/updated times,
source, cwd, archive state, first user message, preview, Git SHA/branch/origin,
model metadata, and parent/child thread edges. Its schema is an internal Codex
implementation detail and two different local copies disagreed on row count.

Summaries exist in multiple unrelated forms: reasoning-summary arrays,
encrypted reasoning content, optional compaction strings in `turn_context`, and
thread previews in SQLite. None should be treated as a stable authoritative
"latest state" summary. Worktrail should derive its own evidence-backed state
and retain the source field/provenance used.

## Reliable Fields

Reliable means consistently available enough for V0 after tolerant parsing,
not a public compatibility guarantee from Codex.

| Field/concept | Confidence | Notes |
| --- | --- | --- |
| Session/thread UUID | High | `session_meta.payload.id`; matches rollout filename |
| Resume reference | High | UUID is accepted by local `codex resume` syntax; execution was not invoked |
| Record timestamp | High | ISO-8601 envelope timestamp on records |
| Session start timestamp | High | `session_meta.payload.timestamp` and filename |
| Working directory | High | `session_meta.cwd`; also repeated in turn contexts |
| User/assistant content | High | Message response items; content-block variants need parsing |
| Tool call identity and pairing | High | `call_id`, call name, and matching output are widely present |
| Rollout path and archive bucket | High | Derived during discovery, independent of payload schema |
| CLI version | Medium-high | Present in sampled session metadata and useful for parser routing |
| Turn UUID | Medium-high | Present in recent turn contexts/events; older records require grouping fallback |
| Title | Medium | Usually available from optional index/state enrichment, not rollout |
| Git metadata | Medium | Present in some session metadata or state rows, absent for many sessions |
| File changes | Medium-low | Structured for some patch flows; otherwise heuristic |

## Unreliable or Unstable Fields

- Payload schemas for `response_item`, `event_msg`, and `turn_context` vary by
  CLI version and product surface.
- Tool inputs may use `arguments` or `input`; tool outputs may be strings,
  objects, or arrays of content blocks.
- `source` and `thread_source` vary from simple strings to structured values;
  subagent metadata is particularly version-sensitive.
- Titles are mutable, duplicated in `session_index.jsonl`, and absent from the
  primary rollout.
- SQLite filenames, locations, migrations, columns, and backfill completeness
  are internal. They must be isolated behind an optional enricher.
- `cwd` is a launch directory, not necessarily the repository root. It may be a
  subdirectory, a Codex worktree, or a deleted path.
- Repository URL, branch, and SHA are snapshots and can be missing or stale.
- Compaction text, previews, and reasoning summaries do not share one meaning.
- Active JSONL files can be appended while read; the final line may be partial.
- Event text can duplicate response items. Naive ingestion will double-index
  messages.
- File references parsed from prose or command output are heuristic and may no
  longer exist.
- File counts and state-index counts may disagree because archival moves and
  backfills are not atomic from an external reader's perspective.

All Codex-specific parsing should live in versioned parser modules selected by
capability detection and optionally informed by `cli_version`. The canonical
model must not expose raw Codex payload shapes.

## Privacy and Redaction Notes

The rollout files must be treated as highly sensitive. They can contain full
prompts and responses, file content, patches, terminal commands and output,
environment details, usernames, absolute paths, remote URLs, error traces,
tokens, credentials, and pasted attachments.

V0 ingestion and display should apply these rules:

1. Never read or copy `auth.json`, credential stores, shell snapshots, or raw
   attachment bodies as part of normal session discovery.
2. Keep source processing local. Do not send raw transcript data to a remote
   service.
3. Redact secret-looking values before persistence into searchable/evidence
   text, not only at render time. Cover common API keys, bearer tokens, private
   keys, passwords, connection strings, credential-bearing URLs, cookies, and
   sensitive environment assignments.
4. Normalize home-directory paths to `~` or a stable local placeholder for
   display. Retain the original path only in a local restricted provenance field
   if opening the evidence requires it.
5. Store bounded evidence excerpts, hashes/fingerprints, record line numbers,
   and source paths rather than duplicating whole rollouts.
6. Treat command output, patches, diffs, and attachment-derived text as the
   highest-risk content classes. Apply size limits and allow users to exclude
   them.
7. Avoid logging parsed content or redaction failures. Log record identifiers,
   parser versions, counts, and error categories only.

Redaction is risk reduction, not a guarantee. The product should clearly state
that local indexed work history can still contain sensitive project data.

## Fixture Strategy

Safe fixtures are possible when they are synthetic rather than copied and
edited from private rollouts. The fixtures in `fixtures/codex/` use fabricated
UUIDs, paths, repo URLs, prompts, file content, commands, and outputs. They
preserve only observed structural variants:

- legacy function-call output represented as a string;
- current custom-tool output represented as content blocks;
- session metadata, turn context, message roles, call pairing, patch changes,
  and lifecycle events;
- duplicate title-index entries so latest-title selection can be tested.

Future fixtures should be minimized per parser behavior and reviewed with a
denylist scan for real home paths, email addresses, repository remotes, tokens,
and UUIDs copied from local state. Do not commit raw or mechanically redacted
production sessions.

No parser test was added in this spike because the workspace has no application
or test runtime yet. Adding a one-off harness would expand the scaffold beyond
the source-availability task. These fixtures are ready for the first adapter
parser tests.

## Recommended Codex Adapter Contract

The adapter should discover and normalize source evidence. Persistence,
workstream assignment, ranking, and state synthesis belong to the core and must
not be adapter responsibilities.

```ts
type SourceCursor = {
  fingerprint: string; // path + inode/size/mtime or content prefix hash
  byteOffset?: number;
  line?: number;
};

type DiscoveredSource = {
  adapterId: string;             // "codex-local"
  sourceUri: string;             // local rollout path
  externalId?: string;           // session UUID after cheap metadata read
  archived: boolean;
  sizeBytes: number;
  modifiedAt: string;
  cursor?: SourceCursor;
};

type NormalizedEvidence = {
  sourceUri: string;
  recordLine: number;
  recordTimestamp: string;
  sourceRecordType: string;
  excerpt?: string;              // already redacted and bounded
  rawHash?: string;
};

type NormalizedSourceEvent =
  | { kind: "thread"; externalId: string; startedAt: string; cwd?: string;
      resumeRef?: string; archived: boolean; metadata: Record<string, unknown> }
  | { kind: "turn-start" | "turn-end"; externalId: string; turnId?: string;
      occurredAt: string; evidence: NormalizedEvidence }
  | { kind: "message"; externalId: string; turnId?: string;
      role: "user" | "assistant" | "system" | "developer";
      text: string; phase?: string; evidence: NormalizedEvidence }
  | { kind: "tool-call"; externalId: string; turnId?: string; callId: string;
      tool: string; inputText?: string; evidence: NormalizedEvidence }
  | { kind: "tool-result"; externalId: string; turnId?: string; callId: string;
      outputText?: string; success?: boolean; evidence: NormalizedEvidence }
  | { kind: "file-change"; externalId: string; turnId?: string; path: string;
      changeType?: string; evidence: NormalizedEvidence };

type ThreadEnrichment = {
  externalId: string;
  title?: string;
  updatedAt?: string;
  archived?: boolean;
  git?: { sha?: string; branch?: string; remote?: string };
  parentExternalId?: string;
};

interface SourceAdapter {
  readonly id: string;
  discover(options?: { since?: string }): AsyncIterable<DiscoveredSource>;
  read(
    source: DiscoveredSource,
    cursor?: SourceCursor,
  ): AsyncIterable<NormalizedSourceEvent>;
  enrich?(externalIds: readonly string[]): Promise<ThreadEnrichment[]>;
}
```

Implementation requirements:

- Stream JSONL; do not load multi-megabyte or gigabyte stores into memory.
- Parse line-by-line and tolerate unknown records, malformed lines, truncation,
  and schema drift.
- Use the session UUID plus adapter ID as the stable external identity.
- Record parser version and source fingerprint for idempotent incremental
  re-indexing.
- Checkpoint only at complete newline boundaries for active files.
- Deduplicate message/event mirrors and call/result pairs during normalization.
- Run redaction and excerpt bounding before emitting searchable text.
- Keep SQLite/title readers in `CodexMetadataEnricher`, separate from the
  rollout parser, so a broken migration cannot block base ingestion.
- Preserve unknown record counts and parse warnings for diagnostics without
  persisting raw private payloads.

This refines the earlier `discover / ingest / normalize` sketch in the decision
record: `ingest` should be owned by the core indexing service, while the adapter
provides `discover / read / enrich` and emits canonical normalized events.

## Recommended First Vertical Slice After the Spike

Build a headless, local indexing slice before any substantial UI:

1. Implement recursive discovery for active and archived rollout JSONL.
2. Stream and normalize session metadata plus user/assistant message records.
3. Add tool call/result normalization and structured patch file references.
4. Apply redaction and persist sessions, messages, evidence provenance, and
   file references into SQLite with FTS.
5. Enrich titles from `session_index.jsonl`; add `state_5.sqlite` Git/archive
   enrichment only after the base path works.
6. Expose one local query command that returns the best matching source thread,
   last activity, cwd, resume UUID, and evidence excerpts.

The acceptance test should use only the synthetic fixtures first, then run a
local smoke import that reports counts and IDs without printing transcript
content. This demonstrates the core promise without building a visual graph,
prompt generation, continuation, sync, or non-Codex adapters.

## Risks, Unknowns, and Assumptions

- Codex local formats are not documented here as a public API. Compatibility is
  based on observation across local CLI versions from `0.108.0-alpha.12` through
  recent `0.138.0-alpha.7` rollouts and the installed `codex-cli 0.135.0`.
- The installed CLI help confirms UUID or thread-name resume syntax, but this
  spike did not execute `codex resume` because doing so would open or mutate a
  live session.
- It is unknown whether archived, forked, remote, non-interactive, or partially
  deleted sessions all resume identically.
- The retention and cleanup policies for active rollouts, archived rollouts,
  title indexes, and state databases are unknown.
- A session can move between active and archived directories during discovery.
  Ingestion must deduplicate by UUID and source fingerprint.
- Subagent and fork relationships are present in metadata/state edges but have
  changed representation. V0 should preserve optional parent IDs without making
  them part of workstream identity.
- Current state can only be inferred from evidence. Task-complete events mean a
  turn ended, not necessarily that the workstream is complete.
- Repository roots may need local Git resolution from an existing `cwd`; that
  should be a separate safe enrichment step with timeouts.
- Secret redaction cannot reliably classify all proprietary or personal data.
- Counts in this report are point-in-time diagnostics, not invariants.

## Open Questions

1. What exact Codex versions and source surfaces should V0 promise to support?
2. Should raw redacted message text be persisted, or should Worktrail retain
   only bounded evidence plus an FTS projection?
3. What maximum sizes should apply to tool output, patches, and per-session
   indexed text?
4. Should archived sessions be indexed by default or behind an explicit source
   option?
5. How should deleted or moved source files affect already normalized evidence?
6. Should title enrichment prefer the newest session-index row or the current
   state database when they disagree?
7. How should worktree paths be mapped back to a durable repository identity?
8. Which false-positive/false-negative tradeoff is acceptable for secret
   redaction and file-reference extraction?
