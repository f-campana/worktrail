import { execFile } from "node:child_process";
import { homedir } from "node:os";

import { parseResumeSearchResult } from "./contract.js";
import {
  PNPM_RESOLUTION_ERROR_MESSAGE,
  PnpmResolutionError,
  pnpmExecutionEnvironment,
  resolvePnpmExecutable,
} from "./pnpm.js";
import {
  FilesystemPreferencePathError,
  resolveOptionalDatabasePath,
  resolveWorktrailProjectPath,
  WorktrailProjectPathError,
} from "./paths.js";
import type { ResumeSearchResult, WorktrailPreferences } from "./types.js";

const MAX_OUTPUT_BYTES = 1_000_000;
const SEARCH_TIMEOUT_MS = 15_000;

type SearchDependencies = {
  execute?: typeof execute;
  homeDirectory?: string;
  resolvePnpmExecutable?: typeof resolvePnpmExecutable;
};

export function buildWorktrailInvocation(
  query: string,
  preferences: WorktrailPreferences,
  program = "pnpm",
): { program: string; args: string[] } {
  const limit = Number.parseInt(preferences.resultLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Result limit must be between 1 and 20.");
  }

  const args = [
    "--silent",
    "--dir",
    preferences.worktrailProjectPath,
    "worktrail",
    "resume",
    query,
    "--json",
    "--limit",
    String(limit),
  ];
  if (preferences.databasePath?.trim()) {
    args.push("--db", preferences.databasePath);
  }
  if (preferences.includeArchived) args.push("--include-archived");
  return { program, args };
}

export async function searchWorktrail(
  query: string,
  preferences: WorktrailPreferences,
  signal?: AbortSignal,
  dependencies: SearchDependencies = {},
): Promise<ResumeSearchResult> {
  const homeDirectory = dependencies.homeDirectory ?? homedir();
  const worktrailProjectPath = await resolveWorktrailProjectPath(
    preferences.worktrailProjectPath,
    homeDirectory,
  );
  const databasePath = resolveOptionalDatabasePath(
    preferences.databasePath,
    homeDirectory,
  );
  const pnpmExecutable = await (
    dependencies.resolvePnpmExecutable ?? resolvePnpmExecutable
  )(preferences.pnpmPath);
  const invocation = buildWorktrailInvocation(
    query,
    { ...preferences, databasePath, worktrailProjectPath },
    pnpmExecutable,
  );
  const stdout = await (dependencies.execute ?? execute)(
    invocation.program,
    invocation.args,
    worktrailProjectPath,
    signal,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error("Worktrail returned invalid JSON.");
  }
  return parseResumeSearchResult(parsed);
}

function execute(
  program: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      args,
      {
        cwd,
        encoding: "utf8",
        env: pnpmExecutionEnvironment(program),
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
    error instanceof FilesystemPreferencePathError
  ) {
    return error.message.replace(/\s+/g, " ").trim().slice(0, 480);
  }
  if (
    error instanceof PnpmResolutionError ||
    (isNodeError(error) && error.code === "ENOENT")
  ) {
    return PNPM_RESOLUTION_ERROR_MESSAGE;
  }
  if (isNodeError(error) && error.killed) {
    return "Worktrail search timed out.";
  }

  const stderr = errorField(error, "stderr");
  const stdout = errorField(error, "stdout");
  const fallbackMessage = error instanceof Error ? error.message : "";
  const message = stderr || stdout || fallbackMessage;
  const firstLine = message
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "Worktrail search failed.";

  const redactions = [homedir(), ...privatePaths]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  let sanitized = firstLine;
  for (const value of redactions) sanitized = sanitized.split(value).join("~");
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
  if (/^command failed:/i.test(sanitized)) {
    return "Worktrail command failed. Check the Worktrail project path and database path preferences.";
  }
  return sanitized.slice(0, 240) || "Worktrail search failed.";
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
