import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

import { expandFilesystemPreferencePath, homeNormalizePath } from "./paths.js";

export const WORKTRAIL_RESOLUTION_ERROR_MESSAGE =
  "Unable to start the Worktrail CLI. Set “Worktrail executable path” to an installed executable, for example ~/.local/bin/worktrail, or configure “Worktrail project path (development fallback)”; set the pnpm path only if automatic pnpm resolution fails.";

type ExecutableProbe = (path: string) => Promise<boolean>;

type ResolutionOptions = {
  environmentPath?: string;
  homeDirectory?: string;
  isExecutable?: ExecutableProbe;
};

export class WorktrailResolutionError extends Error {
  constructor(configuredPath?: string, homeDirectory = homedir()) {
    const configured = configuredPath?.trim();
    const detail = configured
      ? ` The configured value “${homeNormalizePath(configured, homeDirectory)}” was not executable or available on Raycast’s PATH.`
      : "";
    super(`${WORKTRAIL_RESOLUTION_ERROR_MESSAGE}${detail}`);
    this.name = "WorktrailResolutionError";
  }
}

export async function resolveWorktrailExecutable(
  preferredPath?: string,
  options: ResolutionOptions = {},
): Promise<string | undefined> {
  const isExecutable = options.isExecutable ?? probeExecutable;
  const environmentPath = options.environmentPath ?? process.env.PATH ?? "";
  const homeDirectory = options.homeDirectory ?? homedir();
  const configured = preferredPath?.trim();

  if (configured) {
    if (looksLikeFilesystemPath(configured)) {
      const configuredPath = resolveConfiguredPath(configured, homeDirectory);
      if (configuredPath && (await isExecutable(configuredPath))) {
        return configuredPath;
      }
    } else if (
      await isAvailableOnPath(configured, environmentPath, isExecutable)
    ) {
      return configured;
    }
  }

  if (
    configured !== "worktrail" &&
    (await isAvailableOnPath("worktrail", environmentPath, isExecutable))
  ) {
    return "worktrail";
  }
  return undefined;
}

function looksLikeFilesystemPath(configured: string): boolean {
  return (
    isAbsolute(configured) ||
    configured.startsWith("~") ||
    configured.includes("/")
  );
}

function resolveConfiguredPath(
  configured: string,
  homeDirectory: string,
): string | undefined {
  try {
    return expandFilesystemPreferencePath(configured, homeDirectory);
  } catch {
    return undefined;
  }
}

async function isAvailableOnPath(
  executable: string,
  environmentPath: string,
  isExecutable: ExecutableProbe,
): Promise<boolean> {
  for (const directory of environmentPath.split(delimiter).filter(Boolean)) {
    if (await isExecutable(join(directory, executable))) return true;
  }
  return false;
}

async function probeExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
