import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArguments } from "./arguments.js";

test("parses a plain query with defaults", () => {
  const result = parseArguments(["error autenticación"]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.args.query, "error autenticación");
    assert.equal(result.args.useRegex, false);
    assert.equal(result.args.fixed, false);
    assert.equal(result.args.agent, null);
    assert.equal(result.args.cwd, null);
    assert.equal(result.args.showPreview, true);
    assert.equal(result.args.pageSize, undefined);
  }
});

test("--help and --version short-circuit without requiring a query", () => {
  const help = parseArguments(["-h"]);
  assert.equal(help.ok, true);
  if (help.ok) assert.equal(help.args.help, true);

  const version = parseArguments(["--version"]);
  assert.equal(version.ok, true);
  if (version.ok) assert.equal(version.args.version, true);
});

test("parses short and long flag aliases", () => {
  const result = parseArguments(["ERR_[0-9]{4}", "-r", "-s", "-a", "codex"]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.args.useRegex, true);
    assert.equal(result.args.caseSensitive, true);
    assert.equal(result.args.agent, "codex");
  }
});

test("-F sets fixed mode and -p/-c set path and cwd", () => {
  const result = parseArguments(["precio final", "-F", "-p", "~/projects/store", "-c", "current"]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.args.fixed, true);
    assert.equal(result.args.path, "~/projects/store");
    assert.equal(result.args.cwd, "current");
  }
});

test("rejects an invalid --agent value", () => {
  const result = parseArguments(["query", "--agent", "copilot"]);
  assert.equal(result.ok, false);
});

test("rejects --case-sensitive without --regex", () => {
  const result = parseArguments(["query", "--case-sensitive"]);
  assert.equal(result.ok, false);
});

test("accepts --cwd original so a configured default of current can be overridden", () => {
  const result = parseArguments(["query", "--cwd", "original"]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.args.cwd, "original");
});

test("rejects an invalid --cwd value", () => {
  const result = parseArguments(["query", "--cwd", "somewhere"]);
  assert.equal(result.ok, false);
});

test("rejects a --page-size below the minimum of 5", () => {
  const result = parseArguments(["query", "--page-size", "3"]);
  assert.equal(result.ok, false);
});

test("accepts a valid --page-size", () => {
  const result = parseArguments(["query", "--page-size", "10"]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.args.pageSize, 10);
});

test("--no-preview disables the preview flag", () => {
  const result = parseArguments(["query", "--no-preview"]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.args.showPreview, false);
});

test("rejects a missing query", () => {
  const result = parseArguments([]);
  assert.equal(result.ok, false);
});

test("rejects more than one positional argument", () => {
  const result = parseArguments(["first", "second"]);
  assert.equal(result.ok, false);
});

test("rejects an unknown flag", () => {
  const result = parseArguments(["query", "--not-a-real-flag"]);
  assert.equal(result.ok, false);
});
