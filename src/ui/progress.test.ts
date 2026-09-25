import assert from "node:assert/strict";
import { test } from "node:test";
import { formatProgressLine, formatSummaryLine } from "./progress.js";

test("formatProgressLine reports a running count per agent", () => {
  const line = formatProgressLine([
    { agent: "Codex", count: 320 },
    { agent: "Claude", count: 180 },
  ]);
  assert.equal(line, "Searching: Codex 320 · Claude 180");
});

test("formatSummaryLine pluralizes sessions and results correctly", () => {
  assert.equal(formatSummaryLine({ sessionsScanned: 1, matches: 1, unreadable: 0 }), "1 session scanned · 1 result");
  assert.equal(
    formatSummaryLine({ sessionsScanned: 1440, matches: 18, unreadable: 0 }),
    "1440 sessions scanned · 18 results",
  );
});

test("formatSummaryLine appends the unreadable file count when present", () => {
  assert.equal(
    formatSummaryLine({ sessionsScanned: 10, matches: 2, unreadable: 2 }),
    "10 sessions scanned · 2 results · 2 unreadable files",
  );
  assert.equal(
    formatSummaryLine({ sessionsScanned: 10, matches: 2, unreadable: 1 }),
    "10 sessions scanned · 2 results · 1 unreadable file",
  );
});
