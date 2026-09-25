import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createClaudeAdapter } from "./claude.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const SESSION_LINES = [
  { type: "mode", mode: "normal" },
  {
    type: "user",
    cwd: "/fake/project",
    timestamp: "2026-01-01T10:00:00.000Z",
    message: { role: "user", content: "how do I fix the login timeout bug" },
  },
  {
    type: "assistant",
    timestamp: "2026-01-01T10:00:05.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "let me look at the code" },
        { type: "tool_use", name: "Read", input: {} },
      ],
    },
  },
  {
    type: "user",
    timestamp: "2026-01-01T10:00:06.000Z",
    message: { role: "user", content: [{ type: "tool_result", content: "file contents" }] },
  },
  {
    type: "assistant",
    timestamp: "2026-01-01T10:00:10.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "The bug is in the session refresh logic." }] },
  },
  {
    type: "user",
    isSidechain: true,
    timestamp: "2026-01-01T10:00:11.000Z",
    message: { role: "user", content: "sub-agent task" },
  },
  {
    type: "assistant",
    isSidechain: true,
    timestamp: "2026-01-01T10:00:12.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "sub-agent result" }] },
  },
  { type: "ai-title", aiTitle: "Fix login timeout bug", sessionId: SESSION_ID },
];

async function createFixture(): Promise<{ projectsDir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "sesq-claude-"));
  const projectsDir = path.join(root, "projects");
  const projectDir = path.join(projectsDir, "-fake-project");
  await mkdir(projectDir, { recursive: true });

  const lines = SESSION_LINES.map((line) => JSON.stringify(line));
  lines.push("{not valid json");

  await writeFile(path.join(projectDir, `${SESSION_ID}.jsonl`), lines.join("\n"));

  return { projectsDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("discovers a session, filters out thinking/tool blocks and sidechains", async () => {
  const { projectsDir, cleanup } = await createFixture();
  try {
    const adapter = createClaudeAdapter({ projectsDir });
    assert.equal(await adapter.isAvailable(), true);

    const errors: Array<{ sourcePath: string; error: Error }> = [];
    const sessions = [];
    for await (const session of adapter.discoverSessions((sourcePath, error) => errors.push({ sourcePath, error }))) {
      sessions.push(session);
    }

    assert.equal(sessions.length, 1);
    const [session] = sessions;

    assert.equal(session.id, SESSION_ID);
    assert.equal(session.agent, "claude");
    assert.equal(session.title, "Fix login timeout bug");
    assert.equal(session.cwd, "/fake/project");
    assert.equal(session.archived, null);
    assert.deepEqual(
      session.messages.map((m) => ({ role: m.role, content: m.content })),
      [
        { role: "user", content: "how do I fix the login timeout bug" },
        { role: "assistant", content: "The bug is in the session refresh logic." },
      ],
    );

    assert.equal(errors.length, 1);
    assert.equal(errors[0].sourcePath.endsWith(`${SESSION_ID}.jsonl`), true);
    assert.ok(errors[0].error instanceof Error);
  } finally {
    await cleanup();
  }
});

test("reports unavailable when the projects directory does not exist", async () => {
  const adapter = createClaudeAdapter({ projectsDir: path.join(os.tmpdir(), "sesq-does-not-exist") });
  assert.equal(await adapter.isAvailable(), false);
});

test("buildResumeCommand uses claude --resume <id>", () => {
  const adapter = createClaudeAdapter({ projectsDir: os.tmpdir() });
  const command = adapter.buildResumeCommand({
    id: "abc",
    agent: "claude",
    title: null,
    cwd: null,
    createdAt: null,
    modifiedAt: new Date(),
    archived: null,
    messages: [],
    sourcePath: "irrelevant",
  });
  assert.deepEqual(command, { executable: "claude", args: ["--resume", "abc"] });
});

test("buildResumeCommand uses the configured executable", () => {
  const adapter = createClaudeAdapter({ projectsDir: os.tmpdir(), executable: "/opt/bin/claude" });
  const command = adapter.buildResumeCommand({
    id: "abc",
    agent: "claude",
    title: null,
    cwd: null,
    createdAt: null,
    modifiedAt: new Date(),
    archived: null,
    messages: [],
    sourcePath: "irrelevant",
  });
  assert.deepEqual(command, { executable: "/opt/bin/claude", args: ["--resume", "abc"] });
});
