import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";

const STANDARD_MACOS_EXECUTABLE_PATHS = [
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

export const PNPM_RESOLUTION_ERROR_MESSAGE =
  "Unable to start the pnpm development fallback. Raycast may not inherit your terminal PATH. Run `which pnpm` in Terminal, then set “pnpm executable path (development fallback)” in this command’s preferences. Tried: pnpm, /opt/homebrew/bin/pnpm, /usr/local/bin/pnpm, ~/Library/pnpm/pnpm.";

type ExecutableProbe = (path: string) => Promise<boolean>;

type ResolutionOptions = {
  environmentPath?: string;
  homeDirectory?: string;
  isExecutable?: ExecutableProbe;
};

export class PnpmResolutionError extends Error {
  constructor() {
    super(PNPM_RESOLUTION_ERROR_MESSAGE);
    this.name = "PnpmResolutionError";
  }
}

export async function resolvePnpmExecutable(
  preferredPath?: string,
  options: ResolutionOptions = {},
): Promise<string> {
  const isExecutable = options.isExecutable ?? probeExecutable;
  const configuredPath = preferredPath?.trim();

  if (
    configuredPath &&
    isAbsolute(configuredPath) &&
    (await isExecutable(configuredPath))
  ) {
    return configuredPath;
  }

  const environmentPath = options.environmentPath ?? process.env.PATH ?? "";
  if (await isAvailableOnPath("pnpm", environmentPath, isExecutable)) {
    return "pnpm";
  }

  const homeDirectory = options.homeDirectory ?? homedir();
  for (const path of commonPnpmPaths(homeDirectory)) {
    if (await isExecutable(path)) return path;
  }

  throw new PnpmResolutionError();
}

export function commonPnpmPaths(homeDirectory: string): string[] {
  return [
    "/opt/homebrew/bin/pnpm",
    "/usr/local/bin/pnpm",
    join(homeDirectory, "Library", "pnpm", "pnpm"),
  ];
}

export function pnpmExecutionEnvironment(
  executable: string,
  environment: NodeJS.ProcessEnv = process.env,
  nodeExecutable = process.execPath,
  homeDirectory = homedir(),
): NodeJS.ProcessEnv {
  const executableDirectory = isAbsolute(executable)
    ? dirname(executable)
    : undefined;
  const path = [
    executableDirectory,
    dirname(nodeExecutable),
    ...(environment.PATH?.split(delimiter) ?? []),
    ...STANDARD_MACOS_EXECUTABLE_PATHS,
  ];

  return {
    ...environment,
    HOME: homeDirectory,
    PATH: [...new Set(path.filter(Boolean))].join(delimiter),
  };
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
