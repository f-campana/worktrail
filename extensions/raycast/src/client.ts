import { execFile } from "node:child_process";
import { homedir } from "node:os";

import {
  parseResumeSearchResult,
  ResumeCompatibilityError,
  ResumeSchemaError,
} from "./contract.js";
import {
  PNPM_RESOLUTION_ERROR_MESSAGE,
  PnpmResolutionError,
  pnpmExecutionEnvironment,
  resolvePnpmExecutable,
} from "./pnpm.js";
import {
  DatabasePathError,
  FilesystemPreferencePathError,
  resolveOptionalDatabasePath,
  resolveWorktrailProjectPath,
  WorktrailProjectPathError,
} from "./paths.js";
import type { ResumeSearchResult, WorktrailPreferences } from "./types.js";
import {
  resolveWorktrailExecutable,
  WorktrailResolutionError,
} from "./worktrail.js";

const MAX_OUTPUT_BYTES = 1_000_000;
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_DIAGNOSTIC_CHARS = 180;
const MAX_ERROR_MESSAGE_CHARS = 720;

class WorktrailCliError extends Error {
  constructor(
    readonly exitCode: number | string | undefined,
    readonly stdout: string,
    readonly stderr: string,
    readonly debugCommand: string,
  ) {
    super("Worktrail CLI exited non-zero.");
    this.name = "WorktrailCliError";
  }
}

class WorktrailResponseError extends Error {
  constructor(
    readonly kind: "json" | "schema" | "compatibility",
    message: string,
    readonly debugCommand: string,
  ) {
    super(message);
    this.name = "WorktrailResponseError";
  }
}

class WorktrailTimeoutError extends Error {
  constructor(readonly debugCommand: string) {
    super("Worktrail search timed out.");
    this.name = "WorktrailTimeoutError";
  }
}

class WorktrailSpawnError extends Error {
  constructor(readonly mode: "installed" | "pnpm") {
    super(`Unable to spawn the ${mode} Worktrail invocation.`);
    this.name = "WorktrailSpawnError";
  }
}

type SearchDependencies = {
  execute?: typeof execute;
  homeDirectory?: string;
  resolvePnpmExecutable?: typeof resolvePnpmExecutable;
  resolveWorktrailExecutable?: typeof resolveWorktrailExecutable;
};

export function buildInstalledWorktrailInvocation(
  query: string,
  preferences: WorktrailPreferences,
  program = "worktrail",
): { program: string; args: string[] } {
  return {
    program,
    args: buildResumeArgs(query, preferences),
  };
}

export function buildPnpmWorktrailInvocation(
  query: string,
  preferences: WorktrailPreferences & { worktrailProjectPath: string },
  program = "pnpm",
): { program: string; args: string[] } {
  return {
    program,
    args: [
      "--silent",
      "--dir",
      preferences.worktrailProjectPath,
      "worktrail",
      ...buildResumeArgs(query, preferences),
    ],
  };
}

function buildResumeArgs(
  query: string,
  preferences: WorktrailPreferences,
): string[] {
  const limit = Number.parseInt(preferences.resultLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Result limit must be between 1 and 20.");
  }

  const args = ["resume", query, "--json", "--limit", String(limit)];
  if (preferences.databasePath?.trim()) {
    args.push("--db", preferences.databasePath);
  }
  if (preferences.includeArchived) args.push("--include-archived");
  return args;
}

export async function searchWorktrail(
  query: string,
  preferences: WorktrailPreferences,
  signal?: AbortSignal,
  dependencies: SearchDependencies = {},
): Promise<ResumeSearchResult> {
  const homeDirectory = dependencies.homeDirectory ?? homedir();
  const databasePath = await resolveOptionalDatabasePath(
    preferences.databasePath,
    homeDirectory,
  );
  const installedExecutable = await (
    dependencies.resolveWorktrailExecutable ?? resolveWorktrailExecutable
  )(preferences.worktrailPath, { homeDirectory });
  let mode: "installed" | "pnpm";
  let cwd: string;
  let invocation: { program: string; args: string[] };
  if (installedExecutable) {
    mode = "installed";
    cwd = homeDirectory;
    invocation = buildInstalledWorktrailInvocation(
      query,
      { ...preferences, databasePath },
      installedExecutable,
    );
  } else if (preferences.worktrailProjectPath?.trim()) {
    mode = "pnpm";
    const worktrailProjectPath = await resolveWorktrailProjectPath(
      preferences.worktrailProjectPath,
      homeDirectory,
    );
    const pnpmExecutable = await (
      dependencies.resolvePnpmExecutable ?? resolvePnpmExecutable
    )(preferences.pnpmPath, { homeDirectory });
    cwd = worktrailProjectPath;
    invocation = buildPnpmWorktrailInvocation(
      query,
      { ...preferences, databasePath, worktrailProjectPath },
      pnpmExecutable,
    );
  } else {
    throw new WorktrailResolutionError(
      preferences.worktrailPath,
      homeDirectory,
    );
  }
  const debugCommand = formatDebugCommand(invocation, homeDirectory);
  let stdout: string;
  try {
    stdout = await (dependencies.execute ?? execute)(
      invocation.program,
      invocation.args,
      cwd,
      signal,
      homeDirectory,
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new WorktrailSpawnError(mode);
    }
    if (isNodeError(error) && error.code === "ABORT_ERR") throw error;
    if (
      (isNodeError(error) && error.killed) ||
      (isNodeError(error) && error.code === "ETIMEDOUT")
    ) {
      throw new WorktrailTimeoutError(debugCommand);
    }
    throw new WorktrailCliError(
      errorCode(error),
      errorField(error, "stdout"),
      errorField(error, "stderr"),
      debugCommand,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    throw new WorktrailResponseError(
      "json",
      "Worktrail returned invalid JSON on stdout.",
      debugCommand,
    );
  }
  try {
    return parseResumeSearchResult(parsed);
  } catch (error) {
    if (error instanceof ResumeCompatibilityError) {
      throw new WorktrailResponseError(
        "compatibility",
        error.message,
        debugCommand,
      );
    }
    if (error instanceof ResumeSchemaError) {
      throw new WorktrailResponseError("schema", error.message, debugCommand);
    }
    throw error;
  }
}

function execute(
  program: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  homeDirectory = homedir(),
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      args,
      {
        cwd,
        encoding: "utf8",
        env: pnpmExecutionEnvironment(
          program,
          process.env,
          process.execPath,
          homeDirectory,
        ),
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: SEARCH_TIMEOUT_MS,
        signal,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(error, {
              stderr: typeof stderr === "string" ? stderr : "",
              stdout: typeof stdout === "string" ? stdout : "",
            }),
          );
        } else resolve(stdout);
      },
    );
  });
}

export function sanitizeErrorMessage(
  error: unknown,
  privatePaths: string[] = [],
): string {
  if (
    error instanceof WorktrailProjectPathError ||
    error instanceof DatabasePathError ||
    error instanceof FilesystemPreferencePathError ||
    error instanceof WorktrailResolutionError
  ) {
    return error.message.replace(/\s+/g, " ").trim().slice(0, 480);
  }
  if (
    error instanceof PnpmResolutionError ||
    (error instanceof WorktrailSpawnError && error.mode === "pnpm")
  ) {
    return PNPM_RESOLUTION_ERROR_MESSAGE;
  }
  if (error instanceof WorktrailSpawnError) {
    return new WorktrailResolutionError().message;
  }
  if (error instanceof WorktrailTimeoutError) {
    return boundedErrorMessage(
      `Worktrail search timed out after ${SEARCH_TIMEOUT_MS / 1_000} seconds. Command: ${error.debugCommand}. Use “Copy Debug Command” and run it in Terminal.`,
    );
  }
  if (error instanceof WorktrailCliError) {
    const outputKind = error.stderr.trim() ? "stderr" : "stdout";
    const output = error.stderr.trim() || error.stdout.trim();
    const detail = output
      ? ` ${outputKind}: ${sanitizeDiagnosticText(output, privatePaths)}.`
      : " No stderr or stdout was captured.";
    return boundedErrorMessage(
      `Worktrail CLI exited with code ${String(error.exitCode ?? "unknown")}.${detail} Command: ${error.debugCommand}. Use “Copy Debug Command” and run it in Terminal.`,
    );
  }
  if (error instanceof WorktrailResponseError) {
    const classification =
      error.kind === "json"
        ? `${error.message} Only stdout is parsed; warnings on stderr are safe, but warnings on stdout are not.`
        : error.kind === "compatibility"
          ? `Worktrail response schema version mismatch. ${error.message}`
          : `Worktrail response schema mismatch. ${error.message}`;
    return boundedErrorMessage(
      `${classification} Command: ${error.debugCommand}. Use “Copy Debug Command” and run it in Terminal.`,
    );
  }

  const stderr = errorField(error, "stderr");
  const stdout = errorField(error, "stdout");
  const fallbackMessage = error instanceof Error ? error.message : "";
  const message = stderr || stdout || fallbackMessage;
  const firstLine = firstNonEmptyLine(message);
  if (!firstLine) return "Worktrail search failed.";
  const sanitized = sanitizeDiagnosticText(firstLine, privatePaths);
  return boundedErrorMessage(
    `Unexpected Worktrail search failure. ${sanitized || "No details were captured."}`,
  );
}

export function debugCommandFromError(error: unknown): string | undefined {
  return error instanceof WorktrailCliError ||
    error instanceof WorktrailResponseError ||
    error instanceof WorktrailTimeoutError
    ? error.debugCommand
    : undefined;
}

export function formatDebugCommand(
  invocation: { program: string; args: string[] },
  homeDirectory = homedir(),
): string {
  return [invocation.program, ...invocation.args]
    .map((token) => shellDebugToken(token, homeDirectory))
    .join(" ");
}

function isNodeError(
  error: unknown,
): error is Error & { code?: string; killed?: boolean } {
  return error instanceof Error;
}

function errorField(error: unknown, field: string): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function errorCode(error: unknown): number | string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>).code;
  return typeof value === "number" || typeof value === "string"
    ? value
    : undefined;
}

function firstNonEmptyLine(value: string): string {
  return (
    value
      .replace(/\u001b\[[0-9;]*m/g, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function sanitizeDiagnosticText(
  value: string,
  privatePaths: string[] = [],
): string {
  const redactions = [homedir(), ...privatePaths]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  let sanitized = firstNonEmptyLine(value);
  for (const privatePath of redactions) {
    sanitized = sanitized.split(privatePath).join("~");
  }
  sanitized = sanitized
    .replace(/^worktrail:\s*/i, "")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[credentials]@",
    )
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/\/home\/[^/\s]+/g, "~")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(sanitized, MAX_DIAGNOSTIC_CHARS);
}

function boundedErrorMessage(value: string): string {
  return truncate(value.replace(/\s+/g, " ").trim(), MAX_ERROR_MESSAGE_CHARS);
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum - 1).trimEnd()}…`;
}

function shellDebugToken(value: string, homeDirectory: string): string {
  const sanitized = value.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
    "$1[credentials]@",
  );
  if (sanitized === homeDirectory) return '"$HOME"';
  if (sanitized.startsWith(`${homeDirectory}/`)) {
    const suffix = sanitized.slice(homeDirectory.length + 1);
    return `"$HOME/${suffix.replace(/[\\"$`]/g, "\\$&")}"`;
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(sanitized)) return sanitized;
  return `'${sanitized.replace(/'/g, `'"'"'`)}'`;
}
