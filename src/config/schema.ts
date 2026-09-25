export interface AgentConfig {
  enabled: boolean;
  executable: string;
  sessionsPath: string | null;
}

export interface CodexAgentConfig extends AgentConfig {
  archivedSessionsPath: string | null;
}

export interface SesqConfig {
  pageSize: number;
  defaultCwd: "original" | "current";
  includeArchived: boolean;
  showPreview: boolean;
  agents: {
    codex: CodexAgentConfig;
    claude: AgentConfig;
  };
}

export const DEFAULT_CONFIG: SesqConfig = {
  pageSize: 5,
  defaultCwd: "original",
  includeArchived: true,
  showPreview: true,
  agents: {
    codex: { enabled: true, executable: "codex", sessionsPath: null, archivedSessionsPath: null },
    claude: { enabled: true, executable: "claude", sessionsPath: null },
  },
};

export type ValidationResult = { ok: true; config: SesqConfig } | { ok: false; error: string };

type RawObject = Record<string, unknown>;

const TOP_LEVEL_KEYS = ["pageSize", "defaultCwd", "includeArchived", "showPreview", "agents"];
const AGENT_KEYS: Record<string, string[]> = {
  codex: ["enabled", "executable", "sessionsPath", "archivedSessionsPath"],
  claude: ["enabled", "executable", "sessionsPath"],
  copilot: [],
};

function isObject(value: unknown): value is RawObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAgent(name: "codex" | "claude", raw: unknown, base: AgentConfig): { config: AgentConfig } | { error: string } {
  if (!isObject(raw)) {
    return { error: `"agents.${name}" must be an object.` };
  }
  for (const key of Object.keys(raw)) {
    if (!AGENT_KEYS[name].includes(key)) {
      return { error: `Unknown setting "agents.${name}.${key}".` };
    }
  }

  const merged: AgentConfig & { archivedSessionsPath?: string | null } = { ...base };

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") {
      return { error: `"agents.${name}.enabled" must be true or false.` };
    }
    merged.enabled = raw.enabled;
  }
  if (raw.executable !== undefined) {
    if (typeof raw.executable !== "string" || raw.executable.trim() === "") {
      return { error: `"agents.${name}.executable" must be a non-empty string.` };
    }
    merged.executable = raw.executable;
  }
  for (const pathKey of ["sessionsPath", "archivedSessionsPath"] as const) {
    if (raw[pathKey] === undefined) {
      continue;
    }
    const value = raw[pathKey];
    if (value !== null && (typeof value !== "string" || value.trim() === "")) {
      return { error: `"agents.${name}.${pathKey}" must be a non-empty string or null.` };
    }
    merged[pathKey] = value as string | null;
  }

  return { config: merged };
}

export function validateConfig(raw: unknown): ValidationResult {
  if (!isObject(raw)) {
    return { ok: false, error: "The config file must contain a JSON object." };
  }
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      return { ok: false, error: `Unknown setting "${key}".` };
    }
  }

  const config: SesqConfig = structuredClone(DEFAULT_CONFIG);

  if (raw.pageSize !== undefined) {
    if (typeof raw.pageSize !== "number" || !Number.isInteger(raw.pageSize) || raw.pageSize < 5) {
      return { ok: false, error: '"pageSize" must be an integer of at least 5.' };
    }
    config.pageSize = raw.pageSize;
  }
  if (raw.defaultCwd !== undefined) {
    if (raw.defaultCwd !== "original" && raw.defaultCwd !== "current") {
      return { ok: false, error: '"defaultCwd" must be "original" or "current".' };
    }
    config.defaultCwd = raw.defaultCwd;
  }
  for (const key of ["includeArchived", "showPreview"] as const) {
    if (raw[key] === undefined) {
      continue;
    }
    if (typeof raw[key] !== "boolean") {
      return { ok: false, error: `"${key}" must be true or false.` };
    }
    config[key] = raw[key] as boolean;
  }

  if (raw.agents !== undefined) {
    if (!isObject(raw.agents)) {
      return { ok: false, error: '"agents" must be an object.' };
    }
    for (const name of Object.keys(raw.agents)) {
      if (!(name in AGENT_KEYS)) {
        return { ok: false, error: `Unknown agent "${name}" in "agents".` };
      }
    }
    for (const name of ["codex", "claude"] as const) {
      if (raw.agents[name] === undefined) {
        continue;
      }
      const result = validateAgent(name, raw.agents[name], config.agents[name]);
      if ("error" in result) {
        return { ok: false, error: result.error };
      }
      config.agents[name] = result.config as never;
    }
  }

  return { ok: true, config };
}
