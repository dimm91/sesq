import { describeConfig, type EffectiveSetting } from "./effective.js";
import { getConfigPath, loadConfig, saveRawConfig, type RawConfig } from "./load.js";
import { validateConfig } from "./schema.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ConfigCommandContext {
  home: string;
  env: NodeJS.ProcessEnv;
}

type ValueKind = "integer" | "cwd" | "boolean" | "string" | "nullable-path";

const SETTABLE_KEYS: Record<string, { path: string[]; kind: ValueKind }> = {
  pageSize: { path: ["pageSize"], kind: "integer" },
  defaultCwd: { path: ["defaultCwd"], kind: "cwd" },
  includeArchived: { path: ["includeArchived"], kind: "boolean" },
  showPreview: { path: ["showPreview"], kind: "boolean" },
  "codex.enabled": { path: ["agents", "codex", "enabled"], kind: "boolean" },
  "codex.executable": { path: ["agents", "codex", "executable"], kind: "string" },
  "codex.sessionsPath": { path: ["agents", "codex", "sessionsPath"], kind: "nullable-path" },
  "codex.archivedSessionsPath": { path: ["agents", "codex", "archivedSessionsPath"], kind: "nullable-path" },
  "claude.enabled": { path: ["agents", "claude", "enabled"], kind: "boolean" },
  "claude.executable": { path: ["agents", "claude", "executable"], kind: "string" },
  "claude.sessionsPath": { path: ["agents", "claude", "sessionsPath"], kind: "nullable-path" },
};

const USAGE = [
  "Usage:",
  "  sesq config                 Show the effective configuration",
  "  sesq config path            Print the config file location",
  "  sesq config set <key> <value>",
  "",
  `Keys: ${Object.keys(SETTABLE_KEYS).join(", ")}`,
  'Use the value "null" on a path key to return to automatic detection.',
].join("\n");

function usageError(message: string): CommandResult {
  return { stdout: "", stderr: `Error: ${message}\n${USAGE}\n`, exitCode: 2 };
}

function parseValue(kind: ValueKind, text: string): { value: unknown } | { error: string } {
  switch (kind) {
    case "integer": {
      const number = Number(text);
      return Number.isInteger(number) ? { value: number } : { error: `"${text}" is not an integer.` };
    }
    case "boolean":
      if (text === "true" || text === "false") {
        return { value: text === "true" };
      }
      return { error: 'Expected "true" or "false".' };
    case "cwd":
      return { value: text };
    case "string":
      return { value: text };
    case "nullable-path":
      return { value: text === "null" ? null : text };
  }
}

function setNested(target: Record<string, unknown>, keyPath: string[], value: unknown): void {
  let current = target;
  for (const key of keyPath.slice(0, -1)) {
    const next = current[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keyPath[keyPath.length - 1]] = value;
}

function formatSettings(settings: EffectiveSetting[]): string {
  const keyWidth = Math.max(...settings.map((s) => s.key.length));
  const valueWidth = Math.max(...settings.map((s) => s.value.length));
  return settings
    .map((setting) => {
      const label = setting.detail ? `${setting.source}: ${setting.detail}` : setting.source;
      return `${setting.key.padEnd(keyWidth)}  ${setting.value.padEnd(valueWidth)}  (${label})`;
    })
    .join("\n");
}

export async function runConfigCommand(args: string[], context: ConfigCommandContext): Promise<CommandResult> {
  const configPath = getConfigPath(context.home);
  const [subcommand, ...rest] = args;

  if (subcommand === "path") {
    if (rest.length > 0) {
      return usageError("`sesq config path` takes no arguments.");
    }
    return { stdout: `${configPath}\n`, stderr: "", exitCode: 0 };
  }

  if (subcommand !== undefined && subcommand !== "set") {
    return usageError(`Unknown config command "${subcommand}".`);
  }

  const loaded = await loadConfig(configPath);
  if (!loaded.ok) {
    return { stdout: "", stderr: `Error: ${loaded.error}\n`, exitCode: 2 };
  }

  if (subcommand === undefined) {
    const header = `Config file: ${configPath}${loaded.exists ? "" : " (not found, using defaults)"}`;
    const listing = formatSettings(describeConfig(loaded.raw, loaded.config, context.env, context.home));
    return { stdout: `${header}\n\n${listing}\n`, stderr: "", exitCode: 0 };
  }

  if (rest.length !== 2) {
    return usageError("`sesq config set` needs a key and a value.");
  }
  const [key, valueText] = rest;
  const definition = SETTABLE_KEYS[key];
  if (!definition) {
    return usageError(`Unknown config key "${key}".`);
  }

  const parsedValue = parseValue(definition.kind, valueText);
  if ("error" in parsedValue) {
    return usageError(`Invalid value for ${key}: ${parsedValue.error}`);
  }

  const updated: RawConfig = structuredClone(loaded.raw);
  setNested(updated, definition.path, parsedValue.value);

  const validation = validateConfig(updated);
  if (!validation.ok) {
    return usageError(`Invalid value for ${key}: ${validation.error}`);
  }

  await saveRawConfig(configPath, updated);
  return { stdout: `${key} = ${valueText}\n`, stderr: "", exitCode: 0 };
}
