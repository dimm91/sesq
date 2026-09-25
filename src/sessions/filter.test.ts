import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchMatch } from "../search/engine.js";
import type { SessionRecord } from "./model.js";
import { filterByPath, filterBySince, parseSinceDuration } from "./filter.js";

function makeMatch(id: string, modifiedAt: string, cwd: string | null): SearchMatch {
  const session: SessionRecord = {
    id,
    agent: "codex",
    title: null,
    cwd,
    createdAt: null,
    modifiedAt: new Date(modifiedAt),
    archived: null,
    messages: [],
    sourcePath: "irrelevant",
  };
  return { session, matchCount: 1, matchedField: null, snippet: null };
}

test("parseSinceDuration accepts hours, days and weeks", () => {
  assert.deepEqual(parseSinceDuration("2h"), { ok: true, ms: 2 * 3_600_000 });
  assert.deepEqual(parseSinceDuration("30d"), { ok: true, ms: 30 * 86_400_000 });
  assert.deepEqual(parseSinceDuration("1w"), { ok: true, ms: 604_800_000 });
});

test("parseSinceDuration rejects malformed values", () => {
  assert.equal(parseSinceDuration("30").ok, false);
  assert.equal(parseSinceDuration("abc").ok, false);
  assert.equal(parseSinceDuration("30days").ok, false);
});

test("filterBySince keeps only sessions modified within the window", () => {
  const now = () => new Date("2026-02-01T00:00:00.000Z").getTime();
  const recent = makeMatch("recent", "2026-01-25T00:00:00.000Z", null);
  const old = makeMatch("old", "2025-11-01T00:00:00.000Z", null);

  const result = filterBySince([recent, old], 30 * 86_400_000, now);

  assert.deepEqual(result.map((m) => m.session.id), ["recent"]);
});

test("filterByPath keeps only sessions whose cwd contains the given substring", () => {
  const inside = makeMatch("inside", "2026-01-01T00:00:00.000Z", "/Users/alex/projects/store");
  const outside = makeMatch("outside", "2026-01-01T00:00:00.000Z", "/Users/alex/projects/blog");
  const missing = makeMatch("missing", "2026-01-01T00:00:00.000Z", null);

  const result = filterByPath([inside, outside, missing], "store");

  assert.deepEqual(result.map((m) => m.session.id), ["inside"]);
});
