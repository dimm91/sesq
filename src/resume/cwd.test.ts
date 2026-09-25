import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionRecord } from "../sessions/model.js";
import { resolveResumeCwd } from "./cwd.js";

function makeSession(cwd: string | null): SessionRecord {
  return {
    id: "s1",
    agent: "codex",
    title: null,
    cwd,
    createdAt: null,
    modifiedAt: new Date(),
    archived: null,
    messages: [],
    sourcePath: "irrelevant",
  };
}

test('"current" mode always resolves to the current working directory', () => {
  const result = resolveResumeCwd(makeSession("/original/path"), "current", {
    exists: () => true,
    currentCwd: () => "/current/path",
  });
  assert.deepEqual(result, { status: "resolved", cwd: "/current/path" });
});

test("resolves to the original folder when it exists", () => {
  const result = resolveResumeCwd(makeSession("/original/path"), "original", {
    exists: (p) => p === "/original/path",
    currentCwd: () => "/current/path",
  });
  assert.deepEqual(result, { status: "resolved", cwd: "/original/path" });
});

test("reports missing-original when the original folder no longer exists", () => {
  const result = resolveResumeCwd(makeSession("/gone"), "original", {
    exists: () => false,
    currentCwd: () => "/current/path",
  });
  assert.deepEqual(result, { status: "missing-original", originalCwd: "/gone" });
});

test("falls back to the current folder when no original cwd is known at all", () => {
  const result = resolveResumeCwd(makeSession(null), "original", {
    exists: () => false,
    currentCwd: () => "/current/path",
  });
  assert.deepEqual(result, { status: "resolved", cwd: "/current/path" });
});
