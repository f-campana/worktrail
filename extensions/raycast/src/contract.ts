import {
  SUPPORTED_SCHEMA_VERSION,
  type RelatedRun,
  type ResumableTarget,
  type ResumeDiagnostic,
  type ResumeOpenAction,
  type ResumeSearchResult,
  type ResumeSignal,
  type TargetValidationResult,
} from "./types.js";

export class ResumeCompatibilityError extends Error {
  constructor(version: unknown) {
    super(
      `Unsupported Worktrail resume schema version ${String(version)}. This extension supports version ${SUPPORTED_SCHEMA_VERSION}.`,
    );
    this.name = "ResumeCompatibilityError";
  }
}

export class ResumeSchemaError extends Error {
  constructor(path: string, expectation: string) {
    super(`Invalid Worktrail resume response: ${path} ${expectation}.`);
    this.name = "ResumeSchemaError";
  }
}

export function parseResumeSearchResult(input: unknown): ResumeSearchResult {
  const value = record(input, "response");
  if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new ResumeCompatibilityError(value.schemaVersion);
  }

  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    query: string(value.query, "query"),
    generatedAt: string(value.generatedAt, "generatedAt"),
    limit: finiteNumber(value.limit, "limit"),
    targets: array(value.targets, "targets").map((target, index) =>
      parseTarget(target, `targets[${index}]`),
    ),
    diagnostics: array(value.diagnostics, "diagnostics").map(
      (diagnostic, index) =>
        parseDiagnostic(diagnostic, `diagnostics[${index}]`),
    ),
  };
}

export function parseTargetValidationResult(
  input: unknown,
): TargetValidationResult {
  const value = record(input, "response");
  if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new ResumeCompatibilityError(value.schemaVersion);
  }

  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    resumeRef: string(value.resumeRef, "resumeRef"),
    status: oneOf(
      value.status,
      ["openable", "archived", "missing", "unknown", "invalid"] as const,
      "status",
    ),
    ...optionalStringField(value, "openUrl", "response"),
    ...optionalStringField(value, "message", "response"),
  };
}

function parseTarget(input: unknown, path: string): ResumableTarget {
  const value = record(input, path);
  return {
    kind: oneOf(
      value.kind,
      ["canonical-workstream", "candidate-workstream", "run"] as const,
      `${path}.kind`,
    ),
    title: string(value.title, `${path}.title`),
    ...optionalStringField(value, "subtitle", path),
    ...optionalStringField(value, "resumeRef", path),
    ...optionalStringField(value, "resumeCommand", path),
    ...(value.command === undefined
      ? {}
      : { command: parseCommand(value.command, `${path}.command`) }),
    lastActivity: string(value.lastActivity, `${path}.lastActivity`),
    ...optionalStringField(value, "sourceTool", path),
    ...optionalBooleanField(value, "archived", path),
    confidence: oneOf(
      value.confidence,
      ["high", "medium", "low"] as const,
      `${path}.confidence`,
    ),
    score: finiteNumber(value.score, `${path}.score`),
    scoreVersion: oneOf(
      value.scoreVersion,
      [1, 2, 3] as const,
      `${path}.scoreVersion`,
    ),
    signals: array(value.signals, `${path}.signals`).map((signal, index) =>
      parseSignal(signal, `${path}.signals[${index}]`),
    ),
    relatedFiles: stringArray(value.relatedFiles, `${path}.relatedFiles`),
    relatedRuns: array(value.relatedRuns, `${path}.relatedRuns`).map(
      (run, index) => parseRelatedRun(run, `${path}.relatedRuns[${index}]`),
    ),
    openActions: array(value.openActions, `${path}.openActions`).map(
      (action, index) =>
        parseOpenAction(action, `${path}.openActions[${index}]`),
    ),
    evidenceAvailable: boolean(
      value.evidenceAvailable,
      `${path}.evidenceAvailable`,
    ),
  };
}

function parseCommand(
  input: unknown,
  path: string,
): { program: "codex"; args: string[] } {
  const value = record(input, path);
  return {
    program: oneOf(value.program, ["codex"] as const, `${path}.program`),
    args: stringArray(value.args, `${path}.args`),
  };
}

function parseSignal(input: unknown, path: string): ResumeSignal {
  const value = record(input, path);
  return {
    type: string(value.type, `${path}.type`),
    label: string(value.label, `${path}.label`),
    ...(value.weight === undefined
      ? {}
      : { weight: finiteNumber(value.weight, `${path}.weight`) }),
    ...(value.sourceIds === undefined
      ? {}
      : { sourceIds: stringArray(value.sourceIds, `${path}.sourceIds`) }),
  };
}

function parseRelatedRun(input: unknown, path: string): RelatedRun {
  const value = record(input, path);
  return {
    sourceId: string(value.sourceId, `${path}.sourceId`),
    ...optionalStringField(value, "title", path),
    ...optionalStringField(value, "resumeRef", path),
    lastActivity: string(value.lastActivity, `${path}.lastActivity`),
  };
}

function parseOpenAction(input: unknown, path: string): ResumeOpenAction {
  const value = record(input, path);
  return {
    kind: oneOf(
      value.kind,
      ["open-codex", "copy-command", "copy-id"] as const,
      `${path}.kind`,
    ),
    label: string(value.label, `${path}.label`),
    value: string(value.value, `${path}.value`),
  };
}

function parseDiagnostic(input: unknown, path: string): ResumeDiagnostic {
  const value = record(input, path);
  return {
    code: oneOf(value.code, ["unsafe-resume-ref"] as const, `${path}.code`),
    message: string(value.message, `${path}.message`),
    sourceId: string(value.sourceId, `${path}.sourceId`),
  };
}

function record(input: unknown, path: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalid(path, "must be an object");
  }
  return input as Record<string, unknown>;
}

function array(input: unknown, path: string): unknown[] {
  if (!Array.isArray(input)) throw invalid(path, "must be an array");
  return input;
}

function string(input: unknown, path: string): string {
  if (typeof input !== "string") throw invalid(path, "must be a string");
  return input;
}

function boolean(input: unknown, path: string): boolean {
  if (typeof input !== "boolean") throw invalid(path, "must be a boolean");
  return input;
}

function finiteNumber(input: unknown, path: string): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw invalid(path, "must be a finite number");
  }
  return input;
}

function stringArray(input: unknown, path: string): string[] {
  return array(input, path).map((item, index) =>
    string(item, `${path}[${index}]`),
  );
}

function optionalStringField(
  value: Record<string, unknown>,
  name: string,
  path: string,
): Record<string, string> {
  return value[name] === undefined
    ? {}
    : { [name]: string(value[name], `${path}.${name}`) };
}

function optionalBooleanField(
  value: Record<string, unknown>,
  name: string,
  path: string,
): Record<string, boolean> {
  return value[name] === undefined
    ? {}
    : { [name]: boolean(value[name], `${path}.${name}`) };
}

function oneOf<const T extends readonly (string | number)[]>(
  input: unknown,
  values: T,
  path: string,
): T[number] {
  if (!values.includes(input as T[number])) {
    throw invalid(path, `must be one of ${values.join(", ")}`);
  }
  return input as T[number];
}

function invalid(path: string, expectation: string): Error {
  return new ResumeSchemaError(path, expectation);
}
