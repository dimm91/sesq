import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, type SesqConfig, validateConfig } from "./schema.js";

export type RawConfig = Record<string, unknown>;

export type LoadResult =
  | { ok: true; exists: boolean; raw: RawConfig; config: SesqConfig }
  | { ok: false; error: string };

export function getConfigPath(home: string = os.homedir()): string {
  return path.join(home, ".config", "sesq", "config.json");
}

export async function loadConfig(configPath: string): Promise<LoadResult> {
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: true, exists: false, raw: {}, config: structuredClone(DEFAULT_CONFIG) };
    }
    return { ok: false, error: `Could not read ${configPath} (${code ?? "unknown error"}).` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `${configPath} is not valid JSON.` };
  }

  const validation = validateConfig(parsed);
  if (!validation.ok) {
    return { ok: false, error: `Invalid config in ${configPath}: ${validation.error}` };
  }

  return { ok: true, exists: true, raw: parsed as RawConfig, config: validation.config };
}

export async function saveRawConfig(configPath: string, raw: RawConfig): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  await rename(temporaryPath, configPath);
}
