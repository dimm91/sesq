import type { SearchMatch } from "../search/engine.js";

const SINCE_PATTERN = /^(\d+)([hdw])$/;
const MS_PER_UNIT: Record<string, number> = { h: 3_600_000, d: 86_400_000, w: 604_800_000 };

export type SinceParseResult = { ok: true; ms: number } | { ok: false; error: string };

export function parseSinceDuration(expression: string): SinceParseResult {
  const match = SINCE_PATTERN.exec(expression.trim());
  if (!match) {
    return { ok: false, error: `Invalid --since value "${expression}". Use a number followed by h, d, or w (e.g. 30d).` };
  }
  const amount = Number(match[1]);
  const unit = match[2];
  return { ok: true, ms: amount * MS_PER_UNIT[unit] };
}

export function filterBySince(matches: SearchMatch[], sinceMs: number, now: () => number = Date.now): SearchMatch[] {
  const cutoff = now() - sinceMs;
  return matches.filter((match) => match.session.modifiedAt.getTime() >= cutoff);
}

export function filterByPath(matches: SearchMatch[], pathSubstring: string): SearchMatch[] {
  return matches.filter((match) => match.session.cwd?.includes(pathSubstring) ?? false);
}
