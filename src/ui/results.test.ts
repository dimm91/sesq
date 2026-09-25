import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchMatch } from "../search/engine.js";
import type { SessionRecord } from "../sessions/model.js";
import { formatResult } from "./results.js";

function makeMatch(overrides: Partial<SessionRecord> = {}, matchOverrides: Partial<SearchMatch> = {}): SearchMatch {
  const session: SessionRecord = {
    id: "abc",
    agent: "codex",
    title: "Fix authentication",
    cwd: "/Users/alex/projects/store",
    createdAt: null,
    modifiedAt: new Date("2026-09-24T18:42:00.000Z"),
    archived: false,
    messages: [],
    sourcePath: "irrelevant",
    ...overrides,
  };
  return {
    session,
    matchCount: 7,
    matchedField: "response",
    snippet: { text: "the error occurs before validating the token", matchOffset: 4, matchLength: 5 },
    ...matchOverrides,
  };
}

test("includes agent, title, folder, matched field and match count", () => {
  const text = formatResult(6, makeMatch(), { color: false, showPreview: true });
  assert.match(text, /^6\./);
  assert.match(text, /Agent:\s+Codex/);
  assert.match(text, /Title:\s+Fix authentication/);
  assert.match(text, /Folder:\s+\/Users\/alex\/projects\/store/);
  assert.match(text, /Matched in:\s+Response/);
  assert.match(text, /Matches:\s+7/);
});

test("names the session id when that is where the match was found", () => {
  const text = formatResult(1, makeMatch({}, { matchedField: "id" }), { color: false, showPreview: true });
  assert.match(text, /Matched in:\s+Session ID/);
});

test("tags archived sessions", () => {
  const text = formatResult(1, makeMatch({ archived: true }), { color: false, showPreview: true });
  assert.match(text, /^1\. \[ARCHIVED\]/);
});

test("does not tag non-archived or unknown-archival sessions", () => {
  assert.doesNotMatch(formatResult(1, makeMatch({ archived: false }), { color: false, showPreview: true }), /\[ARCHIVED\]/);
  assert.doesNotMatch(formatResult(1, makeMatch({ archived: null }), { color: false, showPreview: true }), /\[ARCHIVED\]/);
});

test("falls back to Untitled and Not available when missing", () => {
  const text = formatResult(1, makeMatch({ title: null, cwd: null }), { color: false, showPreview: true });
  assert.match(text, /Title:\s+Untitled/);
  assert.match(text, /Folder:\s+Not available/);
});

test("hides the snippet when showPreview is false", () => {
  const text = formatResult(1, makeMatch(), { color: false, showPreview: false });
  assert.match(text, /Snippet:\s+Hidden/);
  assert.doesNotMatch(text, /the error occurs/);
});

test("highlights the match with ANSI codes only when color is enabled", () => {
  const withColor = formatResult(1, makeMatch(), { color: true, showPreview: true });
  const withoutColor = formatResult(1, makeMatch(), { color: false, showPreview: true });

  assert.match(withColor, /\x1b\[1merror\x1b\[0m/);
  assert.doesNotMatch(withoutColor, /\x1b\[/);
  assert.match(withoutColor, /the error occurs before validating the token/);
});

test("collapses newlines and tabs in the snippet to keep the layout on one line", () => {
  const text = formatResult(
    1,
    makeMatch({}, { snippet: { text: "line one\nline two\tindented", matchOffset: 0, matchLength: 4 } }),
    { color: false, showPreview: true },
  );
  assert.match(text, /Snippet:\s+line one line two indented/);
  assert.doesNotMatch(text, /\n {3}line two/);
});

test("shows (none) when there is no snippet to preview", () => {
  const text = formatResult(1, makeMatch({}, { snippet: null }), { color: false, showPreview: true });
  assert.match(text, /Snippet:\s+\(none\)/);
});
