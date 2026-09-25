import type { SearchMatch } from "../search/engine.js";

export function sortMatches(matches: SearchMatch[]): SearchMatch[] {
  return [...matches].sort((a, b) => {
    const modifiedDelta = b.session.modifiedAt.getTime() - a.session.modifiedAt.getTime();
    if (modifiedDelta !== 0) {
      return modifiedDelta;
    }
    return a.session.id.localeCompare(b.session.id);
  });
}
