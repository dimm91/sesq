export type AgentId = "codex" | "claude";

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date | null;
}

export interface SessionRecord {
  id: string;
  agent: AgentId;
  title: string | null;
  cwd: string | null;
  createdAt: Date | null;
  modifiedAt: Date;
  archived: boolean | null;
  messages: SessionMessage[];
  sourcePath: string;
}

export interface AdapterCapabilities {
  canResume: boolean;
  canDetectActive: boolean;
  canDetectArchived: boolean;
  canUnarchive: boolean;
}

export interface NativeCommand {
  executable: string;
  args: string[];
}
