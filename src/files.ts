import { posix } from "node:path";

export function normalizeRelatedFiles(
  paths: readonly string[],
  cwds: readonly (string | null | undefined)[],
): string[] {
  const normalizedCwds = [...new Set(cwds.filter((cwd): cwd is string => Boolean(cwd)))]
    .map(normalizePath)
    .sort((left, right) => right.length - left.length);
  const selected = new Map<string, string>();

  for (const rawPath of paths) {
    const normalized = normalizePath(rawPath);
    if (!normalized) continue;
    const display = repoRelativePath(normalized, normalizedCwds);
    const key = display;
    const previous = selected.get(key);
    if (!previous || prefer(display, previous)) selected.set(key, display);
  }

  return [...selected.values()];
}

function repoRelativePath(path: string, cwds: string[]): string {
  if (!isAbsoluteLike(path)) return stripLeadingDot(path);
  for (const cwd of cwds) {
    if (path === cwd) return posix.basename(path);
    if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  }
  return path;
}

function normalizePath(path: string): string {
  const slashes = path.trim().replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  if (!slashes) return "";
  const homePrefix = slashes.startsWith("~/") ? "~/" : slashes.startsWith("/") ? "/" : "";
  const body = homePrefix ? slashes.slice(homePrefix.length) : slashes;
  const normalizedBody = posix.normalize(body);
  return `${homePrefix}${normalizedBody === "." ? "" : normalizedBody}`.replace(/\/$/, "");
}

function stripLeadingDot(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

function isAbsoluteLike(path: string): boolean {
  return path.startsWith("/") || path.startsWith("~/");
}

function prefer(candidate: string, previous: string): boolean {
  const candidateAbsolute = isAbsoluteLike(candidate);
  const previousAbsolute = isAbsoluteLike(previous);
  if (candidateAbsolute !== previousAbsolute) return !candidateAbsolute;
  return candidate.length < previous.length;
}
