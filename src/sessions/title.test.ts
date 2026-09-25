import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveFallbackTitle } from "./title.js";
import type { SessionMessage } from "./model.js";

function userMessage(content: string): SessionMessage {
  return { role: "user", content, timestamp: null };
}

test("returns null when there are no user messages", () => {
  assert.equal(deriveFallbackTitle([]), null);
  assert.equal(deriveFallbackTitle([{ role: "assistant", content: "hi", timestamp: null }]), null);
});

test("uses the first line of the first user message unchanged when short", () => {
  const title = deriveFallbackTitle([userMessage("fix the login bug\nmore details here")]);
  assert.equal(title, "fix the login bug");
});

test("truncates long first lines to 60 characters with an ellipsis", () => {
  const longLine = "a".repeat(80);
  const title = deriveFallbackTitle([userMessage(longLine)]);
  assert.equal(title, `${"a".repeat(60)}…`);
});

test("returns null when the first user message is blank", () => {
  assert.equal(deriveFallbackTitle([userMessage("   \n more text")]), null);
});
