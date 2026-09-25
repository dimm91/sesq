import type { ResolvedPaths } from "../config/effective.js";
import type { SesqConfig } from "../config/schema.js";
import type { AgentId } from "../sessions/model.js";
import type { SessionAdapter } from "./adapter.js";
import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";

export const AGENT_IDS: AgentId[] = ["codex", "claude"];

export function createAdapter(agent: AgentId, config: SesqConfig, paths: ResolvedPaths): SessionAdapter {
  if (agent === "codex") {
    return createCodexAdapter({
      sessionsDir: paths.codexSessions.path,
      archivedDir: paths.codexArchived.path,
      includeArchived: config.includeArchived,
      executable: config.agents.codex.executable,
    });
  }
  return createClaudeAdapter({
    projectsDir: paths.claudeProjects.path,
    executable: config.agents.claude.executable,
  });
}
