import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  buildWorktrailInvocation,
  debugCommandFromError,
  formatDebugCommand,
  sanitizeErrorMessage,
  searchWorktrail,
} from "../src/client.js";
import {
  parseResumeSearchResult,
  ResumeCompatibilityError,
} from "../src/contract.js";
import { deriveTargetDisplay, selectCopyCommand } from "../src/display.js";
import {
  PNPM_RESOLUTION_ERROR_MESSAGE,
  PnpmResolutionError,
  pnpmExecutionEnvironment,
  resolvePnpmExecutable,
} from "../src/pnpm.js";
import {
  expandFilesystemPreferencePath,
  homeNormalizePath,
  resolveOptionalDatabasePath,
  resolveWorktrailProjectPath,
} from "../src/paths.js";
import type { ResumableTarget } from "../src/types.js";

const target: ResumableTarget = {
  kind: "run",
  title: "Fast Resume",
  resumeRef: "0197f0de-1111-7000-8000-000000000001",
  resumeCommand: "codex resume 0197f0de-1111-7000-8000-000000000001",
  command: {
    program: "codex",
    args: ["resume", "0197f0de-1111-7000-8000-000000000001"],
  },
  lastActivity: "2026-06-20T10:00:00.000Z",
  sourceTool: "codex",
  confidence: "high",
  score: 0.95,
  scoreVersion: 1,
  signals: [{ type: "title-match", label: "Title matched fast" }],
  relatedFiles: ["src/resume.ts"],
  relatedRuns: [
    {
      sourceId: "source-1",
      title: "Fast Resume",
      resumeRef: "0197f0de-1111-7000-8000-000000000001",
      lastActivity: "2026-06-20T10:00:00.000Z",
    },
  ],
  openActions: [
    {
      kind: "copy-command",
      label: "Copy Codex resume command",
      value: "codex resume 0197f0de-1111-7000-8000-000000000001",
    },
  ],
  evidenceAvailable: true,
};

function response(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    query: "fast resume",
    generatedAt: "2026-06-20T10:01:00.000Z",
    limit: 5,
    targets: [target],
    diagnostics: [],
    ...overrides,
  };
}

async function withFakeExecution(
  t: TestContext,
  execute: (program: string, args: string[], cwd: string) => Promise<string>,
  query = "github profile",
) {
  const homeDirectory = await mkdtemp(join(tmpdir(), "worktrail-raycast-"));
  t.after(() => rm(homeDirectory, { recursive: true, force: true }));
  const projectPath = join(homeDirectory, "Documents", "worktrail");
  await mkdir(projectPath, { recursive: true });
  await writeFile(
    join(projectPath, "package.json"),
    JSON.stringify({ name: "worktrail" }),
  );
  return searchWorktrail(
    query,
    {
      worktrailProjectPath: "~/Documents/worktrail",
      resultLimit: "5",
      includeArchived: false,
    },
    undefined,
    {
      execute,
      homeDirectory,
      resolvePnpmExecutable: async () => "/opt/homebrew/bin/pnpm",
    },
  );
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("Expected the promise to reject.");
}

test("parses a valid ResumeSearchResult v1", () => {
  assert.deepEqual(parseResumeSearchResult(response()), response());
});

test("rejects an unsupported schema version", () => {
  assert.throws(
    () => parseResumeSearchResult(response({ schemaVersion: 2 })),
    ResumeCompatibilityError,
  );
});

test("rejects an invalid target instead of guessing", () => {
  assert.throws(
    () =>
      parseResumeSearchResult(
        response({ targets: [{ ...target, confidence: "certain" }] }),
      ),
    /targets\[0\]\.confidence/,
  );
});

test("derives compact display metadata", () => {
  const display = deriveTargetDisplay(target);
  assert.equal(display.kind, "Run");
  assert.equal(display.confidence, "High confidence");
  assert.match(display.subtitle, /^High confidence · Run · /);
  assert.deepEqual(display.relatedFiles, ["src/resume.ts"]);
  assert.equal(display.resumable, true);
});

test("selects a declared copy-command action", () => {
  assert.equal(selectCopyCommand(target), target.openActions[0]);
  assert.equal(
    selectCopyCommand({
      ...target,
      resumeCommand: undefined,
      openActions: [{ kind: "copy-id", label: "Copy ID", value: "source-1" }],
    }),
    undefined,
  );
});

test("builds an argument-safe pnpm invocation", () => {
  const invocation = buildWorktrailInvocation("safe apply; echo nope", {
    worktrailProjectPath: "/tmp/worktrail project",
    databasePath: "/tmp/worktrail.db",
    resultLimit: "5",
    includeArchived: true,
  });
  assert.equal(invocation.program, "pnpm");
  assert.deepEqual(invocation.args, [
    "--silent",
    "--dir",
    "/tmp/worktrail project",
    "worktrail",
    "resume",
    "safe apply; echo nope",
    "--json",
    "--limit",
    "5",
    "--db",
    "/tmp/worktrail.db",
    "--include-archived",
  ]);
});

test("expands supported filesystem preference paths", () => {
  const homeDirectory = "/Users/example";

  assert.equal(
    expandFilesystemPreferencePath("~", homeDirectory),
    homeDirectory,
  );
  assert.equal(
    expandFilesystemPreferencePath("~/Documents/worktrail", homeDirectory),
    "/Users/example/Documents/worktrail",
  );
  assert.equal(
    expandFilesystemPreferencePath("/Volumes/code/worktrail", homeDirectory),
    "/Volumes/code/worktrail",
  );
  assert.throws(
    () => expandFilesystemPreferencePath("~otheruser/worktrail", homeDirectory),
    /Only ~ and ~\/\.\.\./,
  );
});

test("home-normalizes displayed paths", () => {
  const homeDirectory = "/Users/private";

  assert.equal(homeNormalizePath(homeDirectory, homeDirectory), "~/");
  assert.equal(
    homeNormalizePath("/Users/private/Documents/worktrail", homeDirectory),
    "~/Documents/worktrail",
  );
});

test("validates a Worktrail repository configured as the home directory", async (t) => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "worktrail-home-"));
  t.after(() => rm(homeDirectory, { recursive: true, force: true }));
  await writeFile(
    join(homeDirectory, "package.json"),
    JSON.stringify({ name: "worktrail" }),
  );

  assert.equal(
    await resolveWorktrailProjectPath("~", homeDirectory),
    homeDirectory,
  );
});

test("rejects an invalid project path before resolving or spawning pnpm", async () => {
  let resolutionCalls = 0;
  let executionCalls = 0;

  await assert.rejects(
    searchWorktrail(
      "github profile",
      {
        worktrailProjectPath: "~/missing-worktrail",
        resultLimit: "5",
        includeArchived: false,
      },
      undefined,
      {
        homeDirectory: "/Users/private",
        resolvePnpmExecutable: async () => {
          resolutionCalls += 1;
          return "/opt/homebrew/bin/pnpm";
        },
        execute: async () => {
          executionCalls += 1;
          return "";
        },
      },
    ),
    (error: unknown) => {
      const message = sanitizeErrorMessage(error);
      assert.match(message, /^Worktrail project path is invalid\./);
      assert.match(message, /~\/missing-worktrail/);
      assert.match(message, /containing Worktrail’s package\.json/);
      assert.doesNotMatch(message, /\/Users\/private/);
      return true;
    },
  );

  assert.equal(resolutionCalls, 0);
  assert.equal(executionCalls, 0);
});

test("resolves project and database paths before argument-safe execution", async (t) => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "worktrail-raycast-"));
  t.after(() => rm(homeDirectory, { recursive: true, force: true }));
  const projectPath = join(homeDirectory, "Documents", "worktrail");
  await mkdir(projectPath, { recursive: true });
  await writeFile(
    join(projectPath, "package.json"),
    JSON.stringify({
      name: "worktrail",
      scripts: { worktrail: "tsx src/cli.ts" },
    }),
  );
  const databasePath = join(
    homeDirectory,
    "Library",
    "Application Support",
    "worktrail.db",
  );
  await mkdir(join(homeDirectory, "Library", "Application Support"), {
    recursive: true,
  });
  await writeFile(databasePath, "sqlite fixture");

  const query = "profile github; $(echo nope)";
  let execution: { program: string; args: string[]; cwd: string } | undefined;
  const result = await searchWorktrail(
    query,
    {
      worktrailProjectPath: "~/Documents/worktrail",
      databasePath: "~/Library/Application Support/worktrail.db",
      resultLimit: "5",
      includeArchived: false,
    },
    undefined,
    {
      homeDirectory,
      resolvePnpmExecutable: async () => "/opt/homebrew/bin/pnpm",
      execute: async (program, args, cwd) => {
        execution = { program, args, cwd };
        return JSON.stringify(response({ query }));
      },
    },
  );

  assert.equal(result.query, query);
  assert.ok(execution);
  assert.equal(execution.program, "/opt/homebrew/bin/pnpm");
  assert.equal(execution.cwd, projectPath);
  assert.deepEqual(execution.args.slice(0, 4), [
    "--silent",
    "--dir",
    projectPath,
    "worktrail",
  ]);
  assert.equal(execution.args[5], query);
  assert.deepEqual(execution.args.slice(-2), [
    "--db",
    join(homeDirectory, "Library", "Application Support", "worktrail.db"),
  ]);
  assert.equal(execution.args.includes("~"), false);
});

test("expands and validates an optional database path", async (t) => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "worktrail-db-home-"));
  t.after(() => rm(homeDirectory, { recursive: true, force: true }));
  const databasePath = join(
    homeDirectory,
    "Library",
    "Application Support",
    "worktrail.db",
  );
  await mkdir(join(homeDirectory, "Library", "Application Support"), {
    recursive: true,
  });
  await writeFile(databasePath, "sqlite fixture");

  assert.equal(
    await resolveOptionalDatabasePath(
      "~/Library/Application Support/worktrail.db",
      homeDirectory,
    ),
    databasePath,
  );
  assert.equal(
    await resolveOptionalDatabasePath("  ", homeDirectory),
    undefined,
  );
});

test("rejects an invalid database path before resolving or spawning pnpm", async (t) => {
  let resolutionCalls = 0;
  let executionCalls = 0;
  const homeDirectory = await mkdtemp(join(tmpdir(), "worktrail-raycast-"));
  t.after(() => rm(homeDirectory, { recursive: true, force: true }));
  const projectPath = join(homeDirectory, "Documents", "worktrail");
  await mkdir(projectPath, { recursive: true });
  await writeFile(
    join(projectPath, "package.json"),
    JSON.stringify({ name: "worktrail" }),
  );

  const error = await captureError(
    searchWorktrail(
      "github profile",
      {
        worktrailProjectPath: "~/Documents/worktrail",
        databasePath: "~/.worktrail/missing.db",
        resultLimit: "5",
        includeArchived: false,
      },
      undefined,
      {
        homeDirectory,
        resolvePnpmExecutable: async () => {
          resolutionCalls += 1;
          return "/opt/homebrew/bin/pnpm";
        },
        execute: async () => {
          executionCalls += 1;
          return "";
        },
      },
    ),
  );

  assert.match(sanitizeErrorMessage(error), /^Database path is invalid\./);
  assert.match(sanitizeErrorMessage(error), /~\/\.worktrail\/missing\.db/);
  assert.doesNotMatch(sanitizeErrorMessage(error), new RegExp(homeDirectory));
  assert.equal(resolutionCalls, 0);
  assert.equal(executionCalls, 0);
});

test("reports unsupported other-user project paths clearly", async () => {
  await assert.rejects(
    resolveWorktrailProjectPath(
      "~otheruser/Documents/worktrail",
      "/Users/private",
    ),
    (error: unknown) => {
      const message = sanitizeErrorMessage(error);
      assert.match(message, /Only ~ and ~\/\.\.\. home-relative paths/);
      assert.match(message, /~otheruser\/Documents\/worktrail/);
      assert.doesNotMatch(message, /\/Users\/private/);
      return true;
    },
  );
});

test("uses the explicit pnpm executable preference first", async () => {
  const checked: string[] = [];
  const executable = await resolvePnpmExecutable(" /custom/bin/pnpm ", {
    environmentPath: "/raycast/bin",
    homeDirectory: "/Users/example",
    isExecutable: async (path) => {
      checked.push(path);
      return path === "/custom/bin/pnpm";
    },
  });

  assert.equal(executable, "/custom/bin/pnpm");
  assert.deepEqual(checked, ["/custom/bin/pnpm"]);
});

test("uses bare pnpm when it is available on Raycast's PATH", async () => {
  const executable = await resolvePnpmExecutable(undefined, {
    environmentPath: "/raycast/bin:/usr/bin",
    homeDirectory: "/Users/example",
    isExecutable: async (path) => path === "/raycast/bin/pnpm",
  });

  assert.equal(executable, "pnpm");
});

test("falls back to a common absolute pnpm path", async () => {
  const checked: string[] = [];
  const executable = await resolvePnpmExecutable(undefined, {
    environmentPath: "/raycast/bin",
    homeDirectory: "/Users/example",
    isExecutable: async (path) => {
      checked.push(path);
      return path === "/Users/example/Library/pnpm/pnpm";
    },
  });

  assert.equal(executable, "/Users/example/Library/pnpm/pnpm");
  assert.deepEqual(checked, [
    "/raycast/bin/pnpm",
    "/opt/homebrew/bin/pnpm",
    "/usr/local/bin/pnpm",
    "/Users/example/Library/pnpm/pnpm",
  ]);
});

test("makes Node available to an absolute pnpm launcher", () => {
  const environment = pnpmExecutionEnvironment(
    "/opt/homebrew/bin/pnpm",
    { PATH: "/usr/bin:/bin", WORKTRAIL_TEST: "true" },
    "/Applications/Raycast.app/Contents/Resources/node",
    "/Users/example",
  );

  assert.equal(
    environment.PATH,
    "/opt/homebrew/bin:/Applications/Raycast.app/Contents/Resources:/usr/bin:/bin:/usr/local/bin:/usr/sbin:/sbin",
  );
  assert.equal(environment.WORKTRAIL_TEST, "true");
  assert.equal(environment.HOME, "/Users/example");
});

test("adds standard macOS paths to a reduced Raycast environment", () => {
  const environment = pnpmExecutionEnvironment(
    "/opt/homebrew/bin/pnpm",
    { PATH: "/raycast/bin" },
    "/Applications/Raycast.app/Contents/Resources/node",
    "/Users/example",
  );

  assert.equal(
    environment.PATH,
    "/opt/homebrew/bin:/Applications/Raycast.app/Contents/Resources:/raycast/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  );
});

test("reports actionable guidance when pnpm cannot be resolved", async () => {
  await assert.rejects(
    resolvePnpmExecutable(undefined, {
      environmentPath: "/raycast/bin",
      homeDirectory: "/Users/example",
      isExecutable: async () => false,
    }),
    (error: unknown) => {
      assert.ok(error instanceof PnpmResolutionError);
      assert.equal(error.message, PNPM_RESOLUTION_ERROR_MESSAGE);
      return true;
    },
  );

  assert.equal(
    sanitizeErrorMessage(
      Object.assign(new Error("spawn pnpm ENOENT"), {
        code: "ENOENT",
      }),
    ),
    PNPM_RESOLUTION_ERROR_MESSAGE,
  );
});

test("reports exit code with bounded sanitized stderr and a debug command", async (t) => {
  const error = await captureError(
    withFakeExecution(t, async () => {
      throw Object.assign(new Error("command failed"), {
        code: 7,
        stderr: `worktrail: unable to read /Users/private/Documents/worktrail at https://user:secret@example.com/repo ${"detail ".repeat(80)}\nstack omitted`,
        stdout: "ignored stdout",
      });
    }),
  );
  const message = sanitizeErrorMessage(error, [
    "/Users/private/Documents/worktrail",
  ]);

  assert.match(message, /^Worktrail CLI exited with code 7\./);
  assert.match(message, /stderr: unable to read ~/);
  assert.match(message, /https:\/\/\[credentials\]@example\.com\/repo/);
  assert.match(message, /Command: \/opt\/homebrew\/bin\/pnpm --silent/);
  assert.match(message, /--dir "\$HOME\/Documents\/worktrail"/);
  assert.ok(message.length <= 720);
  assert.doesNotMatch(message, /secret|stack omitted|ignored stdout/);
  assert.match(debugCommandFromError(error) ?? "", /'github profile'/);
});

test("uses bounded stdout when stderr is empty", async (t) => {
  const error = await captureError(
    withFakeExecution(t, async () => {
      throw Object.assign(new Error("command failed"), {
        code: 2,
        stderr: "",
        stdout:
          "worktrail: database unavailable at /Users/private/.worktrail/worktrail.db\nadditional output omitted",
      });
    }),
  );
  const message = sanitizeErrorMessage(error);

  assert.match(message, /^Worktrail CLI exited with code 2\./);
  assert.match(
    message,
    /stdout: database unavailable at ~\/\.worktrail\/worktrail\.db/,
  );
  assert.doesNotMatch(message, /additional output omitted/);
});

test("reports invalid JSON without treating stderr warnings as JSON", async (t) => {
  const error = await captureError(
    withFakeExecution(
      t,
      async () => "ExperimentalWarning: SQLite is experimental\n{not-json}",
    ),
  );
  const message = sanitizeErrorMessage(error);

  assert.match(message, /^Worktrail returned invalid JSON on stdout\./);
  assert.match(message, /warnings on stderr are safe/);
  assert.ok(debugCommandFromError(error));
});

test("reports response schema mismatch", async (t) => {
  const error = await captureError(
    withFakeExecution(t, async () =>
      JSON.stringify(
        response({ targets: [{ ...target, confidence: "certain" }] }),
      ),
    ),
  );
  const message = sanitizeErrorMessage(error);

  assert.match(message, /^Worktrail response schema mismatch\./);
  assert.match(message, /targets\[0\]\.confidence/);
  assert.ok(debugCommandFromError(error));
});

test("reports unsupported schema version separately", async (t) => {
  const error = await captureError(
    withFakeExecution(t, async () =>
      JSON.stringify(response({ schemaVersion: 2 })),
    ),
  );

  assert.match(
    sanitizeErrorMessage(error),
    /^Worktrail response schema version mismatch\./,
  );
});

test("reports timeout separately with a debug command", async (t) => {
  const error = await captureError(
    withFakeExecution(t, async () => {
      throw Object.assign(new Error("timed out"), {
        code: "ETIMEDOUT",
        killed: true,
      });
    }),
  );

  assert.match(
    sanitizeErrorMessage(error),
    /^Worktrail search timed out after 15 seconds\./,
  );
  assert.ok(debugCommandFromError(error));
});

test("classifies an unknown exception without exposing multiple lines", () => {
  assert.equal(
    sanitizeErrorMessage(
      new Error("unexpected internal failure\nprivate stack line"),
    ),
    "Unexpected Worktrail search failure. unexpected internal failure",
  );
});

test("formats a home-normalized shell-safe debug command", () => {
  const command = formatDebugCommand(
    buildWorktrailInvocation(
      "github profile; echo nope",
      {
        worktrailProjectPath: "/Users/private/Documents/worktrail",
        databasePath: "/Users/private/.worktrail/worktrail.db",
        resultLimit: "5",
        includeArchived: false,
      },
      "/opt/homebrew/bin/pnpm",
    ),
    "/Users/private",
  );

  assert.equal(
    command,
    `/opt/homebrew/bin/pnpm --silent --dir "$HOME/Documents/worktrail" worktrail resume 'github profile; echo nope' --json --limit 5 --db "$HOME/.worktrail/worktrail.db"`,
  );
  assert.doesNotMatch(command, /\/Users\/private/);
});
