import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSnippet } from "./snippet.js";

test("returns the whole text without ellipsis when it fits in the window", () => {
  const text = "the bug is in the session refresh logic";
  const snippet = extractSnippet(text, 4, 3);
  assert.equal(snippet.text, text);
  assert.equal(snippet.matchOffset, 4);
  assert.equal(snippet.matchLength, 3);
  assert.equal(snippet.text.slice(snippet.matchOffset, snippet.matchOffset + snippet.matchLength), "bug");
});

test("adds a leading ellipsis and shifts the match offset accordingly", () => {
  const text = "x".repeat(200) + "TARGET" + "y".repeat(10);
  const snippet = extractSnippet(text, 200, 6);
  assert.equal(snippet.text.startsWith("…"), true);
  assert.equal(snippet.text.slice(snippet.matchOffset, snippet.matchOffset + snippet.matchLength), "TARGET");
});

test("adds a trailing ellipsis when the window ends before the text ends", () => {
  const text = "x".repeat(10) + "TARGET" + "y".repeat(200);
  const snippet = extractSnippet(text, 10, 6);
  assert.equal(snippet.text.endsWith("…"), true);
  assert.equal(snippet.text.slice(snippet.matchOffset, snippet.matchOffset + snippet.matchLength), "TARGET");
});
