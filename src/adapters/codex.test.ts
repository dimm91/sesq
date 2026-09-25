import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createCodexAdapter } from "./codex.js";

function sessionLines(sessionId: string, opts: { includeSessionMeta: boolean }): string[] {
  const lines: unknown[] = [];

  if (opts.includeSessionMeta) {
    lines.push({
      timestamp: "2026-01-01T10:00:00.000Z",
      type: "session_meta",
      payload: {
        session_id: sessionId,
        id: sessionId,
        timestamp: "2026-01-01T09:59:00.000Z",
        cwd: "/fake/repo",
        originator: "Codex CLI",
        cli_version: "1.0.0",
      },
    });
  }

  lines.push(
    {
      timestamp: "2026-01-01T10:00:01.000Z",
      type: "response_item",
      payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "You are Codex..." }] },
    },
    {
      timestamp: "2026-01-01T10:00:02.000Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "why does the build fail on CI" }] },
    },
    {
      timestamp: "2026-01-01T10:00:03.000Z",
      type: "response_item",
      payload: { type: "reasoning", summary: [] },
    },
    {
      timestamp: "2026-01-01T10:00:04.000Z",
      type: "response_item",
      payload: { type: "custom_tool_call", name: "shell", arguments: "{}" },
    },
    {
      timestamp: "2026-01-01T10:00:05.000Z",
      type: "response_item",
      payload: { type: "custom_tool_call_output", output: "exit 0" },
    },
    {
      timestamp: "2026-01-01T10:00:06.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "The CI build fails because of a missing dependency." }],
      },
    },
    {
      timestamp: "2026-01-01T10:00:07.000Z",
      type: "event_msg",
      payload: { type: "token_count", info: {} },
    },
  );

  return lines.map((line) => JSON.stringify(line));
}

async function createTmpRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "sesq-codex-"));
}

test("discovers active and archived sessions, filters developer/reasoning/tool lines", async () => {
  const codexHome = await createTmpRoot();
  try {
    const activeId = "01a00000-0000-7000-8000-000000000001";
    const archivedId = "01a00000-0000-7000-8000-000000000002";

    const activeDir = path.join(codexHome, "sessions", "2026", "01", "01");
    await mkdir(activeDir, { recursive: true });
    const activeLines = sessionLines(activeId, { includeSessionMeta: true });
    activeLines.push("{bad json");
    await writeFile(path.join(activeDir, `rollout-2026-01-01T10-00-00-${activeId}.jsonl`), activeLines.join("\n"));

    const archivedDir = path.join(codexHome, "archived_sessions");
    await mkdir(archivedDir, { recursive: true });
    await writeFile(
      path.join(archivedDir, `rollout-2026-01-02T10-00-00-${archivedId}.jsonl`),
      sessionLines(archivedId, { includeSessionMeta: true }).join("\n"),
    );

    const adapter = createCodexAdapter({ codexHome });
    assert.equal(await adapter.isAvailable(), true);

    const errors: Array<{ sourcePath: string; error: Error }> = [];
    const sessions = [];
    for await (const session of adapter.discoverSessions((sourcePath, error) => errors.push({ sourcePath, error }))) {
      sessions.push(session);
    }

    assert.equal(sessions.length, 2);
    const active = sessions.find((s) => s.id === activeId);
    const archived = sessions.find((s) => s.id === archivedId);
    assert.ok(active);
    assert.ok(archived);

    assert.equal(active.agent, "codex");
    assert.equal(active.cwd, "/fake/repo");
    assert.equal(active.archived, false);
    assert.equal(active.title, "why does the build fail on CI");
    assert.deepEqual(active.createdAt, new Date("2026-01-01T09:59:00.000Z"));
    assert.deepEqual(
      active.messages.map((m) => ({ role: m.role, content: m.content })),
      [
        { role: "user", content: "why does the build fail on CI" },
        { role: "assistant", content: "The CI build fails because of a missing dependency." },
      ],
    );

    assert.equal(archived.archived, true);

    assert.equal(errors.length, 1);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("falls back to the filename UUID when session_meta is missing", async () => {
  const codexHome = await createTmpRoot();
  try {
    const filenameId = "01a00000-0000-7000-8000-000000000003";
    const activeDir = path.join(codexHome, "sessions", "2026", "01", "03");
    await mkdir(activeDir, { recursive: true });
    await writeFile(
      path.join(activeDir, `rollout-2026-01-03T10-00-00-${filenameId}.jsonl`),
      sessionLines(filenameId, { includeSessionMeta: false }).join("\n"),
    );

    const adapter = createCodexAdapter({ codexHome });
    const sessions = [];
    for await (const session of adapter.discoverSessions()) {
      sessions.push(session);
    }

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, filenameId);
    assert.equal(sessions[0].cwd, null);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("buildResumeCommand and buildUnarchiveCommand shape", () => {
  const adapter = createCodexAdapter({ codexHome: os.tmpdir() });
  const session = {
    id: "abc",
    agent: "codex" as const,
    title: null,
    cwd: null,
    createdAt: null,
    modifiedAt: new Date(),
    archived: true,
    messages: [],
    sourcePath: "irrelevant",
  };
  assert.deepEqual(adapter.buildResumeCommand(session), { executable: "codex", args: ["resume", "abc"] });
  assert.deepEqual(adapter.buildUnarchiveCommand?.(session), { executable: "codex", args: ["unarchive", "abc"] });
});

test("uses the configured executable for resume and unarchive commands", () => {
  const adapter = createCodexAdapter({ codexHome: os.tmpdir(), executable: "/opt/bin/codex" });
  const session = {
    id: "abc",
    agent: "codex" as const,
    title: null,
    cwd: null,
    createdAt: null,
    modifiedAt: new Date(),
    archived: true,
    messages: [],
    sourcePath: "irrelevant",
  };
  assert.deepEqual(adapter.buildResumeCommand(session), { executable: "/opt/bin/codex", args: ["resume", "abc"] });
  assert.deepEqual(adapter.buildUnarchiveCommand?.(session), { executable: "/opt/bin/codex", args: ["unarchive", "abc"] });
});

test("explicit directories work with any folder name and archived status comes from the root", async () => {
  const root = await createTmpRoot();
  try {
    const activeId = "01a00000-0000-7000-8000-000000000004";
    const archivedId = "01a00000-0000-7000-8000-000000000005";
    const activeDir = path.join(root, "my-active");
    const archivedDir = path.join(root, "old-stuff");
    await mkdir(activeDir, { recursive: true });
    await mkdir(archivedDir, { recursive: true });
    await writeFile(
      path.join(activeDir, `rollout-2026-01-04T10-00-00-${activeId}.jsonl`),
      sessionLines(activeId, { includeSessionMeta: true }).join("\n"),
    );
    await writeFile(
      path.join(archivedDir, `rollout-2026-01-05T10-00-00-${archivedId}.jsonl`),
      sessionLines(archivedId, { includeSessionMeta: true }).join("\n"),
    );

    const adapter = createCodexAdapter({ sessionsDir: activeDir, archivedDir });
    const sessions = [];
    for await (const session of adapter.discoverSessions()) {
      sessions.push(session);
    }

    assert.equal(sessions.length, 2);
    assert.equal(sessions.find((s) => s.id === activeId)?.archived, false);
    assert.equal(sessions.find((s) => s.id === archivedId)?.archived, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("includeArchived false skips the archived directory entirely", async () => {
  const codexHome = await createTmpRoot();
  try {
    const activeId = "01a00000-0000-7000-8000-000000000006";
    const archivedId = "01a00000-0000-7000-8000-000000000007";
    const activeDir = path.join(codexHome, "sessions", "2026", "01", "06");
    const archivedDir = path.join(codexHome, "archived_sessions");
    await mkdir(activeDir, { recursive: true });
    await mkdir(archivedDir, { recursive: true });
    await writeFile(
      path.join(activeDir, `rollout-2026-01-06T10-00-00-${activeId}.jsonl`),
      sessionLines(activeId, { includeSessionMeta: true }).join("\n"),
    );
    await writeFile(
      path.join(archivedDir, `rollout-2026-01-07T10-00-00-${archivedId}.jsonl`),
      sessionLines(archivedId, { includeSessionMeta: true }).join("\n"),
    );

    const adapter = createCodexAdapter({ codexHome, includeArchived: false });
    const ids = [];
    for await (const session of adapter.discoverSessions()) {
      ids.push(session.id);
    }
    assert.deepEqual(ids, [activeId]);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

function metaLine(payload: Record<string, unknown>): string {
  return JSON.stringify({ type: "session_meta", timestamp: "2026-01-01T10:00:00.000Z", payload });
}

function userLine(text: string): string {
  return JSON.stringify({
    type: "response_item",
    timestamp: "2026-01-01T10:00:02.000Z",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  });
}

test("identity is the thread id (payload.id), not a parent session_id", async () => {
  const codexHome = await createTmpRoot();
  try {
    const threadId = "01a00000-0000-7000-8000-000000000008";
    const otherSessionId = "01a00000-0000-7000-8000-0000000000ff";
    const dir = path.join(codexHome, "sessions", "2026", "01", "08");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `rollout-2026-01-08T10-00-00-${threadId}.jsonl`),
      [metaLine({ id: threadId, session_id: otherSessionId, cwd: "/x" }), userLine("hello")].join("\n"),
    );

    const ids = [];
    for await (const session of createCodexAdapter({ codexHome }).discoverSessions()) {
      ids.push(session.id);
    }
    assert.deepEqual(ids, [threadId]);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test("subagent threads are skipped and do not hide their parent session", async () => {
  const codexHome = await createTmpRoot();
  try {
    const parentId = "01a00000-0000-7000-8000-000000000009";
    const childId = "01a00000-0000-7000-8000-00000000000a";
    const dir = path.join(codexHome, "sessions", "2026", "01", "09");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `rollout-2026-01-09T10-00-00-${parentId}.jsonl`),
      [metaLine({ id: parentId, session_id: parentId, cwd: "/x" }), userLine("real question")].join("\n"),
    );
    await writeFile(
      path.join(dir, `rollout-2026-01-09T11-00-00-${childId}.jsonl`),
      [
        metaLine({
          id: childId,
          session_id: parentId,
          parent_thread_id: parentId,
          thread_source: "guardian_review",
          source: { subagent: { other: "guardian" } },
        }),
        userLine("auto-generated review prompt"),
      ].join("\n"),
    );

    const sessions = [];
    for await (const session of createCodexAdapter({ codexHome }).discoverSessions()) {
      sessions.push(session);
    }
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, parentId);
    assert.equal(sessions[0].messages[0].content, "real question");
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
