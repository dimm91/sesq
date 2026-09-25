import { createReadStream } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import type { AdapterCapabilities, NativeCommand, SessionMessage, SessionRecord } from "../sessions/model.js";
import { deriveFallbackTitle } from "../sessions/title.js";
import type { SessionAdapter, SessionReadError } from "./adapter.js";

export interface ClaudeAdapterOptions {
  projectsDir?: string;
  executable?: string;
}

const CAPABILITIES: AdapterCapabilities = {
  canResume: true,
  canDetectActive: false,
  canDetectArchived: false,
  canUnarchive: false,
};

interface ClaudeTextBlock {
  type?: string;
  text?: string;
}

interface ClaudeLine {
  type?: string;
  message?: {
    content?: string | ClaudeTextBlock[];
  };
  isSidechain?: boolean;
  cwd?: string;
  timestamp?: string;
  aiTitle?: string;
}

function resolveProjectsDir(options?: ClaudeAdapterOptions): string {
  if (options?.projectsDir) {
    return options.projectsDir;
  }
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(configDir, "projects");
}

function extractText(content: string | ClaudeTextBlock[] | undefined): string | null {
  if (typeof content === "string") {
    return content.length > 0 ? content : null;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((block): block is ClaudeTextBlock & { text: string } => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    return text.length > 0 ? text : null;
  }
  return null;
}

async function parseSessionFile(filePath: string, onError?: SessionReadError): Promise<SessionRecord | null> {
  const id = path.basename(filePath, ".jsonl");
  const messages: SessionMessage[] = [];
  let title: string | null = null;
  let cwd: string | null = null;
  let createdAt: Date | null = null;
  let parsedAnyLine = false;

  const rl = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });

  for await (const rawLine of rl) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: ClaudeLine;
    try {
      parsed = JSON.parse(trimmed) as ClaudeLine;
    } catch (error) {
      onError?.(filePath, error as Error);
      continue;
    }
    parsedAnyLine = true;

    if (parsed.type === "ai-title" && typeof parsed.aiTitle === "string" && parsed.aiTitle.length > 0) {
      title = parsed.aiTitle;
      continue;
    }

    if (parsed.isSidechain === true) {
      continue;
    }

    if (parsed.type === "user" || parsed.type === "assistant") {
      const role = parsed.type;
      if (cwd === null && typeof parsed.cwd === "string") {
        cwd = parsed.cwd;
      }
      const text = extractText(parsed.message?.content);
      if (text) {
        const timestamp = parsed.timestamp ? new Date(parsed.timestamp) : null;
        if (createdAt === null && timestamp) {
          createdAt = timestamp;
        }
        messages.push({ role, content: text, timestamp });
      }
    }
  }

  if (!parsedAnyLine) {
    onError?.(filePath, new Error("No valid JSON lines found in session file"));
    return null;
  }

  const stats = await stat(filePath);

  return {
    id,
    agent: "claude",
    title: title ?? deriveFallbackTitle(messages),
    cwd,
    createdAt,
    modifiedAt: stats.mtime,
    archived: null,
    messages,
    sourcePath: filePath,
  };
}

export function createClaudeAdapter(options?: ClaudeAdapterOptions): SessionAdapter {
  const projectsDir = resolveProjectsDir(options);
  const executable = options?.executable ?? "claude";

  return {
    agent: "claude",
    capabilities: CAPABILITIES,

    async isAvailable(): Promise<boolean> {
      try {
        await access(projectsDir);
        return true;
      } catch {
        return false;
      }
    },

    async *discoverSessions(onError?: SessionReadError): AsyncIterable<SessionRecord> {
      let projectDirs: string[];
      try {
        projectDirs = await readdir(projectsDir);
      } catch {
        return;
      }

      for (const projectDir of projectDirs) {
        const projectPath = path.join(projectsDir, projectDir);
        let entries: string[];
        try {
          entries = await readdir(projectPath);
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (!entry.endsWith(".jsonl")) {
            continue;
          }
          const filePath = path.join(projectPath, entry);
          try {
            const record = await parseSessionFile(filePath, onError);
            if (record) {
              yield record;
            }
          } catch (error) {
            onError?.(filePath, error as Error);
          }
        }
      }
    },

    buildResumeCommand(session: SessionRecord): NativeCommand {
      return { executable, args: ["--resume", session.id] };
    },
  };
}
