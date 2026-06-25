import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";

import { TEXT_LIMITS } from "../limits.js";
import { isObject, valueToText } from "../text.js";
import type {
  DiscoveredSource,
  DiscoveryOptions,
  EvidenceProvenance,
  NormalizedSourceEvent,
  SourceAdapter,
  SourceCursor,
  SourceThreadState,
  SourceThreadStateObservation,
  SourceThreadStateRequest,
  ThreadEnrichment,
} from "../types.js";

type CodexLocalAdapterOptions = {
  codexHome?: string;
  fixtureDir?: string;
  titleIndexPath?: string;
};

type ParserState = {
  sessionId?: string;
  currentTurnId?: string;
  recentMessages: Map<string, { line: number; timestampMs: number }>;
};

type PendingLine = {
  text: string;
  number: number;
};

const KNOWN_OUTER_RECORDS = new Set([
  "session_meta",
  "turn_context",
  "response_item",
  "event_msg",
  "compacted",
]);

const MESSAGE_ROLES = new Set(["user", "assistant", "system", "developer"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CodexLocalAdapter implements SourceAdapter {
  readonly id = "codex-local";

  private readonly codexHome: string;
  private readonly fixtureDir: string | undefined;
  private readonly titleIndexPath: string;

  constructor(options: CodexLocalAdapterOptions = {}) {
    this.codexHome = resolve(
      options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    );
    this.fixtureDir = options.fixtureDir
      ? resolve(options.fixtureDir)
      : undefined;
    this.titleIndexPath = resolve(
      options.titleIndexPath ??
        (this.fixtureDir
          ? join(this.fixtureDir, "session-index-sanitized.jsonl")
          : join(this.codexHome, "session_index.jsonl")),
    );
  }

  async *discover(
    options: DiscoveryOptions = {},
  ): AsyncIterable<DiscoveredSource> {
    const candidates = this.fixtureDir
      ? (await collectJsonl(this.fixtureDir)).filter((path) =>
          basename(path).startsWith("rollout-"),
        )
      : [
          ...(await collectJsonl(join(this.codexHome, "sessions"))),
          ...(await collectJsonl(join(this.codexHome, "archived_sessions"))),
        ];

    const sorted = candidates.sort();
    const sinceMs = options.since ? Date.parse(options.since) : undefined;
    let yielded = 0;

    for (const sourceUri of sorted) {
      let sourceStat;
      try {
        sourceStat = await stat(sourceUri);
      } catch {
        continue;
      }

      if (sinceMs !== undefined && sourceStat.mtimeMs < sinceMs) {
        continue;
      }

      const archived = this.fixtureDir
        ? basename(sourceUri).includes("legacy")
        : sourceUri.startsWith(join(this.codexHome, "archived_sessions"));
      const fingerprint = createHash("sha256")
        .update(
          `${this.id}\0${sourceUri}\0${sourceStat.size}\0${sourceStat.mtimeMs}`,
        )
        .digest("hex");
      const externalId = sessionIdFromFilename(sourceUri);

      yield {
        adapterId: this.id,
        sourceUri,
        ...(externalId ? { externalId } : {}),
        archived,
        sizeBytes: sourceStat.size,
        modifiedAt: sourceStat.mtime.toISOString(),
        fingerprint,
      };

      yielded += 1;
      if (options.maxSources !== undefined && yielded >= options.maxSources) {
        return;
      }
    }
  }

  async *read(
    source: DiscoveredSource,
    _cursor?: SourceCursor,
  ): AsyncIterable<NormalizedSourceEvent> {
    const trailingNewline = await hasTrailingNewline(source.sourceUri);
    const input = createReadStream(source.sourceUri, { encoding: "utf8" });
    const lines = createInterface({
      input,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    const state: ParserState = {
      ...(source.externalId ? { sessionId: source.externalId } : {}),
      recentMessages: new Map(),
    };

    let pending: PendingLine | undefined;
    let lineNumber = 0;

    for await (const line of lines) {
      lineNumber += 1;
      if (pending) {
        yield* this.parseLine(source, pending, false, state);
      }
      pending = { text: line, number: lineNumber };
    }

    if (pending) {
      yield* this.parseLine(source, pending, !trailingNewline, state);
    }
  }

  async enrich(externalIds: readonly string[]): Promise<ThreadEnrichment[]> {
    const wanted = new Set(externalIds);
    if (wanted.size === 0) return [];

    const newest = new Map<string, ThreadEnrichment>();
    let input;
    try {
      input = createReadStream(this.titleIndexPath, { encoding: "utf8" });
    } catch {
      return [];
    }

    input.on("error", () => undefined);
    const lines = createInterface({
      input,
      crlfDelay: Number.POSITIVE_INFINITY,
    });

    try {
      for await (const line of lines) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (!isObject(parsed)) continue;

        const externalId = stringValue(parsed.id);
        const title = stringValue(parsed.thread_name);
        const updatedAt = stringValue(parsed.updated_at);
        if (!externalId || !title || !updatedAt || !wanted.has(externalId))
          continue;

        const previous = newest.get(externalId);
        if (!previous?.updatedAt || updatedAt > previous.updatedAt) {
          newest.set(externalId, { externalId, title, updatedAt });
        }
      }
    } catch {
      return [...newest.values()];
    }

    return [...newest.values()];
  }

  checkThreadStates(
    requests: readonly SourceThreadStateRequest[],
    options: { clock?: () => Date } = {},
  ): SourceThreadStateObservation[] {
    const observedAt = (options.clock ?? (() => new Date()))().toISOString();
    let scannedIndex:
      | Map<string, Exclude<SourceThreadState, "missing" | "unknown">>
      | undefined;
    const scanState = (resumeRef: string): SourceThreadState => {
      if (!this.hasKnownStateLayout()) return "unknown";
      scannedIndex ??= this.scanThreadStateIndex();
      return scannedIndex.get(resumeRef) ?? "missing";
    };

    return requests.map((request) => ({
      sourceId: request.sourceId,
      resumeRef: request.resumeRef,
      state: this.threadState(request, scanState),
      observedAt,
      sourceTool: this.id,
    }));
  }

  private threadState(
    request: SourceThreadStateRequest,
    scanState: (resumeRef: string) => SourceThreadState,
  ): SourceThreadState {
    if (!UUID_PATTERN.test(request.resumeRef)) return "unknown";
    if (request.sourceTool && request.sourceTool !== this.id) return "unknown";

    if (request.sourceUri) {
      const sourceUri = resolve(request.sourceUri);
      const knownPath = this.knownSourcePath(sourceUri);
      if (!knownPath) return "unknown";

      const direct = existingPathState(sourceUri, knownPath);
      if (direct) return direct;

      for (const candidate of this.candidatePaths(sourceUri)) {
        const candidateKind = this.knownSourcePath(candidate);
        if (!candidateKind) continue;
        const state = existingPathState(candidate, candidateKind);
        if (state) return state;
      }
    }

    return scanState(request.resumeRef);
  }

  private candidatePaths(sourceUri: string): string[] {
    const filename = basename(sourceUri);
    const candidates = new Set<string>();
    const activeRoot = join(this.codexHome, "sessions");
    const archivedRoot = join(this.codexHome, "archived_sessions");
    const activeRelative = safeRelative(activeRoot, sourceUri);
    const archivedRelative = safeRelative(archivedRoot, sourceUri);
    const datePath = rolloutDatePath(filename);

    if (datePath) candidates.add(join(activeRoot, datePath, filename));
    if (activeRelative) candidates.add(join(archivedRoot, activeRelative));
    if (archivedRelative) candidates.add(join(activeRoot, archivedRelative));
    candidates.add(join(activeRoot, filename));
    candidates.add(join(archivedRoot, filename));

    return [...candidates];
  }

  private knownSourcePath(
    path: string,
  ): "active" | "archived" | "fixture" | undefined {
    const resolved = resolve(path);
    if (this.fixtureDir && pathIsInside(this.fixtureDir, resolved)) {
      return "fixture";
    }
    if (pathIsInside(join(this.codexHome, "sessions"), resolved)) {
      return "active";
    }
    if (pathIsInside(join(this.codexHome, "archived_sessions"), resolved)) {
      return "archived";
    }
    return undefined;
  }

  private hasKnownStateLayout(): boolean {
    return (
      Boolean(this.fixtureDir && existsSync(this.fixtureDir)) ||
      existsSync(join(this.codexHome, "sessions")) ||
      existsSync(join(this.codexHome, "archived_sessions"))
    );
  }

  private scanThreadStateIndex(): Map<
    string,
    Exclude<SourceThreadState, "missing" | "unknown">
  > {
    const states = new Map<
      string,
      Exclude<SourceThreadState, "missing" | "unknown">
    >();
    if (this.fixtureDir) {
      for (const path of collectJsonlSync(this.fixtureDir)) {
        const id = sessionIdFromFilename(path);
        if (id)
          states.set(
            id,
            basename(path).includes("legacy") ? "archived" : "active",
          );
      }
      return states;
    }

    for (const path of collectJsonlSync(join(this.codexHome, "sessions"))) {
      const id = sessionIdFromFilename(path);
      if (id) states.set(id, "active");
    }
    for (const path of collectJsonlSync(
      join(this.codexHome, "archived_sessions"),
    )) {
      const id = sessionIdFromFilename(path);
      if (id && !states.has(id)) states.set(id, "archived");
    }
    return states;
  }

  private *parseLine(
    source: DiscoveredSource,
    line: PendingLine,
    isPartialTrailingLine: boolean,
    state: ParserState,
  ): Iterable<NormalizedSourceEvent> {
    if (!line.text.trim()) return;

    let record: unknown;
    try {
      record = JSON.parse(line.text);
    } catch {
      yield diagnostic(
        source,
        state,
        line.number,
        isPartialTrailingLine ? "partial_trailing_line" : "malformed_json",
        isPartialTrailingLine
          ? "Ignored an incomplete trailing JSONL record."
          : "Ignored a malformed JSONL record.",
      );
      return;
    }

    if (!isObject(record)) {
      yield diagnostic(
        source,
        state,
        line.number,
        "malformed_json",
        "Ignored a non-object JSONL record.",
      );
      return;
    }

    const recordType = stringValue(record.type);
    const recordTimestamp = stringValue(record.timestamp) ?? source.modifiedAt;
    const payload = isObject(record.payload) ? record.payload : {};

    if (!recordType || !KNOWN_OUTER_RECORDS.has(recordType)) {
      yield diagnostic(
        source,
        state,
        line.number,
        "unknown_record",
        `Ignored unknown outer record type: ${recordType ?? "missing"}.`,
        recordTimestamp,
      );
      return;
    }

    const evidence: EvidenceProvenance = {
      sourceUri: source.sourceUri,
      recordLine: line.number,
      recordTimestamp,
      sourceRecordType: `${recordType}/${stringValue(payload.type) ?? "-"}`,
    };

    if (recordType === "session_meta") {
      const externalId = stringValue(payload.id) ?? source.externalId;
      if (!externalId) {
        yield diagnostic(
          source,
          state,
          line.number,
          "malformed_json",
          "Session metadata did not contain an ID.",
          recordTimestamp,
        );
        return;
      }

      state.sessionId = externalId;
      const cwd = stringValue(payload.cwd);
      const sourceSurface = stringValue(payload.source);
      const cliVersion = stringValue(payload.cli_version);

      yield {
        kind: "thread",
        externalId,
        occurredAt: recordTimestamp,
        startedAt: stringValue(payload.timestamp) ?? recordTimestamp,
        ...(cwd ? { cwd } : {}),
        resumeRef: externalId,
        archived: source.archived,
        ...(sourceSurface ? { sourceSurface } : {}),
        ...(cliVersion ? { cliVersion } : {}),
        evidence,
      };
      return;
    }

    const externalId = state.sessionId;
    if (recordType === "turn_context") {
      const turnId = stringValue(payload.turn_id);
      if (turnId) state.currentTurnId = turnId;
      yield {
        kind: "turn-start",
        ...(externalId ? { externalId } : {}),
        ...(turnId ? { turnId } : {}),
        occurredAt: recordTimestamp,
        evidence,
      };
      return;
    }

    if (recordType === "response_item") {
      yield* normalizeResponseItem(
        source,
        payload,
        evidence,
        state,
        recordTimestamp,
      );
      return;
    }

    if (recordType === "event_msg") {
      yield* normalizeEventMessage(
        source,
        payload,
        evidence,
        state,
        recordTimestamp,
      );
    }
  }
}

function* normalizeResponseItem(
  _source: DiscoveredSource,
  payload: Record<string, unknown>,
  evidence: EvidenceProvenance,
  state: ParserState,
  occurredAt: string,
): Iterable<NormalizedSourceEvent> {
  const payloadType = stringValue(payload.type);
  const common = commonEvent(state, occurredAt, evidence);

  if (payloadType === "message") {
    const role = stringValue(payload.role);
    if (!role || !MESSAGE_ROLES.has(role)) return;
    const text = valueToText(
      payload.content,
      TEXT_LIMITS.adapterExtraction,
    ).trim();
    if (
      !text ||
      isRecentMirror(state, role, text, evidence.recordLine, occurredAt)
    ) {
      return;
    }
    const phase = stringValue(payload.phase);
    yield {
      ...common,
      kind: "message",
      role: role as "user" | "assistant" | "system" | "developer",
      text,
      ...(phase ? { phase } : {}),
    };
    return;
  }

  if (payloadType === "function_call" || payloadType === "custom_tool_call") {
    const callId = stringValue(payload.call_id);
    const tool = stringValue(payload.name) ?? stringValue(payload.namespace);
    if (!callId || !tool) return;
    const inputValue = payload.arguments ?? payload.input;
    const inputText = valueToText(
      inputValue,
      TEXT_LIMITS.adapterExtraction,
    ).trim();
    yield {
      ...common,
      kind: "tool-call",
      callId,
      tool,
      ...(inputText ? { inputText } : {}),
    };
    return;
  }

  if (
    payloadType === "function_call_output" ||
    payloadType === "custom_tool_call_output" ||
    payloadType === "tool_search_output"
  ) {
    const callId = stringValue(payload.call_id);
    if (!callId) return;
    const outputText = valueToText(
      payload.output,
      TEXT_LIMITS.adapterExtraction,
    ).trim();
    const success = booleanValue(payload.success);
    yield {
      ...common,
      kind: "tool-result",
      callId,
      ...(outputText ? { outputText } : {}),
      ...(success !== undefined ? { success } : {}),
    };
  }
}

function* normalizeEventMessage(
  _source: DiscoveredSource,
  payload: Record<string, unknown>,
  evidence: EvidenceProvenance,
  state: ParserState,
  occurredAt: string,
): Iterable<NormalizedSourceEvent> {
  const payloadType = stringValue(payload.type);
  const common = commonEvent(state, occurredAt, evidence);

  if (payloadType === "user_message" || payloadType === "agent_message") {
    const role = payloadType === "user_message" ? "user" : "assistant";
    const text = stringValue(payload.message)?.trim();
    if (
      !text ||
      isRecentMirror(state, role, text, evidence.recordLine, occurredAt)
    ) {
      return;
    }
    yield { ...common, kind: "message", role, text };
    return;
  }

  if (payloadType === "task_started") {
    const turnId = stringValue(payload.turn_id);
    if (turnId) state.currentTurnId = turnId;
    yield {
      ...commonEvent(state, occurredAt, evidence),
      kind: "turn-start",
    };
    return;
  }

  if (payloadType === "task_complete") {
    const turnId = stringValue(payload.turn_id) ?? state.currentTurnId;
    yield {
      ...common,
      kind: "turn-end",
      ...(turnId ? { turnId } : {}),
    };
    return;
  }

  if (payloadType === "patch_apply_end" && isObject(payload.changes)) {
    const callId = stringValue(payload.call_id);
    for (const [path, rawChange] of Object.entries(payload.changes)) {
      const change = isObject(rawChange) ? rawChange : {};
      const changeType = stringValue(change.type);
      const text = valueToText(
        change.unified_diff ?? change.content,
        TEXT_LIMITS.adapterExtraction,
      ).trim();
      yield {
        ...common,
        kind: "file-change",
        path,
        ...(changeType ? { changeType } : {}),
        ...(text ? { text } : {}),
        ...(callId ? { callId } : {}),
      };
    }
  }
}

function commonEvent(
  state: ParserState,
  occurredAt: string,
  evidence: EvidenceProvenance,
): {
  externalId?: string;
  turnId?: string;
  occurredAt: string;
  evidence: EvidenceProvenance;
} {
  return {
    ...(state.sessionId ? { externalId: state.sessionId } : {}),
    ...(state.currentTurnId ? { turnId: state.currentTurnId } : {}),
    occurredAt,
    evidence,
  };
}

function isRecentMirror(
  state: ParserState,
  role: string,
  text: string,
  line: number,
  timestamp: string,
): boolean {
  const fingerprint = createHash("sha256")
    .update(`${role}\0${text.trim()}`)
    .digest("hex");
  const timestampMs = Date.parse(timestamp);
  const previous = state.recentMessages.get(fingerprint);
  state.recentMessages.set(fingerprint, {
    line,
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
  });

  for (const [key, value] of state.recentMessages) {
    if (line - value.line > 20) state.recentMessages.delete(key);
  }

  if (!previous || line - previous.line > 5) return false;
  if (!previous.timestampMs || !timestampMs) return true;
  return Math.abs(timestampMs - previous.timestampMs) <= 10_000;
}

function diagnostic(
  source: DiscoveredSource,
  state: ParserState,
  line: number,
  code: "malformed_json" | "partial_trailing_line" | "unknown_record",
  detail: string,
  timestamp = source.modifiedAt,
): NormalizedSourceEvent {
  return {
    kind: "diagnostic",
    ...(state.sessionId ? { externalId: state.sessionId } : {}),
    occurredAt: timestamp,
    code,
    detail,
    evidence: {
      sourceUri: source.sourceUri,
      recordLine: line,
      recordTimestamp: timestamp,
      sourceRecordType: "diagnostic",
    },
  };
}

async function collectJsonl(root: string): Promise<string[]> {
  const output: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await collectJsonl(path)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      output.push(path);
    }
  }
  return output;
}

function collectJsonlSync(root: string): string[] {
  const output: string[] = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...collectJsonlSync(path));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      output.push(path);
    }
  }
  return output;
}

async function hasTrailingNewline(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "r");
    const sourceStat = await handle.stat();
    if (sourceStat.size === 0) return true;
    const buffer = Buffer.alloc(1);
    await handle.read(buffer, 0, 1, sourceStat.size - 1);
    return buffer[0] === 10;
  } catch {
    return true;
  } finally {
    await handle?.close();
  }
}

function sessionIdFromFilename(path: string): string | undefined {
  return basename(path).match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i,
  )?.[1];
}

function existingPathState(
  path: string,
  kind: "active" | "archived" | "fixture",
): SourceThreadState | undefined {
  try {
    if (!statSync(path).isFile()) return undefined;
  } catch {
    return undefined;
  }
  if (kind === "fixture") {
    return basename(path).includes("legacy") ? "archived" : "active";
  }
  return kind;
}

function safeRelative(root: string, path: string): string | undefined {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (!pathIsInside(resolvedRoot, resolvedPath)) return undefined;
  return relative(resolvedRoot, resolvedPath);
}

function pathIsInside(root: string, path: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  return (
    resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}/`)
  );
}

function rolloutDatePath(filename: string): string | undefined {
  const match = filename.match(/^rollout-(\d{4})-(\d{2})-(\d{2})T/u);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return year && month && day ? join(year, month, day) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
