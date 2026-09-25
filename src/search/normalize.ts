const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeForSearch(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

export function splitIntoWords(query: string): string[] {
  const normalized = normalizeForSearch(query).trim();
  if (!normalized) {
    return [];
  }
  return [...new Set(normalized.split(/\s+/))];
}

export interface Occurrence {
  count: number;
  firstIndex: number | null;
}

export function countNonOverlapping(normalizedHaystack: string, normalizedNeedle: string): Occurrence {
  if (!normalizedNeedle) {
    return { count: 0, firstIndex: null };
  }

  let count = 0;
  let firstIndex: number | null = null;
  let searchFrom = 0;

  while (true) {
    const index = normalizedHaystack.indexOf(normalizedNeedle, searchFrom);
    if (index === -1) {
      break;
    }
    if (firstIndex === null) {
      firstIndex = index;
    }
    count++;
    searchFrom = index + normalizedNeedle.length;
  }

  return { count, firstIndex };
}
