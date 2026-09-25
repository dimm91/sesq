import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { ChildProcess } from "node:child_process";
import { runNativeCommand, type SpawnFn } from "./launch.js";

test("spawns with structured arguments, the given cwd, and inherited stdio", async () => {
  const capturedCalls: Array<{ command: string; args: string[]; options: unknown }> = [];
  const spawnFn: SpawnFn = (command, args, options) => {
    capturedCalls.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child as unknown as ChildProcess;
  };

  const result = await runNativeCommand({ executable: "codex", args: ["resume", "abc"] }, "/some/dir", spawnFn);

  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].command, "codex");
  assert.deepEqual(capturedCalls[0].args, ["resume", "abc"]);
  assert.deepEqual(capturedCalls[0].options, { cwd: "/some/dir", stdio: "inherit" });
  assert.deepEqual(result, { ok: true, exitCode: 0 });
});

test("reports a non-zero exit code as not ok", async () => {
  const spawnFn: SpawnFn = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 1));
    return child as unknown as ChildProcess;
  };

  const result = await runNativeCommand({ executable: "codex", args: [] }, "/dir", spawnFn);
  assert.deepEqual(result, { ok: false, exitCode: 1 });
});

test("reports a spawn error (e.g. missing executable) distinctly from a bad exit code", async () => {
  const spawnFn: SpawnFn = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })));
    return child as unknown as ChildProcess;
  };

  const result = await runNativeCommand({ executable: "codex", args: [] }, "/dir", spawnFn);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, null);
  assert.match(result.error ?? "", /ENOENT/);
  assert.equal(result.errorCode, "ENOENT");
});
