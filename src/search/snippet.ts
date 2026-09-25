const SNIPPET_RADIUS = 80;

export interface Snippet {
  text: string;
  matchOffset: number;
  matchLength: number;
}

// The match index/length come from a normalized copy of the text (case/accent folded),
// which can differ in length from the original by a few characters when accents are
// stripped. For a preview snippet this approximate centering/highlighting is acceptable.
export function extractSnippet(originalText: string, matchIndex: number, matchLength: number): Snippet {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(originalText.length, matchIndex + matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < originalText.length ? "…" : "";

  return {
    text: `${prefix}${originalText.slice(start, end)}${suffix}`,
    matchOffset: prefix.length + (matchIndex - start),
    matchLength,
  };
}
