import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionRecord } from "../sessions/model.js";
import { formatMissingFolderPrompt, formatResumeConfirmation, formatUnarchiveConfirmation, parseYesNo } from "./confirm.js";

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "s1",
    agent: "claude",
    title: "Fix login form",
    cwd: "/Users/alex/projects/store",
    createdAt: null,
    modifiedAt: new Date(),
    archived: null,
    messages: [],
    sourcePath: "irrelevant",
    ...overrides,
  };
}

test("formatResumeConfirmation shows agent, title, folder and defaults to No", () => {
  const text = formatResumeConfirmation(makeSession());
  assert.match(text, /Agent:\s+Claude Code/);
  assert.match(text, /Title:\s+Fix login form/);
  assert.match(text, /Folder:\s+\/Users\/alex\/projects\/store/);
  assert.match(text, /\[y\/N\]/);
});

test("formatResumeConfirmation falls back for missing title and folder", () => {
  const text = formatResumeConfirmation(makeSession({ title: null, cwd: null }));
  assert.match(text, /Title:\s+Untitled/);
  assert.match(text, /Folder:\s+Not available/);
});

test("formatUnarchiveConfirmation mentions Codex and archival", () => {
  assert.match(formatUnarchiveConfirmation(), /archived/i);
  assert.match(formatUnarchiveConfirmation(), /Codex/);
});

test("formatMissingFolderPrompt lists the three options and the original path", () => {
  const text = formatMissingFolderPrompt("/gone/path");
  assert.match(text, /\/gone\/path/);
  assert.match(text, /\[1\] Use the current folder/);
  assert.match(text, /\[2\] Choose another folder/);
  assert.match(text, /\[3\] Cancel/);
});

test("parseYesNo only accepts y/yes, defaulting everything else to No", () => {
  assert.equal(parseYesNo("y"), true);
  assert.equal(parseYesNo("Y"), true);
  assert.equal(parseYesNo("yes"), true);
  assert.equal(parseYesNo(""), false);
  assert.equal(parseYesNo("n"), false);
  assert.equal(parseYesNo("no"), false);
  assert.equal(parseYesNo("sure"), false);
});
