import { execFile } from "node:child_process";
import { homedir } from "node:os";

import { parseResumeSearchResult } from "./contract.js";
import type { ResumeSearchResult, WorktrailPreferences } from "./types.js";

const MAX_OUTPUT_BYTES = 1_000_000;
const SEARCH_TIMEOUT_MS = 15_000;

export function buildWorktrailInvocation(
  query: string,
  preferences: WorktrailPreferences,
): { program: "pnpm"; args: string[] } {
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
  return { program: "pnpm", args };
}

export async function searchWorktrail(
  query: string,
  preferences: WorktrailPreferences,
  signal?: AbortSignal,
): Promise<ResumeSearchResult> {
  const invocation = buildWorktrailInvocation(query, preferences);
  const stdout = await execute(
    invocation.program,
    invocation.args,
    preferences.worktrailProjectPath,
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
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: SEARCH_TIMEOUT_MS,
        signal,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export function sanitizeErrorMessage(
  error: unknown,
  privatePaths: string[] = [],
): string {
  if (isNodeError(error) && error.code === "ENOENT") {
    return "Unable to start pnpm. Check that pnpm is available to Raycast.";
  }
  if (isNodeError(error) && error.killed) {
    return "Worktrail search timed out.";
  }

  const stderr = errorField(error, "stderr");
  const message = stderr || (error instanceof Error ? error.message : "");
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
