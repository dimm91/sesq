import type { SearchMatch } from "../search/engine.js";

export function dedupeMatches(matches: SearchMatch[]): SearchMatch[] {
  const byIdentity = new Map<string, SearchMatch>();

  for (const match of matches) {
    const identity = `${match.session.agent}:${match.session.id}`;
    const existing = byIdentity.get(identity);
    if (!existing || match.session.modifiedAt.getTime() > existing.session.modifiedAt.getTime()) {
      byIdentity.set(identity, match);
    }
  }

  return [...byIdentity.values()];
}
