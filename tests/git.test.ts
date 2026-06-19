import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectGitSignals } from "../src/git.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const window = {
  since: "2026-06-18T00:00:00.000Z",
  until: "2026-06-19T00:00:00.000Z",
};

test("Git signals tolerate non-Git and missing directories", () => {
  const signals = collectGitSignals(
    [
      { sourceId: "non-git", cwd: tmpdir() },
      { sourceId: "missing", cwd: join(tmpdir(), "worktrail-does-not-exist") },
    ],
    window,
  );
  assert.deepEqual(signals.repositories, []);
  assert.ok(signals.diagnostics.length > 0);
});

test(
  "Git signals resolve nested roots, deduplicate runs, and collect bounded facts",
  { skip: !hasGit && "git is not installed" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "worktrail-git-"));
    try {
      git(root, ["init", "-b", "signal-test"]);
      git(root, ["config", "user.name", "Worktrail Test"]);
      git(root, ["config", "user.email", "worktrail@example.invalid"]);
      await writeFile(join(root, "outside.txt"), "outside\n");
      git(root, ["add", "outside.txt"]);
      commit(root, "outside", "2026-06-17T12:00:00Z");
      await writeFile(join(root, "inside.txt"), "inside\n");
      git(root, ["add", "inside.txt"]);
      commit(root, "inside window", "2026-06-18T12:00:00Z");
      await mkdir(join(root, "nested"));
      await writeFile(join(root, "dirty.txt"), "dirty\n");

      const signals = collectGitSignals(
        [
          { sourceId: "run-b", cwd: join(root, "nested") },
          { sourceId: "run-a", cwd: root },
        ],
        window,
      );
      assert.equal(signals.repositories.length, 1);
      const repository = signals.repositories[0]!;
      assert.equal(repository.root, await realpath(root));
      assert.equal(repository.branch, "signal-test");
      assert.match(repository.head ?? "", /^[0-9a-f]+$/);
      assert.equal(repository.dirty, true);
      assert.equal(repository.dirtyFileCount, 1);
      assert.deepEqual(repository.relatedRunSourceIds, ["run-a", "run-b"]);
      assert.deepEqual(
        repository.commitsInWindow.map((commit) => commit.subject),
        ["inside window"],
      );
      assert.deepEqual(repository.changedFilesInWindow, ["inside.txt"]);
      assert.equal(JSON.stringify(signals).includes("diff"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("Git command failures become diagnostics", () => {
  const signals = collectGitSignals([{ sourceId: "run", cwd: tmpdir() }], {
    ...window,
    gitBinary: "worktrail-missing-git-binary",
  });
  assert.equal(signals.repositories.length, 0);
  assert.equal(signals.diagnostics[0]?.code, "git-unavailable");
});

test("Git command timeouts become diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-git-timeout-"));
  const binary = join(directory, "slow-git");
  try {
    await writeFile(binary, "#!/bin/sh\nsleep 1\n");
    await chmod(binary, 0o755);
    const signals = collectGitSignals([{ sourceId: "run", cwd: directory }], {
      ...window,
      gitBinary: binary,
      timeoutMs: 10,
    });
    assert.equal(signals.repositories.length, 0);
    assert.equal(signals.diagnostics[0]?.code, "git-timeout");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
}

function commit(cwd: string, subject: string, date: string): void {
  git(cwd, ["commit", "-m", subject], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}
