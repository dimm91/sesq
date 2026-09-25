import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionMessage, SessionRecord } from "../sessions/model.js";
import { searchSessions } from "./engine.js";

function makeSession(overrides: Partial<SessionRecord> & { messages?: SessionMessage[] } = {}): SessionRecord {
  return {
    id: overrides.id ?? "id-1",
    agent: overrides.agent ?? "codex",
    title: overrides.title ?? null,
    cwd: overrides.cwd ?? null,
    createdAt: overrides.createdAt ?? null,
    modifiedAt: overrides.modifiedAt ?? new Date("2026-01-01T00:00:00.000Z"),
    archived: overrides.archived ?? null,
    messages: overrides.messages ?? [],
    sourcePath: overrides.sourcePath ?? "irrelevant",
  };
}

async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

test("word mode requires every word to appear, possibly in different messages, case/accent-insensitively", async () => {
  const matchingSession = makeSession({
    id: "match",
    messages: [
      { role: "user", content: "hay un ERROR raro", timestamp: null },
      { role: "assistant", content: "revisa la Autenticación del token", timestamp: null },
    ],
  });
  const nonMatchingSession = makeSession({
    id: "no-match",
    messages: [{ role: "user", content: "solo autenticación aquí", timestamp: null }],
  });

  const outcome = await searchSessions(toAsyncIterable([matchingSession, nonMatchingSession]), {
    query: "error autenticación",
    useRegex: false,
    fixed: false,
    caseSensitive: false,
  });

  assert.equal(outcome.error, null);
  assert.equal(outcome.sessionsScanned, 2);
  assert.equal(outcome.matches.length, 1);
  assert.equal(outcome.matches[0].session.id, "match");
  assert.equal(outcome.matches[0].matchCount, 2);
});

test("selects the unit with the most matches as matchedField and builds its snippet", async () => {
  const session = makeSession({
    id: "s1",
    messages: [
      { role: "user", content: "revisa el error", timestamp: new Date("2026-01-01T00:00:00.000Z") },
      {
        role: "assistant",
        content: "el error ocurre en el error de login, doble error",
        timestamp: new Date("2026-01-02T00:00:00.000Z"),
      },
    ],
  });

  const outcome = await searchSessions(toAsyncIterable([session]), {
    query: "error",
    useRegex: false,
    fixed: false,
    caseSensitive: false,
  });

  assert.equal(outcome.matches.length, 1);
  const [match] = outcome.matches;
  assert.equal(match.matchCount, 4);
  assert.equal(match.matchedField, "response");
  assert.match(match.snippet?.text ?? "", /error/);
});

test("fixed mode requires the exact phrase, unlike word mode", async () => {
  const phraseSession = makeSession({
    id: "phrase",
    messages: [{ role: "user", content: "cual es el precio final del producto", timestamp: null }],
  });
  const scatteredSession = makeSession({
    id: "scattered",
    messages: [{ role: "user", content: "el precio es alto, el total final se calcula despues", timestamp: null }],
  });

  const wordsOutcome = await searchSessions(toAsyncIterable([phraseSession, scatteredSession]), {
    query: "precio final",
    useRegex: false,
    fixed: false,
    caseSensitive: false,
  });
  assert.equal(wordsOutcome.matches.length, 2);

  const fixedOutcome = await searchSessions(toAsyncIterable([phraseSession, scatteredSession]), {
    query: "precio final",
    useRegex: false,
    fixed: true,
    caseSensitive: false,
  });
  assert.equal(fixedOutcome.matches.length, 1);
  assert.equal(fixedOutcome.matches[0].session.id, "phrase");
});

test("regex mode matches using the compiled pattern and honors case sensitivity", async () => {
  const session = makeSession({
    id: "s1",
    messages: [{ role: "user", content: "ticket PROJ-482 needs review", timestamp: null }],
  });

  const outcome = await searchSessions(toAsyncIterable([session]), {
    query: "proj-\\d+",
    useRegex: true,
    fixed: false,
    caseSensitive: false,
  });
  assert.equal(outcome.matches.length, 1);

  const caseSensitiveOutcome = await searchSessions(toAsyncIterable([session]), {
    query: "proj-\\d+",
    useRegex: true,
    fixed: false,
    caseSensitive: true,
  });
  assert.equal(caseSensitiveOutcome.matches.length, 0);
});

test("regex mode surfaces an error for unsafe patterns instead of scanning sessions", async () => {
  const session = makeSession({ id: "s1", messages: [{ role: "user", content: "anything", timestamp: null }] });
  const outcome = await searchSessions(toAsyncIterable([session]), {
    query: "(a+)+",
    useRegex: true,
    fixed: false,
    caseSensitive: false,
  });
  assert.notEqual(outcome.error, null);
  assert.equal(outcome.matches.length, 0);
  assert.equal(outcome.sessionsScanned, 0);
});

test("counts every scanned session even when it does not match", async () => {
  const sessions = [
    makeSession({ id: "a", messages: [{ role: "user", content: "error here", timestamp: null }] }),
    makeSession({ id: "b", messages: [{ role: "user", content: "nothing relevant", timestamp: null }] }),
  ];

  const outcome = await searchSessions(toAsyncIterable(sessions), {
    query: "error",
    useRegex: false,
    fixed: false,
    caseSensitive: false,
  });

  assert.equal(outcome.sessionsScanned, 2);
  assert.equal(outcome.matches.length, 1);
});

test("stops scanning once the time budget is exceeded and reports a partial scan", async () => {
  const sessions = [
    makeSession({ id: "a", messages: [{ role: "user", content: "error", timestamp: null }] }),
    makeSession({ id: "b", messages: [{ role: "user", content: "error", timestamp: null }] }),
    makeSession({ id: "c", messages: [{ role: "user", content: "error", timestamp: null }] }),
  ];

  let calls = 0;
  const clock = () => {
    calls++;
    if (calls === 1) return 0;
    if (calls === 2) return 100;
    return 1000;
  };

  const outcome = await searchSessions(
    toAsyncIterable(sessions),
    { query: "error", useRegex: false, fixed: false, caseSensitive: false, timeBudgetMs: 500 },
    clock,
  );

  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.sessionsScanned, 1);
  assert.equal(outcome.matches.length, 1);
});

test("retained matches keep session metadata but not the message bodies", async () => {
  const session = makeSession({
    id: "keep-meta",
    title: "Some title",
    cwd: "/work/x",
    messages: [{ role: "user", content: "an error happened", timestamp: null }],
  });

  const outcome = await searchSessions(toAsyncIterable([session]), {
    query: "error",
    useRegex: false,
    fixed: false,
    caseSensitive: false,
  });

  const [match] = outcome.matches;
  assert.equal(match.session.id, "keep-meta");
  assert.equal(match.session.title, "Some title");
  assert.equal(match.session.cwd, "/work/x");
  assert.deepEqual(match.session.messages, []);
  assert.match(match.snippet?.text ?? "", /error/);
});

test("the session id is searchable, whole or partially", async () => {
  const session = makeSession({
    id: "0686a452-9fda-41a1-a53e-b809b5c48193",
    messages: [{ role: "user", content: "nothing relevant here", timestamp: null }],
  });

  for (const query of ["0686a452", "b809b5c48193", "0686a452-9fda-41a1-a53e-b809b5c48193"]) {
    const outcome = await searchSessions(toAsyncIterable([session]), { query, useRegex: false, fixed: false, caseSensitive: false });
    assert.equal(outcome.matches.length, 1, query);
    assert.equal(outcome.matches[0].matchedField, "id", query);
  }
});
