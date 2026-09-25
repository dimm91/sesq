import path from "node:path";
import type { RawConfig } from "./load.js";
import type { SesqConfig } from "./schema.js";

export type ValueSource = "default" | "environment" | "custom";

export interface ResolvedPath {
  path: string;
  source: ValueSource;
  detail?: string;
}

export interface ResolvedPaths {
  codexSessions: ResolvedPath;
  codexArchived: ResolvedPath;
  claudeProjects: ResolvedPath;
}

export interface EffectiveSetting {
  key: string;
  value: string;
  source: ValueSource;
  detail?: string;
}

export function expandHome(value: string, home: string): string {
  if (value === "~") {
    return home;
  }
  if (value.startsWith("~/")) {
    return path.join(home, value.slice(2));
  }
  return value;
}

function resolveOne(
  custom: string | null,
  envValue: string | undefined,
  envName: string,
  defaultBase: string,
  subdirectory: string,
  home: string,
): ResolvedPath {
  if (custom) {
    return { path: expandHome(custom, home), source: "custom" };
  }
  if (envValue) {
    return { path: path.join(expandHome(envValue, home), subdirectory), source: "environment", detail: envName };
  }
  return { path: path.join(defaultBase, subdirectory), source: "default" };
}

export function resolvePaths(config: SesqConfig, env: NodeJS.ProcessEnv, home: string): ResolvedPaths {
  const codexBase = path.join(home, ".codex");
  const claudeBase = path.join(home, ".claude");
  const { codex, claude } = config.agents;

  return {
    codexSessions: resolveOne(codex.sessionsPath, env.CODEX_HOME, "CODEX_HOME", codexBase, "sessions", home),
    codexArchived: resolveOne(
      codex.archivedSessionsPath,
      env.CODEX_HOME,
      "CODEX_HOME",
      codexBase,
      "archived_sessions",
      home,
    ),
    claudeProjects: resolveOne(claude.sessionsPath, env.CLAUDE_CONFIG_DIR, "CLAUDE_CONFIG_DIR", claudeBase, "projects", home),
  };
}

function isSet(raw: RawConfig, keyPath: string[]): boolean {
  let current: unknown = raw;
  for (const key of keyPath) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

export function describeConfig(raw: RawConfig, config: SesqConfig, env: NodeJS.ProcessEnv, home: string): EffectiveSetting[] {
  const paths = resolvePaths(config, env, home);
  const plain = (key: string, value: string | number | boolean, keyPath: string[]): EffectiveSetting => ({
    key,
    value: String(value),
    source: isSet(raw, keyPath) ? "custom" : "default",
  });
  const fromPath = (key: string, resolved: ResolvedPath): EffectiveSetting => ({
    key,
    value: resolved.path,
    source: resolved.source,
    detail: resolved.detail,
  });

  return [
    plain("pageSize", config.pageSize, ["pageSize"]),
    plain("defaultCwd", config.defaultCwd, ["defaultCwd"]),
    plain("includeArchived", config.includeArchived, ["includeArchived"]),
    plain("showPreview", config.showPreview, ["showPreview"]),
    plain("codex.enabled", config.agents.codex.enabled, ["agents", "codex", "enabled"]),
    plain("codex.executable", config.agents.codex.executable, ["agents", "codex", "executable"]),
    fromPath("codex.sessionsPath", paths.codexSessions),
    fromPath("codex.archivedSessionsPath", paths.codexArchived),
    plain("claude.enabled", config.agents.claude.enabled, ["agents", "claude", "enabled"]),
    plain("claude.executable", config.agents.claude.executable, ["agents", "claude", "executable"]),
    fromPath("claude.sessionsPath", paths.claudeProjects),
  ];
}
