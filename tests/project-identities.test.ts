import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { WorktrailDatabase } from "../src/db/database.js";
import {
  addProjectAlias,
  listProjectAliases,
  listProjects,
  reconcileProjectIdentities,
  removeProjectAlias,
  resolveProjectIdentity,
} from "../src/projects.js";
import { findResumableTargets } from "../src/resume.js";
import { addWorkstreamAlias, createWorkstream } from "../src/workstreams.js";
import {
  insertSyntheticThread,
  syntheticId,
} from "./helpers/synthetic-corpus.js";

const cli = resolve("node_modules/.bin/tsx");

test("Git common-dir resolution groups repository paths and linked worktrees", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-project-git-"));
  const repository = join(directory, "ship-ready");
  const nested = join(repository, "src", "nested");
  const linked = join(directory, "ship-ready-linked");
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    await mkdir(nested, { recursive: true });
    git(repository, ["init", "-b", "main"]);
    git(repository, [
      "-c",
      "user.name=Worktrail Test",
      "-c",
      "user.email=worktrail@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "initial",
    ]);
    git(repository, ["worktree", "add", "-b", "linked-test", linked]);

    const root = resolveProject(repository);
    const child = resolveProject(nested);
    const worktree = resolveProject(linked);
    assert.equal(root.keyKind, "git-common-dir");
    assert.equal(root.confidence, "high");
    assert.equal(child.opaqueKey, root.opaqueKey);
    assert.equal(worktree.opaqueKey, root.opaqueKey);
    assert.equal(root.name, "ship-ready");

    insertSyntheticThread(database, thread(491, "Repository root", repository));
    insertSyntheticThread(database, thread(492, "Linked worktree", linked));
    reconcileProjectIdentities(database, "codex-local");
    assert.equal(listProjects(database).length, 1);
    assert.equal(listProjects(database)[0]?.threadCount, 2);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("cwd fallback is conservative and same-basename directories stay distinct", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-project-cwd-"));
  const first = join(directory, "one", "shared");
  const second = join(directory, "two", "shared");
  const missing = join(directory, "missing");
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    const firstResolution = resolveProject(first);
    const secondResolution = resolveProject(second);
    assert.equal(firstResolution.keyKind, "cwd");
    assert.equal(firstResolution.confidence, "medium");
    assert.notEqual(firstResolution.opaqueKey, secondResolution.opaqueKey);
    assert.equal(
      resolveProjectIdentity({
        sourceThreadId: 99,
        adapterId: "codex-local",
        rawCwd: missing,
        observedAt: "2026-06-22T10:00:00.000Z",
      }),
      undefined,
    );

    insertSyntheticThread(database, thread(501, "First shared", first));
    insertSyntheticThread(database, thread(502, "Second shared", second));
    const diagnostics = reconcileProjectIdentities(database, "codex-local");
    assert.deepEqual(diagnostics, []);
    const projects = listProjects(database);
    assert.equal(projects.length, 2);
    assert.equal(new Set(projects.map((project) => project.id)).size, 2);
    assert.equal(new Set(projects.map((project) => project.name)).size, 2);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit project aliases survive reconciliation and change deterministic ranking", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-project-alias-"));
  const scaleway = join(directory, "scaleway");
  const other = join(directory, "other");
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    await mkdir(scaleway, { recursive: true });
    await mkdir(other, { recursive: true });
    insertSyntheticThread(
      database,
      thread(510, "SC | Review PieChart component", scaleway),
    );
    insertSyntheticThread(
      database,
      thread(511, "Recent unrelated notes", other, "scaleway mentioned"),
    );
    reconcileProjectIdentities(database, "codex-local");

    const before = findResumableTargets(database, { query: "SC" });
    assert.equal(before.targets[0]?.title, "SC | Review PieChart component");
    assert.ok(
      before.targets[0]?.signals.some(
        (signal) => signal.type === "title-prefix-match",
      ),
    );
    assert.equal(
      before.targets.some((target) =>
        target.signals.some((signal) => signal.type === "project-alias-match"),
      ),
      false,
    );

    const added = addProjectAlias(database, "scaleway", "SC");
    assert.equal(added.projectName, "scaleway");
    const workstream = createWorkstream(database, "SC delivery work");
    addWorkstreamAlias(database, workstream.id, "SC");
    assert.equal(database.scalar("SELECT count(*) FROM project_aliases"), 1);
    assert.equal(database.scalar("SELECT count(*) FROM workstream_aliases"), 1);
    const after = findResumableTargets(database, { query: "SC" });
    assert.equal(after.targets[0]?.title, "SC | Review PieChart component");
    assert.equal(after.targets[0]?.confidence, "high");
    assert.equal(after.targets[0]?.scoreVersion, 3);
    assert.ok(
      after.targets[0]?.signals.some(
        (signal) =>
          signal.type === "project-alias-match" &&
          signal.label.includes("SC → scaleway"),
      ),
    );
    assert.ok(
      after.targets[0]?.signals.some(
        (signal) => signal.type === "project-membership",
      ),
    );

    const scalewayResult = findResumableTargets(database, {
      query: "scaleway",
    });
    assert.equal(
      scalewayResult.targets[0]?.title,
      "SC | Review PieChart component",
    );
    assert.ok(
      scalewayResult.targets[0]?.signals.some(
        (signal) => signal.type === "project-identity-match",
      ),
    );

    assert.throws(
      () => addProjectAlias(database, "other", "SC"),
      /conflicts with active project alias/i,
    );
    reconcileProjectIdentities(database, "codex-local");
    assert.equal(listProjectAliases(database, "scaleway").length, 1);
    assert.deepEqual(
      listProjects(database).find((project) => project.name === "scaleway")
        ?.aliases,
      ["SC"],
    );

    await rm(scaleway, { recursive: true, force: true });
    const diagnostics = reconcileProjectIdentities(database, "codex-local");
    assert.ok(
      diagnostics.some(
        (diagnostic) => diagnostic.code === "project-path-unavailable",
      ),
    );
    assert.equal(listProjectAliases(database, "scaleway")[0]?.alias, "SC");
    assert.equal(removeProjectAlias(database, "SC"), true);
    assert.equal(removeProjectAlias(database, "SC"), false);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("separator-insensitive project identity and content calibration remain stable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-project-ranking-"));
  const shipReady = join(directory, "ship-ready");
  const content = join(directory, "content");
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    await mkdir(shipReady, { recursive: true });
    await mkdir(content, { recursive: true });
    insertSyntheticThread(
      database,
      thread(520, "Implement release checks", shipReady),
    );
    insertSyntheticThread(
      database,
      thread(521, "Recent notes", content, "shipready appeared once"),
    );
    reconcileProjectIdentities(database, "codex-local");

    for (const query of ["shipready", "ship-ready"]) {
      const result = findResumableTargets(database, { query });
      assert.equal(result.targets[0]?.title, "Implement release checks");
      assert.equal(result.targets[0]?.confidence, "high");
      assert.ok(
        result.targets[0]?.signals.some(
          (signal) => signal.type === "project-identity-match",
        ),
      );
      const contentOnly = result.targets.find(
        (target) => target.title === "Recent notes",
      );
      if (contentOnly) assert.notEqual(contentOnly.confidence, "high");
    }
    const repeated = findResumableTargets(database, { query: "shipready" });
    assert.deepEqual(
      findResumableTargets(database, {
        query: "shipready",
        clock: () => new Date(repeated.generatedAt),
      }).targets,
      repeated.targets,
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("project paths and observations never persist a raw home prefix", async () => {
  const directory = await mkdtemp(join(homedir(), ".worktrail-project-test-"));
  const projectPath = join(directory, "private-project");
  const database = new WorktrailDatabase(join(directory, "worktrail.db"));
  try {
    await mkdir(projectPath, { recursive: true });
    insertSyntheticThread(
      database,
      thread(530, "Private project", projectPath),
    );
    reconcileProjectIdentities(database, "codex-local");
    const serialized = JSON.stringify(listProjects(database));
    assert.equal(serialized.includes(homedir()), false);
    assert.match(listProjects(database)[0]?.displayPath ?? "", /^~\//u);
    const rawIdentityValues = database.raw
      .prepare(
        `SELECT p.opaque_key, p.display_path, o.display_value
         FROM project_identities p
         JOIN project_identity_observations o ON o.project_id = p.id`,
      )
      .all();
    assert.equal(JSON.stringify(rawIdentityValues).includes(homedir()), false);
    assert.equal(JSON.stringify(rawIdentityValues).includes("remote"), false);
    assert.equal(
      JSON.stringify(rawIdentityValues).includes("transcript"),
      false,
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("project alias CLI requires an explicit write guard and supports JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worktrail-project-cli-"));
  const projectPath = join(directory, "scaleway");
  const dbPath = join(directory, "worktrail.db");
  const database = new WorktrailDatabase(dbPath);
  try {
    await mkdir(projectPath, { recursive: true });
    insertSyntheticThread(database, thread(540, "SC | Review", projectPath));
    reconcileProjectIdentities(database, "codex-local");
    database.close();

    const blocked = spawnSync(
      cli,
      [
        "src/cli.ts",
        "projects",
        "aliases",
        "add",
        "scaleway",
        "SC",
        "--db",
        dbPath,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /--allow-write/u);

    const added = spawnSync(
      cli,
      [
        "src/cli.ts",
        "projects",
        "aliases",
        "add",
        "scaleway",
        "SC",
        "--allow-write",
        "--db",
        dbPath,
        "--json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(added.status, 0, added.stderr);
    assert.equal(JSON.parse(added.stdout).alias.alias, "SC");

    const listed = spawnSync(
      cli,
      ["src/cli.ts", "projects", "aliases", "list", "--db", dbPath, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).aliases[0].alias, "SC");

    const removed = spawnSync(
      cli,
      [
        "src/cli.ts",
        "projects",
        "aliases",
        "remove",
        "SC",
        "--allow-write",
        "--db",
        dbPath,
        "--json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(JSON.parse(removed.stdout).changed, true);
  } finally {
    try {
      database.close();
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});

function resolveProject(path: string) {
  const result = resolveProjectIdentity({
    sourceThreadId: 1,
    adapterId: "codex-local",
    rawCwd: path,
    observedAt: "2026-06-22T10:00:00.000Z",
  });
  assert.ok(result);
  return result;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function thread(number: number, title: string, cwd: string, evidence = title) {
  return {
    externalId: syntheticId(number),
    title,
    cwd,
    updatedAt: `2026-06-${String(Math.min(20, number - 490)).padStart(2, "0")}T12:00:00.000Z`,
    evidence: [evidence],
    files: [],
  };
}
