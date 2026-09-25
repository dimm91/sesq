import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchMatch } from "../search/engine.js";
import type { SessionRecord } from "./model.js";
import { sortMatches } from "./sort.js";

function makeMatch(id: string, modifiedAt: string): SearchMatch {
  const session: SessionRecord = {
    id,
    agent: "codex",
    title: null,
    cwd: null,
    createdAt: null,
    modifiedAt: new Date(modifiedAt),
    archived: null,
    messages: [],
    sourcePath: "irrelevant",
  };
  return { session, matchCount: 1, matchedField: null, snippet: null };
}

test("sorts by modifiedAt descending", () => {
  const older = makeMatch("a", "2026-01-01T00:00:00.000Z");
  const newer = makeMatch("b", "2026-02-01T00:00:00.000Z");

  const result = sortMatches([older, newer]);

  assert.deepEqual(result.map((m) => m.session.id), ["b", "a"]);
});

test("breaks ties on modifiedAt using the session id", () => {
  const sameTime = "2026-01-01T00:00:00.000Z";
  const b = makeMatch("b", sameTime);
  const a = makeMatch("a", sameTime);

  const result = sortMatches([b, a]);

  assert.deepEqual(result.map((m) => m.session.id), ["a", "b"]);
});

test("does not mutate the input array", () => {
  const older = makeMatch("a", "2026-01-01T00:00:00.000Z");
  const newer = makeMatch("b", "2026-02-01T00:00:00.000Z");
  const input = [older, newer];

  sortMatches(input);

  assert.deepEqual(input, [older, newer]);
});
