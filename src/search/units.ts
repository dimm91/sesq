import type { SessionRecord } from "../sessions/model.js";

export type SearchableField = "id" | "title" | "cwd" | "prompt" | "response";

export interface SearchableUnit {
  field: SearchableField;
  text: string;
  timestamp: Date | null;
}

export function collectSearchableUnits(session: SessionRecord): SearchableUnit[] {
  const units: SearchableUnit[] = [{ field: "id", text: session.id, timestamp: session.createdAt }];

  if (session.title) {
    units.push({ field: "title", text: session.title, timestamp: session.createdAt });
  }
  if (session.cwd) {
    units.push({ field: "cwd", text: session.cwd, timestamp: session.createdAt });
  }
  for (const message of session.messages) {
    units.push({
      field: message.role === "user" ? "prompt" : "response",
      text: message.content,
      timestamp: message.timestamp,
    });
  }

  return units;
}
