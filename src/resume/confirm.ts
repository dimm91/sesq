import type { SessionRecord } from "../sessions/model.js";
import { formatAgentName } from "../ui/results.js";

export function formatResumeConfirmation(session: SessionRecord): string {
  return [
    `Agent:  ${formatAgentName(session.agent)}`,
    `Title:  ${session.title ?? "Untitled"}`,
    `Folder: ${session.cwd ?? "Not available"}`,
    "",
    "Resume this session? [y/N]: ",
  ].join("\n");
}

export function formatUnarchiveConfirmation(): string {
  return "This session is archived.\nRestore it and resume it with Codex? [y/N]: ";
}

export function formatMissingFolderPrompt(originalCwd: string): string {
  return [
    "The original folder no longer exists:",
    originalCwd,
    "",
    "[1] Use the current folder",
    "[2] Choose another folder",
    "[3] Cancel",
  ].join("\n");
}

export function parseYesNo(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}
