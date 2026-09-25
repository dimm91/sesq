import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getConfigPath, loadConfig, saveRawConfig } from "./load.js";
import { DEFAULT_CONFIG } from "./schema.js";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sesq-config-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("getConfigPath points at ~/.config/sesq/config.json", () => {
  assert.equal(getConfigPath("/home/alex"), "/home/alex/.config/sesq/config.json");
});

test("a missing config file yields the defaults and reports it does not exist", async () => {
  await withTempDir(async (dir) => {
    const result = await loadConfig(path.join(dir, "missing.json"));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.exists, false);
      assert.deepEqual(result.raw, {});
      assert.deepEqual(result.config, DEFAULT_CONFIG);
    }
  });
});

test("loads and merges a partial config file", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "config.json");
    await writeFile(file, JSON.stringify({ pageSize: 12 }));
    const result = await loadConfig(file);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.exists, true);
      assert.deepEqual(result.raw, { pageSize: 12 });
      assert.equal(result.config.pageSize, 12);
      assert.equal(result.config.showPreview, true);
    }
  });
});

test("invalid JSON is reported without echoing file content", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "config.json");
    await writeFile(file, "{ secret-looking-content");
    const result = await loadConfig(file);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /not valid JSON/);
      assert.doesNotMatch(result.error, /secret-looking-content/);
    }
  });
});

test("schema violations are reported with the file path", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "config.json");
    await writeFile(file, JSON.stringify({ pageSize: 2 }));
    const result = await loadConfig(file);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /pageSize/);
      assert.ok(result.error.includes(file));
    }
  });
});

test("saveRawConfig creates missing directories and writes pretty JSON", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "nested", "sesq", "config.json");
    await saveRawConfig(file, { pageSize: 8 });
    const text = await readFile(file, "utf8");
    assert.equal(text, '{\n  "pageSize": 8\n}\n');
  });
});
