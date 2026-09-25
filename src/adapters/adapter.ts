import type { AdapterCapabilities, AgentId, NativeCommand, SessionRecord } from "../sessions/model.js";

export type SessionReadError = (sourcePath: string, error: Error) => void;

export interface SessionAdapter {
  readonly agent: AgentId;
  readonly capabilities: AdapterCapabilities;
  isAvailable(): Promise<boolean>;
  discoverSessions(onError?: SessionReadError): AsyncIterable<SessionRecord>;
  buildResumeCommand(session: SessionRecord): NativeCommand;
  buildUnarchiveCommand?(session: SessionRecord): NativeCommand;
}
