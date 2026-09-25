import { createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import type { AdapterCapabilities, NativeCommand, SessionMessage, SessionRecord } from "../sessions/model.js";
import { deriveFallbackTitle } from "../sessions/title.js";
import type { SessionAdapter, SessionReadError } from "./adapter.js";

export interface CodexAdapterOptions {
  codexHome?: string;
  sessionsDir?: string;
  archivedDir?: string;
  includeArchived?: boolean;
  executable?: string;
}

const CAPABILITIES: AdapterCapabilities = {
  canResume: true,
  canDetectActive: false,
  canDetectArchived: true,
  canUnarchive: true,
};

const FILENAME_ID_PATTERN = /rollout-.+-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/;

interface CodexBlock {
  type?: string;
  text?: string;
}

interface CodexLine {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    role?: string;
    content?: CodexBlock[];
    id?: string;
    session_id?: string;
    parent_thread_id?: string;
    source?: unknown;
    cwd?: string;
    timestamp?: string;
  };
}

function isSubagentThread(payload: NonNullable<CodexLine["payload"]>): boolean {
  if (typeof payload.parent_thread_id === "string") {
    return true;
  }
  return typeof payload.source === "object" && payload.source !== null && "subagent" in payload.source;
}

function resolveCodexHome(options?: CodexAdapterOptions): string {
  if (options?.codexHome) {
    return options.codexHome;
  }
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function idFromFilename(filePath: string): string | null {
  const match = FILENAME_ID_PATTERN.exec(path.basename(filePath));
  return match ? match[1] : null;
}

async function collectJsonlFiles(rootDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(rootDir, { recursive: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.endsWith(".jsonl")).map((entry) => path.join(rootDir, entry));
}

async function parseSessionFile(
  filePath: string,
  archived: boolean,
  onError?: SessionReadError,
): Promise<SessionRecord | null> {
  const messages: SessionMessage[] = [];
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let createdAt: Date | null = null;
  let parsedAnyLine = false;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const rawLine of rl) {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        continue;
      }

      let parsed: CodexLine;
      try {
        parsed = JSON.parse(trimmed) as CodexLine;
      } catch (error) {
        onError?.(filePath, error as Error);
        continue;
      }
      parsedAnyLine = true;

      if (parsed.type === "session_meta") {
        const payload = parsed.payload;
        if (payload && isSubagentThread(payload)) {
          return null;
        }
        // `id` is the thread id (the UUID in the file name, which `codex resume` accepts);
        // `session_id` can point at a parent session, so it is only a fallback.
        if (typeof payload?.id === "string") {
          sessionId = payload.id;
        } else if (typeof payload?.session_id === "string") {
          sessionId = payload.session_id;
        }
        if (typeof payload?.cwd === "string") {
          cwd = payload.cwd;
        }
        const timestampValue = payload?.timestamp ?? parsed.timestamp;
        if (timestampValue) {
          createdAt = new Date(timestampValue);
        }
        continue;
      }

      if (parsed.type === "response_item" && parsed.payload?.type === "message") {
        const role = parsed.payload.role;
        if (role !== "user" && role !== "assistant") {
          continue;
        }
        const blocks = parsed.payload.content;
        if (!Array.isArray(blocks)) {
          continue;
        }
        const text = blocks
          .map((block) => block?.text)
          .filter((text): text is string => typeof text === "string" && text.length > 0)
          .join("\n");
        if (!text) {
          continue;
        }
        const timestamp = parsed.timestamp ? new Date(parsed.timestamp) : null;
        messages.push({ role, content: text, timestamp });
      }
    }
  } finally {
    stream.destroy();
  }

  if (!parsedAnyLine) {
    onError?.(filePath, new Error("No valid JSON lines found in session file"));
    return null;
  }

  const id = sessionId ?? idFromFilename(filePath);
  if (!id) {
    onError?.(filePath, new Error("Could not determine session id"));
    return null;
  }

  const stats = await stat(filePath);

  return {
    id,
    agent: "codex",
    title: deriveFallbackTitle(messages),
    cwd,
    createdAt,
    modifiedAt: stats.mtime,
    archived,
    messages,
    sourcePath: filePath,
  };
}

export function createCodexAdapter(options?: CodexAdapterOptions): SessionAdapter {
  const codexHome = resolveCodexHome(options);
  const sessionsDir = options?.sessionsDir ?? path.join(codexHome, "sessions");
  const archivedDir = options?.archivedDir ?? path.join(codexHome, "archived_sessions");
  const includeArchived = options?.includeArchived ?? true;
  const executable = options?.executable ?? "codex";

  return {
    agent: "codex",
    capabilities: CAPABILITIES,

    async isAvailable(): Promise<boolean> {
      const roots = includeArchived ? [sessionsDir, archivedDir] : [sessionsDir];
      const exist = await Promise.all(
        roots.map((root) =>
          access(root).then(
            () => true,
            () => false,
          ),
        ),
      );
      return exist.some(Boolean);
    },

    async *discoverSessions(onError?: SessionReadError): AsyncIterable<SessionRecord> {
      const files = [
        ...(await collectJsonlFiles(sessionsDir)).map((filePath) => ({ filePath, archived: false })),
        ...(includeArchived ? await collectJsonlFiles(archivedDir) : []).map((filePath) => ({ filePath, archived: true })),
      ];

      for (const { filePath, archived } of files) {
        try {
          const record = await parseSessionFile(filePath, archived, onError);
          if (record) {
            yield record;
          }
        } catch (error) {
          onError?.(filePath, error as Error);
        }
      }
    },

    buildResumeCommand(session: SessionRecord): NativeCommand {
      return { executable, args: ["resume", session.id] };
    },

    buildUnarchiveCommand(session: SessionRecord): NativeCommand {
      return { executable, args: ["unarchive", session.id] };
    },
  };
}
