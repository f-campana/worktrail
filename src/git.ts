import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_COMMITS = 20;
const DEFAULT_MAX_FILES = 50;

export type GitDiagnostic = { code: string; message: string };

export type GitRepositorySignal = {
  root: string;
  displayRoot: string;
  branch?: string;
  head?: string;
  dirty: boolean;
  dirtyFileCount: number;
  changedFilesInWindow: string[];
  changedFilesTruncated: boolean;
  commitsInWindow: Array<{
    sha: string;
    subject: string;
    authorDate?: string;
  }>;
  commitsTruncated: boolean;
  relatedRunSourceIds: string[];
  diagnostics: GitDiagnostic[];
};

export type GitSignals = {
  repositories: GitRepositorySignal[];
  diagnostics: GitDiagnostic[];
};

export type GitSignalSource = { sourceId: string; cwd: string | null };

export type GitSignalOptions = {
  since: string;
  until: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxCommits?: number;
  maxFiles?: number;
  gitBinary?: string;
};

/** Collects bounded, read-only facts from repositories referenced by run cwds. */
export function collectGitSignals(
  sources: GitSignalSource[],
  options: GitSignalOptions,
): GitSignals {
  const diagnostics: GitDiagnostic[] = [];
  const roots = new Map<string, Set<string>>();
  for (const source of [...sources].sort((a, b) =>
    a.sourceId.localeCompare(b.sourceId),
  )) {
    if (!source.cwd) continue;
    const result = git(source.cwd, ["rev-parse", "--show-toplevel"], options);
    if (!result.ok) {
      diagnostics.push({
        code: result.code === "timeout" ? "git-timeout" : "git-unavailable",
        message: `Git signals unavailable for ${displayPath(source.cwd)}.`,
      });
      continue;
    }
    const root = resolve(result.stdout.trim());
    const ids = roots.get(root) ?? new Set<string>();
    ids.add(source.sourceId);
    roots.set(root, ids);
  }

  const repositories = [...roots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([root, ids]) => collectRepository(root, [...ids].sort(), options));
  return { repositories, diagnostics: deduplicateDiagnostics(diagnostics) };
}

function collectRepository(
  root: string,
  relatedRunSourceIds: string[],
  options: GitSignalOptions,
): GitRepositorySignal {
  const diagnostics: GitDiagnostic[] = [];
  const branchResult = git(
    root,
    ["rev-parse", "--abbrev-ref", "HEAD"],
    options,
  );
  const headResult = git(root, ["rev-parse", "--short", "HEAD"], options);
  const statusResult = git(root, ["status", "--porcelain", "-z"], options);
  const maxCommits = options.maxCommits ?? DEFAULT_MAX_COMMITS;
  const commitResult = git(
    root,
    [
      "log",
      `--since=${options.since}`,
      `--until=${options.until}`,
      `--max-count=${maxCommits + 1}`,
      "--pretty=format:%h%x00%s%x00%aI%x00",
    ],
    options,
  );
  const fileResult = git(
    root,
    [
      "log",
      `--since=${options.since}`,
      `--until=${options.until}`,
      "--name-only",
      "--pretty=format:",
    ],
    options,
  );

  for (const [name, result] of [
    ["branch", branchResult],
    ["HEAD", headResult],
    ["status", statusResult],
    ["commit history", commitResult],
    ["changed files", fileResult],
  ] as const) {
    if (!result.ok)
      diagnostics.push({
        code: result.code === "timeout" ? "git-timeout" : "git-command-failed",
        message: `Unable to collect Git ${name}.`,
      });
  }

  const statusEntries = statusResult.ok
    ? parseStatusEntries(statusResult.stdout)
    : [];
  const allCommits = commitResult.ok ? parseCommits(commitResult.stdout) : [];
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const allFiles = fileResult.ok
    ? [...new Set(fileResult.stdout.split(/\r?\n/).filter(Boolean))].sort()
    : [];
  const branch = branchResult.ok ? branchResult.stdout.trim() : undefined;
  const head = headResult.ok ? headResult.stdout.trim() : undefined;
  return {
    root,
    displayRoot: displayPath(root),
    ...(branch && branch !== "HEAD" ? { branch } : {}),
    ...(head ? { head } : {}),
    dirty: statusEntries.length > 0,
    dirtyFileCount: statusEntries.length,
    changedFilesInWindow: allFiles.slice(0, maxFiles),
    changedFilesTruncated: allFiles.length > maxFiles,
    commitsInWindow: allCommits.slice(0, maxCommits),
    commitsTruncated: allCommits.length > maxCommits,
    relatedRunSourceIds,
    diagnostics: deduplicateDiagnostics(diagnostics),
  };
}

function parseCommits(value: string): GitRepositorySignal["commitsInWindow"] {
  const fields = value.split("\0");
  const commits: GitRepositorySignal["commitsInWindow"] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const sha = fields[index]?.trim();
    const subject = fields[index + 1];
    const authorDate = fields[index + 2]?.trim();
    if (sha && subject !== undefined)
      commits.push({ sha, subject, ...(authorDate ? { authorDate } : {}) });
  }
  return commits;
}

function parseStatusEntries(value: string): string[] {
  const fields = value.split("\0").filter(Boolean);
  const entries: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]!;
    entries.push(entry);
    if (
      entry[0] === "R" ||
      entry[0] === "C" ||
      entry[1] === "R" ||
      entry[1] === "C"
    )
      index += 1;
  }
  return entries;
}

type GitResult =
  | { ok: true; stdout: string }
  | { ok: false; code: "failed" | "timeout" };

function git(
  cwd: string,
  args: string[],
  options: GitSignalOptions,
): GitResult {
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(options.gitBinary ?? "git", args, {
      cwd,
      encoding: "utf8",
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      windowsHide: true,
    });
  } catch {
    return { ok: false, code: "failed" };
  }
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return { ok: false, code: code === "ETIMEDOUT" ? "timeout" : "failed" };
  }
  if (result.status !== 0) return { ok: false, code: "failed" };
  return { ok: true, stdout: result.stdout };
}

function displayPath(path: string): string {
  const home = homedir();
  return path === home
    ? "~"
    : path.startsWith(`${home}${sep}`)
      ? `~${path.slice(home.length)}`
      : path;
}

function deduplicateDiagnostics(values: GitDiagnostic[]): GitDiagnostic[] {
  return [
    ...new Map(
      values.map((item) => [`${item.code}\0${item.message}`, item]),
    ).values(),
  ];
}
