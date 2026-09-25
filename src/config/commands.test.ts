import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runConfigCommand } from "./commands.js";

async function withHome(run: (home: string, configPath: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(path.join(os.tmpdir(), "sesq-home-"));
  try {
    await run(home, path.join(home, ".config", "sesq", "config.json"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("`config path` prints the config file location", async () => {
  await withHome(async (home, configPath) => {
    const result = await runConfigCommand(["path"], { home, env: {} });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, `${configPath}\n`);
  });
});

test("`config` lists every setting with its source, without needing a file", async () => {
  await withHome(async (home) => {
    const result = await runConfigCommand([], { home, env: { CODEX_HOME: "/data/codex" } });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /not found, using defaults/);
    assert.match(result.stdout, /pageSize\s+5\s+\(default\)/);
    assert.match(result.stdout, /codex\.sessionsPath\s+\/data\/codex\/sessions\s+\(environment: CODEX_HOME\)/);
    assert.match(result.stdout, /claude\.sessionsPath\s+.*\.claude\/projects\s+\(default\)/);
  });
});

test("`config set` writes only the changed value and marks it custom afterwards", async () => {
  await withHome(async (home, configPath) => {
    const set = await runConfigCommand(["set", "pageSize", "10"], { home, env: {} });
    assert.equal(set.exitCode, 0);
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), { pageSize: 10 });

    const show = await runConfigCommand([], { home, env: {} });
    assert.match(show.stdout, /pageSize\s+10\s+\(custom\)/);
  });
});

test("`config set` handles nested agent keys, booleans and null paths", async () => {
  await withHome(async (home, configPath) => {
    await runConfigCommand(["set", "codex.executable", "/opt/codex"], { home, env: {} });
    await runConfigCommand(["set", "claude.enabled", "false"], { home, env: {} });
    await runConfigCommand(["set", "codex.sessionsPath", "/data/sessions"], { home, env: {} });
    await runConfigCommand(["set", "codex.sessionsPath", "null"], { home, env: {} });

    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
      agents: { codex: { executable: "/opt/codex", sessionsPath: null }, claude: { enabled: false } },
    });
  });
});

test("`config set` rejects unknown keys and bad values without touching the file", async () => {
  await withHome(async (home, configPath) => {
    const cases: string[][] = [
      ["set", "nope", "1"],
      ["set", "pageSize", "3"],
      ["set", "pageSize", "abc"],
      ["set", "defaultCwd", "elsewhere"],
      ["set", "showPreview", "maybe"],
      ["set", "codex.executable", ""],
      ["set", "pageSize"],
    ];
    for (const args of cases) {
      const result = await runConfigCommand(args, { home, env: {} });
      assert.equal(result.exitCode, 2, args.join(" "));
      assert.match(result.stderr, /Error:/);
    }
    await assert.rejects(readFile(configPath, "utf8"));
  });
});

test("an unknown subcommand prints usage and fails", async () => {
  await withHome(async (home) => {
    const result = await runConfigCommand(["frobnicate"], { home, env: {} });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /Usage:/);
  });
});

test("an invalid existing config file blocks show/set and is never overwritten", async () => {
  await withHome(async (home, configPath) => {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, "not json");

    const show = await runConfigCommand([], { home, env: {} });
    const set = await runConfigCommand(["set", "pageSize", "10"], { home, env: {} });

    assert.equal(show.exitCode, 2);
    assert.equal(set.exitCode, 2);
    assert.equal(await readFile(configPath, "utf8"), "not json");
  });
});
