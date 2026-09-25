import type { SessionMessage } from "./model.js";

const MAX_TITLE_LENGTH = 60;

export function deriveFallbackTitle(messages: SessionMessage[]): string | null {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) {
    return null;
  }

  const firstLine = firstUserMessage.content.split("\n")[0]?.trim();
  if (!firstLine) {
    return null;
  }

  if (firstLine.length <= MAX_TITLE_LENGTH) {
    return firstLine;
  }

  return `${firstLine.slice(0, MAX_TITLE_LENGTH).trimEnd()}…`;
}
