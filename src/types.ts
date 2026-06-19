export type SourceCursor = {
  fingerprint: string;
  byteOffset?: number;
  line?: number;
};

export type DiscoveryOptions = {
  since?: string;
  maxSources?: number;
};

export type DiscoveredSource = {
  adapterId: string;
  sourceUri: string;
  externalId?: string;
  archived: boolean;
  sizeBytes: number;
  modifiedAt: string;
  fingerprint: string;
  cursor?: SourceCursor;
};

export type EvidenceProvenance = {
  sourceUri: string;
  recordLine: number;
  recordTimestamp: string;
  sourceRecordType: string;
};

type EventBase = {
  externalId?: string;
  turnId?: string;
  occurredAt: string;
  evidence: EvidenceProvenance;
};

export type NormalizedSourceEvent =
  | (EventBase & {
      kind: "thread";
      externalId: string;
      startedAt: string;
      cwd?: string;
      resumeRef: string;
      archived: boolean;
      sourceSurface?: string;
      cliVersion?: string;
    })
  | (EventBase & {
      kind: "turn-start" | "turn-end";
    })
  | (EventBase & {
      kind: "message";
      role: "user" | "assistant" | "system" | "developer";
      text: string;
      phase?: string;
    })
  | (EventBase & {
      kind: "tool-call";
      callId: string;
      tool: string;
      inputText?: string;
    })
  | (EventBase & {
      kind: "tool-result";
      callId: string;
      outputText?: string;
      success?: boolean;
    })
  | (EventBase & {
      kind: "file-change";
      path: string;
      changeType?: string;
      text?: string;
      callId?: string;
    })
  | (EventBase & {
      kind: "diagnostic";
      code: "malformed_json" | "partial_trailing_line" | "unknown_record";
      detail: string;
    });

export type ThreadEnrichment = {
  externalId: string;
  title?: string;
  updatedAt?: string;
  archived?: boolean;
};

export interface SourceAdapter {
  readonly id: string;
  discover(options?: DiscoveryOptions): AsyncIterable<DiscoveredSource>;
  read(
    source: DiscoveredSource,
    cursor?: SourceCursor,
  ): AsyncIterable<NormalizedSourceEvent>;
  enrich?(externalIds: readonly string[]): Promise<ThreadEnrichment[]>;
}

export type IndexStats = {
  runId: number;
  discoveredSources: number;
  indexedSources: number;
  skippedSources: number;
  threads: number;
  events: number;
  messages: number;
  toolCalls: number;
  toolResults: number;
  fileChanges: number;
  titleEnrichments: number;
  malformedLines: number;
  partialLines: number;
  unknownRecords: number;
  diagnostics: number;
};
