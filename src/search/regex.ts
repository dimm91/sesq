const MAX_PATTERN_LENGTH = 500;

// Heuristic guard against classic catastrophic-backtracking shapes, e.g. (a+)+ or (.*)*:
// a parenthesized group that already contains a quantifier, itself followed by a quantifier.
const NESTED_QUANTIFIER_PATTERN = /\([^()]*[+*][^()]*\)[+*]/;

export type RegexValidationResult = { ok: true; regex: RegExp } | { ok: false; reason: string };

export function buildSafeRegex(pattern: string, caseSensitive: boolean): RegexValidationResult {
  if (pattern.length === 0) {
    return { ok: false, reason: "Pattern cannot be empty." };
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { ok: false, reason: `Pattern is too long (max ${MAX_PATTERN_LENGTH} characters).` };
  }
  if (NESTED_QUANTIFIER_PATTERN.test(pattern)) {
    return { ok: false, reason: "Pattern contains a nested quantifier that could cause catastrophic backtracking." };
  }

  try {
    const flags = caseSensitive ? "g" : "gi";
    return { ok: true, regex: new RegExp(pattern, flags) };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

export interface RegexOccurrence {
  count: number;
  firstIndex: number | null;
  firstLength: number;
}

export function matchRegexInText(text: string, regex: RegExp): RegexOccurrence {
  regex.lastIndex = 0;
  let count = 0;
  let firstIndex: number | null = null;
  let firstLength = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    count++;
    if (firstIndex === null) {
      firstIndex = match.index;
      firstLength = match[0].length;
    }
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
  }

  return { count, firstIndex, firstLength };
}
