import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { AGENT_IDS, createAdapter } from "../adapters/registry.js";
import { resolvePaths, type ValueSource } from "../config/effective.js";
import { getConfigPath, loadConfig } from "../config/load.js";
import { DEFAULT_CONFIG, type SesqConfig } from "../config/schema.js";
import type { AgentId } from "../sessions/model.js";

export type CommandRunner = (executable: string, args: string[]) => Promise<{ ok: boolean; output: string } | null>;

export interface DoctorContext {
  home: string;
  env: NodeJS.ProcessEnv;
  version: string;
  nodeVersion: string;
  platform: string;
  run: CommandRunner;
}

export interface PathCheck {
  label: string;
  path: string;
  source: ValueSource;
  detail?: string;
  exists: boolean;
  readable: boolean;
}

export interface UnreadableFile {
  path: string;
  reason: string;
}

export interface DuplicateId {
  id: string;
  files: string[];
  compatible: boolean;
}

export interface AgentDiagnosis {
  agent: AgentId;
  enabled: boolean;
  executable: { configured: string; resolvedPath: string | null; version: string | null };
  paths: PathCheck[];
  sessionCount: number;
  archivedCount: number | null;
  unreadable: UnreadableFile[];
  duplicates: DuplicateId[];
  resumeAvailable: boolean;
  restoreAvailable: boolean | null;
  notes: string[];
  issues: string[];
}

export interface DoctorReport {
  version: string;
  nodeVersion: string;
  platform: string;
  configPath: string;
  configExists: boolean;
  configError: string | null;
  agents: AgentDiagnosis[];
  issueCount: number;
}

export function createCommandRunner(timeoutMs = 5000): CommandRunner {
  return (executable, args) =>
    new Promise((resolve) => {
      execFile(executable, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          resolve(typeof (error as NodeJS.ErrnoException).code === "number" ? { ok: false, output: "" } : null);
          return;
        }
        resolve({ ok: true, output: `${stdout}${stderr}`.trim().split("\n")[0]?.slice(0, 80) ?? "" });
      });
    });
}

export async function findExecutable(name: string, envPath: string | undefined): Promise<string | null> {
  const candidates = name.includes("/") ? [name] : (envPath ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function canAccess(target: string, mode: number): Promise<boolean> {
  try {
    await access(target, mode);
    return true;
  } catch {
    return false;
  }
}

function classifyReadError(error: Error): string {
  if (error instanceof SyntaxError) {
    return "invalid JSON line";
  }
  if (error.message === "No valid JSON lines found in session file") {
    return "no valid JSON lines";
  }
  if (error.message === "Could not determine session id") {
    return "session id could not be determined";
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code ? `read error (${code})` : "read error";
}

function fingerprint(messages: Array<{ role: string; content: string }>): string[] {
  return messages.map((message) => `${message.role}:${createHash("sha1").update(message.content).digest("hex").slice(0, 12)}`);
}

function isPrefix(shorter: string[], longer: string[]): boolean {
  return shorter.length <= longer.length && shorter.every((value, index) => value === longer[index]);
}

async function diagnoseAgent(agent: AgentId, config: SesqConfig, context: DoctorContext): Promise<AgentDiagnosis> {
  const agentConfig = config.agents[agent];
  const paths = resolvePaths(config, context.env, context.home);
  const displayedPaths =
    agent === "codex"
      ? [
          { label: "Sessions path", resolved: paths.codexSessions },
          { label: "Archived path", resolved: paths.codexArchived },
        ]
      : [{ label: "Sessions path", resolved: paths.claudeProjects }];

  const diagnosis: AgentDiagnosis = {
    agent,
    enabled: agentConfig.enabled,
    executable: { configured: agentConfig.executable, resolvedPath: null, version: null },
    paths: [],
    sessionCount: 0,
    archivedCount: agent === "codex" ? 0 : null,
    unreadable: [],
    duplicates: [],
    resumeAvailable: false,
    restoreAvailable: null,
    notes: [],
    issues: [],
  };

  if (!agentConfig.enabled) {
    return diagnosis;
  }

  const resolvedExecutable = await findExecutable(agentConfig.executable, context.env.PATH);
  diagnosis.executable.resolvedPath = resolvedExecutable;
  diagnosis.resumeAvailable = resolvedExecutable !== null;
  if (resolvedExecutable) {
    const versionResult = await context.run(resolvedExecutable, ["--version"]);
    diagnosis.executable.version = versionResult?.ok ? versionResult.output || null : null;
    if (agent === "codex") {
      const restore = await context.run(resolvedExecutable, ["unarchive", "--help"]);
      diagnosis.restoreAvailable = restore?.ok === true;
    }
  } else if (agent === "codex") {
    diagnosis.restoreAvailable = false;
  }

  for (const { label, resolved } of displayedPaths) {
    const exists = await canAccess(resolved.path, constants.F_OK);
    const readable = exists && (await canAccess(resolved.path, constants.R_OK));
    diagnosis.paths.push({ label, path: resolved.path, source: resolved.source, detail: resolved.detail, exists, readable });
    if (exists && !readable) {
      diagnosis.issues.push(`${label} exists but is not readable: ${resolved.path}`);
    }
  }

  const adapter = createAdapter(agent, config, paths);
  const unreadableByPath = new Map<string, string>();
  const idsToFiles = new Map<string, Array<{ file: string; prints: string[] }>>();

  for await (const session of adapter.discoverSessions((sourcePath, error) => {
    const reason = classifyReadError(error);
    if (!unreadableByPath.has(sourcePath) || reason !== "invalid JSON line") {
      unreadableByPath.set(sourcePath, reason);
    }
  })) {
    diagnosis.sessionCount += 1;
    if (session.archived === true && diagnosis.archivedCount !== null) {
      diagnosis.archivedCount += 1;
    }
    const entries = idsToFiles.get(session.id) ?? [];
    entries.push({ file: session.sourcePath, prints: fingerprint(session.messages) });
    idsToFiles.set(session.id, entries);
  }

  diagnosis.unreadable = [...unreadableByPath].map(([file, reason]) => ({ path: file, reason }));

  for (const [id, entries] of idsToFiles) {
    if (entries.length < 2) {
      continue;
    }
    const compatible = entries.every((a) => entries.every((b) => isPrefix(a.prints, b.prints) || isPrefix(b.prints, a.prints)));
    diagnosis.duplicates.push({ id, files: entries.map((entry) => entry.file), compatible });
  }

  if (diagnosis.unreadable.length > 0) {
    diagnosis.issues.push(`${diagnosis.unreadable.length} session file(s) could not be read.`);
  }
  const conflicts = diagnosis.duplicates.filter((duplicate) => !duplicate.compatible).length;
  if (conflicts > 0) {
    diagnosis.issues.push(`${conflicts} session id(s) appear in several files with incompatible histories.`);
  }
  if (diagnosis.sessionCount > 0 && !diagnosis.resumeAvailable) {
    diagnosis.issues.push(`Sessions were found but the "${agentConfig.executable}" executable was not found, so resuming will fail.`);
  }
  if ((diagnosis.archivedCount ?? 0) > 0 && diagnosis.restoreAvailable === false) {
    diagnosis.issues.push("Archived sessions were found but restoring them (`unarchive`) is not available.");
  }
  if (diagnosis.sessionCount === 0 && diagnosis.paths.every((check) => !check.exists) && !diagnosis.resumeAvailable) {
    diagnosis.notes.push("Not detected on this machine.");
  }

  return diagnosis;
}

export async function runDoctorChecks(context: DoctorContext): Promise<DoctorReport> {
  const configPath = getConfigPath(context.home);
  const loaded = await loadConfig(configPath);
  const config = loaded.ok ? loaded.config : structuredClone(DEFAULT_CONFIG);

  const agents: AgentDiagnosis[] = [];
  for (const agent of AGENT_IDS) {
    agents.push(await diagnoseAgent(agent, config, context));
  }

  const configIssue = loaded.ok ? 0 : 1;
  return {
    version: context.version,
    nodeVersion: context.nodeVersion,
    platform: context.platform,
    configPath,
    configExists: loaded.ok ? loaded.exists : true,
    configError: loaded.ok ? null : loaded.error,
    agents,
    issueCount: configIssue + agents.reduce((sum, agent) => sum + agent.issues.length, 0),
  };
}
