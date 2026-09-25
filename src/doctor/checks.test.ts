import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { type CommandRunner, runDoctorChecks } from "./checks.js";
import { formatDoctorReport } from "./report.js";

const fakeRun: CommandRunner = async (_executable, args) => {
  if (args[0] === "--version") {
    return { ok: true, output: "9.9.9" };
  }
  if (args[0] === "unarchive") {
    return { ok: true, output: "usage" };
  }
  return null;
};

interface Sandbox {
  home: string;
  binDir: string;
  context: Parameters<typeof runDoctorChecks>[0];
  cleanup: () => Promise<void>;
}

async function createSandbox(options: { executables?: string[]; run?: CommandRunner } = {}): Promise<Sandbox> {
  const home = await mkdtemp(path.join(os.tmpdir(), "sesq-doctor-"));
  const binDir = path.join(home, "bin");
  await mkdir(binDir, { recursive: true });
  for (const name of options.executables ?? ["codex", "claude"]) {
    const file = path.join(binDir, name);
    await writeFile(file, "#!/bin/sh\n");
    await chmod(file, 0o755);
  }
  return {
    home,
    binDir,
    context: {
      home,
      env: { PATH: binDir },
      version: "0.1.0",
      nodeVersion: "v20.0.0",
      platform: "test-os",
      run: options.run ?? fakeRun,
    },
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

function codexLines(id: string, texts: string[]): string {
  const meta = { type: "session_meta", payload: { session_id: id, id, cwd: "/x", timestamp: "2026-01-01T00:00:00.000Z" } };
  const messages = texts.map((text) => ({
    type: "response_item",
    timestamp: "2026-01-01T00:00:01.000Z",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  }));
  return [meta, ...messages].map((line) => JSON.stringify(line)).join("\n");
}

function claudeLines(texts: string[]): string {
  return texts
    .map((text) =>
      JSON.stringify({ type: "user", cwd: "/x", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: text } }),
    )
    .join("\n");
}

async function writeCodex(home: string, folder: "sessions/2026/01/01" | "archived_sessions", id: string, texts: string[], suffix = "") {
  const dir = path.join(home, ".codex", folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `rollout-2026-01-01T00-00-00${suffix}-${id}.jsonl`), codexLines(id, texts));
}

async function writeClaude(home: string, id: string, content: string) {
  const dir = path.join(home, ".claude", "projects", "-x");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.jsonl`), content);
}

const CODEX_ID = "01a00000-0000-7000-8000-00000000000a";
const CLAUDE_ID = "22222222-2222-4222-8222-222222222222";

test("a healthy setup reports counts, versions and no problems", async () => {
  const sandbox = await createSandbox();
  try {
    await writeCodex(sandbox.home, "sessions/2026/01/01", CODEX_ID, ["hello"]);
    await writeClaude(sandbox.home, CLAUDE_ID, claudeLines(["hello"]));

    const report = await runDoctorChecks(sandbox.context);
    const codex = report.agents.find((a) => a.agent === "codex")!;
    const claude = report.agents.find((a) => a.agent === "claude")!;

    assert.equal(report.issueCount, 0);
    assert.equal(codex.sessionCount, 1);
    assert.equal(codex.archivedCount, 0);
    assert.equal(codex.executable.version, "9.9.9");
    assert.equal(codex.restoreAvailable, true);
    assert.equal(claude.sessionCount, 1);
    assert.equal(claude.restoreAvailable, null);
    assert.equal(report.configExists, false);
    assert.match(formatDoctorReport(report), /No problems found\./);
  } finally {
    await sandbox.cleanup();
  }
});

test("unreadable files are listed by path and reason without leaking their content", async () => {
  const sandbox = await createSandbox();
  try {
    await writeClaude(sandbox.home, CLAUDE_ID, `${claudeLines(["fine"])}\n{TOPSECRET-not-json`);
    await writeClaude(sandbox.home, "33333333-3333-4333-8333-333333333333", "TOPSECRET garbage only");

    const report = await runDoctorChecks(sandbox.context);
    const claude = report.agents.find((a) => a.agent === "claude")!;

    assert.equal(claude.unreadable.length, 2);
    assert.deepEqual(new Set(claude.unreadable.map((u) => u.reason)), new Set(["invalid JSON line", "no valid JSON lines"]));
    assert.ok(report.issueCount >= 1);
    assert.doesNotMatch(formatDoctorReport(report), /TOPSECRET/);
  } finally {
    await sandbox.cleanup();
  }
});

test("the same id in two files is a harmless duplicate when one history extends the other", async () => {
  const sandbox = await createSandbox();
  try {
    await writeCodex(sandbox.home, "sessions/2026/01/01", CODEX_ID, ["one"]);
    await writeCodex(sandbox.home, "archived_sessions", CODEX_ID, ["one", "two"], "-copy");

    const codex = (await runDoctorChecks(sandbox.context)).agents.find((a) => a.agent === "codex")!;

    assert.equal(codex.duplicates.length, 1);
    assert.equal(codex.duplicates[0].compatible, true);
    assert.equal(codex.issues.length, 0);
  } finally {
    await sandbox.cleanup();
  }
});

test("the same id with diverging histories is reported as a conflict", async () => {
  const sandbox = await createSandbox();
  try {
    await writeCodex(sandbox.home, "sessions/2026/01/01", CODEX_ID, ["one"]);
    await writeCodex(sandbox.home, "archived_sessions", CODEX_ID, ["something else"], "-copy");

    const report = await runDoctorChecks(sandbox.context);
    const codex = report.agents.find((a) => a.agent === "codex")!;

    assert.equal(codex.duplicates[0].compatible, false);
    assert.ok(codex.issues.some((issue) => /incompatible/.test(issue)));
    assert.match(formatDoctorReport(report), /CONFLICTING histories/);
  } finally {
    await sandbox.cleanup();
  }
});

test("sessions without an executable, and archived sessions without unarchive, are problems", async () => {
  const sandbox = await createSandbox({ executables: [] });
  try {
    await writeCodex(sandbox.home, "archived_sessions", CODEX_ID, ["one"]);

    const codex = (await runDoctorChecks(sandbox.context)).agents.find((a) => a.agent === "codex")!;

    assert.equal(codex.resumeAvailable, false);
    assert.equal(codex.restoreAvailable, false);
    assert.equal(codex.archivedCount, 1);
    assert.equal(codex.issues.length, 2);
  } finally {
    await sandbox.cleanup();
  }
});

test("an agent that is simply not installed is noted, not flagged", async () => {
  const sandbox = await createSandbox({ executables: [] });
  try {
    const report = await runDoctorChecks(sandbox.context);
    assert.equal(report.issueCount, 0);
    assert.ok(report.agents.every((agent) => agent.notes.includes("Not detected on this machine.")));
  } finally {
    await sandbox.cleanup();
  }
});

test("a disabled agent is not scanned", async () => {
  const sandbox = await createSandbox();
  try {
    await writeClaude(sandbox.home, CLAUDE_ID, claudeLines(["hello"]));
    const configDir = path.join(sandbox.home, ".config", "sesq");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "config.json"), JSON.stringify({ agents: { claude: { enabled: false } } }));

    const claude = (await runDoctorChecks(sandbox.context)).agents.find((a) => a.agent === "claude")!;

    assert.equal(claude.enabled, false);
    assert.equal(claude.sessionCount, 0);
    assert.match(formatDoctorReport(await runDoctorChecks(sandbox.context)), /Enabled:\s+no/);
  } finally {
    await sandbox.cleanup();
  }
});

test("an invalid config file is reported but the checks still run with defaults", async () => {
  const sandbox = await createSandbox();
  try {
    await writeClaude(sandbox.home, CLAUDE_ID, claudeLines(["hello"]));
    const configDir = path.join(sandbox.home, ".config", "sesq");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "config.json"), "{ nope");

    const report = await runDoctorChecks(sandbox.context);

    assert.ok(report.configError);
    assert.equal(report.agents.find((a) => a.agent === "claude")!.sessionCount, 1);
    assert.ok(report.issueCount >= 1);
    assert.match(formatDoctorReport(report), /Config file:.*\(invalid\)/);
  } finally {
    await sandbox.cleanup();
  }
});
