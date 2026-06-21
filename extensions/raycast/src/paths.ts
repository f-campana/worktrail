import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export class FilesystemPreferencePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilesystemPreferencePathError";
  }
}

export class DatabasePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabasePathError";
  }
}

export class WorktrailProjectPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktrailProjectPathError";
  }
}

export function expandFilesystemPreferencePath(
  value: string,
  homeDirectory = homedir(),
): string {
  const configuredPath = value.trim();
  if (!configuredPath) return "";
  if (configuredPath === "~") return homeDirectory;
  if (configuredPath.startsWith("~/")) {
    return join(homeDirectory, configuredPath.slice(2));
  }
  if (configuredPath.startsWith("~")) {
    throw new FilesystemPreferencePathError(
      "Only ~ and ~/... home-relative paths are supported.",
    );
  }
  if (!isAbsolute(configuredPath)) {
    throw new FilesystemPreferencePathError(
      "Use an absolute path or a path beginning with ~/.",
    );
  }
  return configuredPath;
}

export function homeNormalizePath(
  value: string,
  homeDirectory = homedir(),
): string {
  if (value === homeDirectory) return "~/";
  if (value.startsWith(`${homeDirectory}/`)) {
    return `~/${value.slice(homeDirectory.length + 1)}`;
  }
  return value;
}

export async function resolveWorktrailProjectPath(
  configuredPath: string,
  homeDirectory = homedir(),
): Promise<string> {
  let resolvedPath: string;
  try {
    resolvedPath = expandFilesystemPreferencePath(
      configuredPath,
      homeDirectory,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid path.";
    throw projectPathError(configuredPath, undefined, reason, homeDirectory);
  }

  if (!resolvedPath) {
    throw projectPathError(
      configuredPath,
      undefined,
      "No path was configured.",
      homeDirectory,
    );
  }

  const projectStat = await stat(resolvedPath).catch(() => {
    throw projectPathError(
      configuredPath,
      resolvedPath,
      "The resolved path does not exist or cannot be read.",
      homeDirectory,
    );
  });
  if (!projectStat.isDirectory()) {
    throw projectPathError(
      configuredPath,
      resolvedPath,
      "The resolved path is not a directory.",
      homeDirectory,
    );
  }

  let packageJson: unknown;
  try {
    packageJson = JSON.parse(
      await readFile(join(resolvedPath, "package.json"), "utf8"),
    ) as unknown;
  } catch {
    throw projectPathError(
      configuredPath,
      resolvedPath,
      "The directory must contain a parseable Worktrail package.json.",
      homeDirectory,
    );
  }
  if (!identifiesWorktrail(packageJson)) {
    throw projectPathError(
      configuredPath,
      resolvedPath,
      "The package.json does not identify the Worktrail repository.",
      homeDirectory,
    );
  }

  return resolvedPath;
}

export async function resolveOptionalDatabasePath(
  configuredPath: string | undefined,
  homeDirectory = homedir(),
): Promise<string | undefined> {
  if (!configuredPath?.trim()) return undefined;
  let resolvedPath: string;
  try {
    resolvedPath = expandFilesystemPreferencePath(
      configuredPath,
      homeDirectory,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid path.";
    throw databasePathError(configuredPath, undefined, reason, homeDirectory);
  }

  const databaseStat = await stat(resolvedPath).catch(() => {
    throw databasePathError(
      configuredPath,
      resolvedPath,
      "The resolved path does not exist or cannot be read.",
      homeDirectory,
    );
  });
  if (!databaseStat.isFile()) {
    throw databasePathError(
      configuredPath,
      resolvedPath,
      "The resolved path is not a file.",
      homeDirectory,
    );
  }
  return resolvedPath;
}

function identifiesWorktrail(packageJson: unknown): boolean {
  if (!isRecord(packageJson)) return false;
  if (packageJson.name === "worktrail") return true;
  return (
    isRecord(packageJson.scripts) &&
    typeof packageJson.scripts.worktrail === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function projectPathError(
  configuredPath: string,
  resolvedPath: string | undefined,
  reason: string,
  homeDirectory: string,
): WorktrailProjectPathError {
  const received = homeNormalizePath(
    configuredPath.trim() || "(empty)",
    homeDirectory,
  );
  const resolution = resolvedPath
    ? `, which resolved to “${homeNormalizePath(resolvedPath, homeDirectory)}”`
    : "";
  return new WorktrailProjectPathError(
    `Worktrail project path is invalid. Raycast received “${received}”${resolution}. ${reason} Set “Worktrail project path” to the repository folder containing Worktrail’s package.json, for example: ~/Documents/worktrail or /Users/<name>/Documents/worktrail.`,
  );
}

function databasePathError(
  configuredPath: string,
  resolvedPath: string | undefined,
  reason: string,
  homeDirectory: string,
): DatabasePathError {
  const received = homeNormalizePath(
    configuredPath.trim() || "(empty)",
    homeDirectory,
  );
  const resolution = resolvedPath
    ? `, which resolved to “${homeNormalizePath(resolvedPath, homeDirectory)}”`
    : "";
  return new DatabasePathError(
    `Database path is invalid. Raycast received “${received}”${resolution}. ${reason} Set “Database path” to an existing Worktrail SQLite database file, or leave it empty to use ~/.worktrail/worktrail.db.`,
  );
}
