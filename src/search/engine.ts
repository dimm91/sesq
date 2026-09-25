import type { SessionRecord } from "../sessions/model.js";
import { countNonOverlapping, normalizeForSearch, splitIntoWords } from "./normalize.js";
import { buildSafeRegex, matchRegexInText } from "./regex.js";
import { extractSnippet, type Snippet } from "./snippet.js";
import { collectSearchableUnits, type SearchableField, type SearchableUnit } from "./units.js";

export interface SearchOptions {
  query: string;
  useRegex: boolean;
  fixed: boolean;
  caseSensitive: boolean;
  timeBudgetMs?: number;
}

export interface SearchMatch {
  session: SessionRecord;
  matchCount: number;
  matchedField: SearchableField | null;
  snippet: Snippet | null;
}

export interface SearchOutcome {
  matches: SearchMatch[];
  sessionsScanned: number;
  timedOut: boolean;
  error: string | null;
}

type MatchPlan =
  | { mode: "words"; words: string[] }
  | { mode: "fixed"; normalizedQuery: string }
  | { mode: "regex"; regex: RegExp };

interface UnitTally {
  unit: SearchableUnit;
  count: number;
  firstIndex: number | null;
  firstLength: number;
}

const DEFAULT_TIME_BUDGET_MS = 10_000;

function buildMatchPlan(options: SearchOptions): { ok: true; plan: MatchPlan } | { ok: false; error: string } {
  if (options.fixed) {
    return { ok: true, plan: { mode: "fixed", normalizedQuery: normalizeForSearch(options.query) } };
  }
  if (options.useRegex) {
    const result = buildSafeRegex(options.query, options.caseSensitive);
    if (!result.ok) {
      return { ok: false, error: result.reason };
    }
    return { ok: true, plan: { mode: "regex", regex: result.regex } };
  }
  return { ok: true, plan: { mode: "words", words: splitIntoWords(options.query) } };
}

function evaluateWords(units: SearchableUnit[], words: string[]): { tallies: UnitTally[]; allWordsFound: boolean } {
  const wordFoundGlobally = new Map(words.map((word) => [word, false]));
  const tallies: UnitTally[] = units.map((unit) => ({ unit, count: 0, firstIndex: null, firstLength: 0 }));

  units.forEach((unit, index) => {
    const normalizedText = normalizeForSearch(unit.text);
    for (const word of words) {
      const { count, firstIndex } = countNonOverlapping(normalizedText, word);
      if (count === 0) {
        continue;
      }
      wordFoundGlobally.set(word, true);
      const tally = tallies[index];
      tally.count += count;
      if (firstIndex !== null && (tally.firstIndex === null || firstIndex < tally.firstIndex)) {
        tally.firstIndex = firstIndex;
        tally.firstLength = word.length;
      }
    }
  });

  const allWordsFound = [...wordFoundGlobally.values()].every(Boolean);
  return { tallies, allWordsFound };
}

function evaluateFixed(units: SearchableUnit[], normalizedQuery: string): UnitTally[] {
  return units.map((unit) => {
    const { count, firstIndex } = countNonOverlapping(normalizeForSearch(unit.text), normalizedQuery);
    return { unit, count, firstIndex, firstLength: normalizedQuery.length };
  });
}

function evaluateRegex(units: SearchableUnit[], regex: RegExp): UnitTally[] {
  return units.map((unit) => {
    const { count, firstIndex, firstLength } = matchRegexInText(unit.text, regex);
    return { unit, count, firstIndex, firstLength };
  });
}

function pickBestUnit(tallies: UnitTally[]): UnitTally | null {
  let best: UnitTally | null = null;
  for (const tally of tallies) {
    if (tally.count === 0) {
      continue;
    }
    if (!best || tally.count > best.count) {
      best = tally;
      continue;
    }
    if (tally.count === best.count) {
      const bestTime = best.unit.timestamp?.getTime() ?? -Infinity;
      const tallyTime = tally.unit.timestamp?.getTime() ?? -Infinity;
      if (tallyTime > bestTime) {
        best = tally;
      }
    }
  }
  return best;
}

export function evaluateSession(session: SessionRecord, plan: MatchPlan): SearchMatch | null {
  const units = collectSearchableUnits(session);
  if (units.length === 0) {
    return null;
  }

  let tallies: UnitTally[];
  if (plan.mode === "words") {
    if (plan.words.length === 0) {
      return null;
    }
    const result = evaluateWords(units, plan.words);
    if (!result.allWordsFound) {
      return null;
    }
    tallies = result.tallies;
  } else if (plan.mode === "fixed") {
    tallies = evaluateFixed(units, plan.normalizedQuery);
  } else {
    tallies = evaluateRegex(units, plan.regex);
  }

  const matchCount = tallies.reduce((sum, tally) => sum + tally.count, 0);
  if (matchCount === 0) {
    return null;
  }

  const best = pickBestUnit(tallies);
  const snippet = best && best.firstIndex !== null ? extractSnippet(best.unit.text, best.firstIndex, best.firstLength) : null;

  // Message bodies are only needed to compute the match; keeping them for every hit
  // would hold most of the collection in memory when a common word matches everything.
  return {
    session: { ...session, messages: [] },
    matchCount,
    matchedField: best?.unit.field ?? null,
    snippet,
  };
}

export async function searchSessions(
  sessions: AsyncIterable<SessionRecord>,
  options: SearchOptions,
  clock: () => number = Date.now,
): Promise<SearchOutcome> {
  const planResult = buildMatchPlan(options);
  if (!planResult.ok) {
    return { matches: [], sessionsScanned: 0, timedOut: false, error: planResult.error };
  }
  const plan = planResult.plan;

  const matches: SearchMatch[] = [];
  let sessionsScanned = 0;
  let timedOut = false;
  const startedAt = clock();
  const budget = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;

  for await (const session of sessions) {
    if (clock() - startedAt > budget) {
      timedOut = true;
      break;
    }
    sessionsScanned++;
    const match = evaluateSession(session, plan);
    if (match) {
      matches.push(match);
    }
  }

  return { matches, sessionsScanned, timedOut, error: null };
}
