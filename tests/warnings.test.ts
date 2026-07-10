import assert from "node:assert/strict";
import test from "node:test";

import {
  installSqliteWarningFilter,
  shouldSuppressWarning,
} from "../src/warnings.js";

test("SQLite warning filter matches only the known experimental warning", () => {
  assert.equal(
    shouldSuppressWarning(
      "SQLite is an experimental feature and might change at any time",
      "ExperimentalWarning",
    ),
    true,
  );
  assert.equal(
    shouldSuppressWarning(
      "A different experimental API",
      "ExperimentalWarning",
    ),
    false,
  );
  assert.equal(
    shouldSuppressWarning("SQLite failed to open", "Warning"),
    false,
  );
});

test("SQLite warning filter forwards unrelated warnings", () => {
  const original = process.emitWarning;
  const forwarded: unknown[][] = [];
  process.emitWarning = ((...args: unknown[]) => {
    forwarded.push(args);
  }) as typeof process.emitWarning;

  try {
    installSqliteWarningFilter();
    process.emitWarning("unrelated warning", "Warning");
    process.emitWarning(
      "SQLite is an experimental feature and might change at any time",
      "ExperimentalWarning",
    );
    assert.deepEqual(forwarded, [["unrelated warning", "Warning"]]);
  } finally {
    process.emitWarning = original;
  }
});
