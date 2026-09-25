import { existsSync } from "node:fs";
import type { SessionRecord } from "../sessions/model.js";

export type CwdResolution = { status: "resolved"; cwd: string } | { status: "missing-original"; originalCwd: string };

export interface ResolveCwdOptions {
  exists?: (path: string) => boolean;
  currentCwd?: () => string;
}

export function resolveResumeCwd(
  session: SessionRecord,
  mode: "original" | "current",
  options: ResolveCwdOptions = {},
): CwdResolution {
  const exists = options.exists ?? existsSync;
  const currentCwd = options.currentCwd ?? (() => process.cwd());

  if (mode === "current" || !session.cwd) {
    return { status: "resolved", cwd: currentCwd() };
  }
  if (!exists(session.cwd)) {
    return { status: "missing-original", originalCwd: session.cwd };
  }
  return { status: "resolved", cwd: session.cwd };
}
