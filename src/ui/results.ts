import type { AgentId } from "../sessions/model.js";
import type { SearchMatch } from "../search/engine.js";
import type { SearchableField } from "../search/units.js";

const ANSI_BOLD = "\x1b[1m";
const ANSI_RESET = "\x1b[0m";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export interface ResultDisplayOptions {
  color: boolean;
  showPreview: boolean;
}

export function formatAgentName(agent: AgentId): string {
  return agent === "codex" ? "Codex" : "Claude Code";
}

function formatFieldName(field: SearchableField | null): string {
  switch (field) {
    case "id":
      return "Session ID";
    case "title":
      return "Title";
    case "cwd":
      return "Folder";
    case "prompt":
      return "Prompt";
    case "response":
      return "Response";
    default:
      return "Unknown";
  }
}

function highlight(text: string, offset: number, length: number, color: boolean): string {
  if (!color || length <= 0 || offset < 0 || offset + length > text.length) {
    return text;
  }
  const before = text.slice(0, offset);
  const matched = text.slice(offset, offset + length);
  const after = text.slice(offset + length);
  return `${before}${ANSI_BOLD}${matched}${ANSI_RESET}${after}`;
}

export function formatResult(ordinal: number, match: SearchMatch, options: ResultDisplayOptions): string {
  const { session } = match;
  const archivedTag = session.archived === true ? " [ARCHIVED]" : "";

  const lines = [
    `${ordinal}.${archivedTag}`,
    `   Agent:        ${formatAgentName(session.agent)}`,
    `   Title:        ${session.title ?? "Untitled"}`,
    `   Folder:       ${session.cwd ?? "Not available"}`,
    `   Modified:     ${DATE_FORMATTER.format(session.modifiedAt)}`,
    `   Matched in:   ${formatFieldName(match.matchedField)}`,
  ];

  if (options.showPreview) {
    const snippetText = match.snippet
      ? highlight(
          match.snippet.text.replace(/[\r\n\t]/g, " "),
          match.snippet.matchOffset,
          match.snippet.matchLength,
          options.color,
        )
      : "(none)";
    lines.push(`   Snippet:      ${snippetText}`);
  } else {
    lines.push(`   Snippet:      Hidden`);
  }

  lines.push(`   Matches:      ${match.matchCount}`);

  return lines.join("\n");
}
