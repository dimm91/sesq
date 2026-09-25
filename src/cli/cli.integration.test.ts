import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const MAIN = fileURLToPath(new URL("./main.js", import.meta.url));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface Sandbox {
  home: string;
  binDir: string;
  run: (args: string[], extraEnv?: Record<string, string>) => Promise<RunResult>;
  cleanup: () => Promise<void>;
}

const CLAUDE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CODEX_ID = "01a00000-0000-7000-8000-0000000000c1";

async function createSandbox(): Promise<Sandbox> {
  const home = await mkdtemp(path.join(os.tmpdir(), "sesq-cli-"));
  const binDir = path.join(home, "bin");
  await mkdir(binDir, { recursive: true });
  for (const name of ["codex", "claude"]) {
    const file = path.join(binDir, name);
    await writeFile(file, "#!/bin/sh\necho 1.0.0\n");
    await chmod(file, 0o755);
  }

  const claudeDir = path.join(home, ".claude", "projects", "-work-store");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(
    path.join(claudeDir, `${CLAUDE_ID}.jsonl`),
    [
      { type: "ai-title", aiTitle: "Store checkout bug", sessionId: CLAUDE_ID },
      { type: "user", cwd: "/work/store", timestamp: "2026-01-01T10:00:00.000Z", message: { role: "user", content: "why does checkout fail with a timeout" } },
      { type: "assistant", timestamp: "2026-01-01T10:00:05.000Z", message: { role: "assistant", content: [{ type: "text", text: "The payment call times out after 5 seconds." }] } },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );

  const codexDir = path.join(home, ".codex", "sessions", "2026", "01", "01");
  await mkdir(codexDir, { recursive: true });
  await writeFile(
    path.join(codexDir, `rollout-2026-01-01T10-00-00-${CODEX_ID}.jsonl`),
    [
      { type: "session_meta", payload: { id: CODEX_ID, session_id: CODEX_ID, cwd: "/work/blog", timestamp: "2026-01-01T10:00:00.000Z" } },
      { type: "response_item", timestamp: "2026-01-01T10:00:01.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "fix the blog timeout on rss feed" }] } },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );

  const run = (args: string[], extraEnv: Record<string, string> = {}) =>
    new Promise<RunResult>((resolve) => {
      execFile(
        process.execPath,
        [MAIN, ...args],
        { env: { HOME: home, PATH: binDir, NO_COLOR: "1", ...extraEnv }, timeout: 20000 },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === "number" ? error.code : 99) : 0;
          resolve({ code, stdout, stderr });
        },
      );
    });

  return { home, binDir, run, cleanup: () => rm(home, { recursive: true, force: true }) };
}

async function withSandbox(body: (sandbox: Sandbox) => Promise<void>): Promise<void> {
  const sandbox = await createSandbox();
  try {
    await body(sandbox);
  } finally {
    await sandbox.cleanup();
  }
}

test("--version prints the package version", async () => {
  await withSandbox(async ({ run }) => {
    const result = await run(["--version"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^\d+\.\d+\.\d+/);
  });
});

test("a search across both agents lists results and exits 0 (non-interactive)", async () => {
  await withSandbox(async ({ run }) => {
    const result = await run(["timeout"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Agent:\s+Claude Code/);
    assert.match(result.stdout, /Agent:\s+Codex/);
    assert.match(result.stdout, /Title:\s+Store checkout bug/);
    assert.match(result.stdout, /2 sessions scanned · 2 results/);
    assert.match(result.stdout, /Non-interactive session/);
    assert.equal(result.stderr, "");
  });
});

test("no matches exits 1", async () => {
  await withSandbox(async ({ run }) => {
    const result = await run(["zzzqqqxxx"]);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /No results\./);
  });
});

test("usage errors exit 2 with a message on stderr", async () => {
  await withSandbox(async ({ run }) => {
    for (const args of [[], ["x", "--agent", "gemini"], ["x", "--case-sensitive"], ["x", "--page-size", "2"], ["x", "--since", "soon"]]) {
      const result = await run(args);
      assert.equal(result.code, 2, args.join(" "));
      assert.match(result.stderr, /^Error:/);
    }
  });
});

test("an unsafe regular expression exits 2 before scanning", async () => {
  await withSandbox(async ({ run }) => {
    const result = await run(["(a+)+", "--regex"]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /catastrophic backtracking/);
  });
});

test("--regex, --fixed and --case-sensitive behave as documented", async () => {
  await withSandbox(async ({ run }) => {
    assert.match((await run(["times? out", "--regex"])).stdout, /1 result/);
    assert.equal((await run(["TIMEOUT", "--regex", "--case-sensitive"])).code, 1);
    assert.equal((await run(["checkout timeout"])).code, 0);
    assert.equal((await run(["checkout timeout", "--fixed"])).code, 1);
    assert.equal((await run(["timeout on rss", "--fixed"])).code, 0);
  });
});

test("--agent, --path and --since narrow the results", async () => {
  await withSandbox(async ({ run, home }) => {
    const onlyCodex = await run(["timeout", "--agent", "codex"]);
    assert.match(onlyCodex.stdout, /1 result/);
    assert.doesNotMatch(onlyCodex.stdout, /Claude Code/);

    const byPath = await run(["timeout", "--path", "work/store"]);
    assert.match(byPath.stdout, /1 result/);
    assert.match(byPath.stdout, /Claude Code/);

    const old = new Date("2020-01-01T00:00:00.000Z");
    await utimes(path.join(home, ".claude", "projects", "-work-store", `${CLAUDE_ID}.jsonl`), old, old);
    const recent = await run(["timeout", "--since", "30d"]);
    assert.match(recent.stdout, /1 result/);
    assert.doesNotMatch(recent.stdout, /Claude Code/);
  });
});

test("--no-preview hides snippets", async () => {
  await withSandbox(async ({ run }) => {
    const result = await run(["timeout", "--no-preview"]);
    assert.match(result.stdout, /Snippet:\s+Hidden/);
    assert.doesNotMatch(result.stdout, /payment call/);
  });
});

test("an unreadable session is skipped with a count only, never its content", async () => {
  await withSandbox(async ({ run, home }) => {
    await writeFile(path.join(home, ".claude", "projects", "-work-store", "bad.jsonl"), "SECRET-CONTENT not json");
    const result = await run(["timeout"]);
    assert.equal(result.code, 0);
    assert.match(result.stderr, /1 session file could not be fully read.*sesq doctor/);
    assert.doesNotMatch(result.stdout + result.stderr, /SECRET-CONTENT/);
  });
});

test("config set/show round-trips through the real config file", async () => {
  await withSandbox(async ({ run, home }) => {
    assert.equal((await run(["config", "path"])).stdout.trim(), path.join(home, ".config", "sesq", "config.json"));
    assert.equal((await run(["config", "set", "showPreview", "false"])).code, 0);
    assert.match((await run(["config"])).stdout, /showPreview\s+false\s+\(custom\)/);
    assert.match((await run(["timeout"])).stdout, /Snippet:\s+Hidden/);
  });
});

test("a disabled agent cannot be selected and disabling all agents is an error", async () => {
  await withSandbox(async ({ run }) => {
    await run(["config", "set", "claude.enabled", "false"]);
    const selected = await run(["timeout", "--agent", "claude"]);
    assert.equal(selected.code, 2);
    assert.match(selected.stderr, /disabled/);

    await run(["config", "set", "codex.enabled", "false"]);
    const none = await run(["timeout"]);
    assert.equal(none.code, 2);
    assert.match(none.stderr, /all agents are disabled/);
  });
});

test("an invalid config file stops the search with exit 2 and is left untouched", async () => {
  await withSandbox(async ({ run, home }) => {
    const configPath = path.join(home, ".config", "sesq", "config.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, '{"pageSize": 1}');
    const result = await run(["timeout"]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /pageSize/);
  });
});

test("doctor exits 0 on a healthy setup and 1 when something is wrong", async () => {
  await withSandbox(async ({ run, home }) => {
    const healthy = await run(["doctor"]);
    assert.equal(healthy.code, 0, healthy.stdout);
    assert.match(healthy.stdout, /No problems found\./);
    assert.match(healthy.stdout, /Sessions found:\s+1/);

    await writeFile(path.join(home, ".claude", "projects", "-work-store", "bad.jsonl"), "garbage");
    const unhealthy = await run(["doctor"]);
    assert.equal(unhealthy.code, 1);
    assert.match(unhealthy.stdout, /1 problem found\./);
  });
});

test("`sesq -- doctor` searches for the literal word instead of running the subcommand", async () => {
  await withSandbox(async ({ run }) => {
    const result = await run(["--", "doctor"]);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /No results\./);
  });
});
