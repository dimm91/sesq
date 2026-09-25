import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchMatch } from "../search/engine.js";
import type { SessionRecord } from "./model.js";
import { dedupeMatches } from "./dedupe.js";

function makeMatch(id: string, agent: "codex" | "claude", modifiedAt: string): SearchMatch {
  const session: SessionRecord = {
    id,
    agent,
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

test("keeps a single entry per agent+id, preferring the most recently modified", () => {
  const older = makeMatch("same-id", "codex", "2026-01-01T00:00:00.000Z");
  const newer = makeMatch("same-id", "codex", "2026-02-01T00:00:00.000Z");

  const result = dedupeMatches([older, newer]);

  assert.equal(result.length, 1);
  assert.equal(result[0].session.modifiedAt.toISOString(), newer.session.modifiedAt.toISOString());
});

test("treats the same id from different agents as distinct sessions", () => {
  const codexMatch = makeMatch("same-id", "codex", "2026-01-01T00:00:00.000Z");
  const claudeMatch = makeMatch("same-id", "claude", "2026-01-01T00:00:00.000Z");

  const result = dedupeMatches([codexMatch, claudeMatch]);

  assert.equal(result.length, 2);
});
