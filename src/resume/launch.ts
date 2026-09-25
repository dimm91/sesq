import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { NativeCommand } from "../sessions/model.js";

export interface LaunchResult {
  ok: boolean;
  exitCode: number | null;
  error?: string;
  errorCode?: string;
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export function runNativeCommand(command: NativeCommand, cwd: string, spawnFn: SpawnFn = nodeSpawn): Promise<LaunchResult> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawnFn(command.executable, command.args, { cwd, stdio: "inherit" });

    child.once("error", (error: Error) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, exitCode: null, error: error.message, errorCode: (error as NodeJS.ErrnoException).code });
    });

    child.once("exit", (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ ok: code === 0, exitCode: code });
    });
  });
}
