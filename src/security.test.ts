import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const distDir = path.dirname(fileURLToPath(import.meta.url));

async function productionFiles(): Promise<Array<{ file: string; text: string }>> {
  const entries = (await readdir(distDir, { recursive: true })).map(String);
  const files = entries.filter((entry) => entry.endsWith(".js") && !entry.endsWith(".test.js"));
  return Promise.all(files.map(async (file) => ({ file, text: await readFile(path.join(distDir, file), "utf8") })));
}

function offenders(files: Array<{ file: string; text: string }>, pattern: RegExp, allowed: string[] = []): string[] {
  return files.filter(({ file, text }) => !allowed.includes(file) && pattern.test(text)).map(({ file }) => file);
}

test("the scan actually covers the production sources", async () => {
  const files = (await productionFiles()).map(({ file }) => file);
  assert.ok(files.length >= 20, `only ${files.length} files scanned`);
  assert.ok(files.includes(path.join("cli", "main.js")));
  assert.ok(files.includes(path.join("adapters", "codex.js")));
});

test("nothing in the package can open a network connection", async () => {
  const files = await productionFiles();
  const networkImport = /(?:from\s+|require\(\s*)["'](?:node:)?(?:https?|http2|net|tls|dgram|dns|dns\/promises)["']/;
  assert.deepEqual(offenders(files, networkImport), []);
  assert.deepEqual(offenders(files, /\bfetch\s*\(|XMLHttpRequest|WebSocket/), []);
});

test("commands are never run through a shell", async () => {
  const files = await productionFiles();
  assert.deepEqual(offenders(files, /shell\s*:\s*true/), []);
  const shellApis = "exec|execSync|spawnSync|execFileSync";
  const namedImport = new RegExp(`import\\s*\\{[^}]*\\b(?:${shellApis})\\b[^}]*\\}\\s*from\\s*["'](?:node:)?child_process["']`);
  const bareCall = new RegExp(`(?<![\\w.])(?:${shellApis})\\s*\\(`);
  assert.deepEqual(offenders(files, namedImport), []);
  assert.deepEqual(offenders(files, bareCall), []);
  assert.deepEqual(offenders(files, /child_process\s*\.\s*(?:exec|execSync|spawnSync|execFileSync)\b/), []);
});

test("only the config module writes to disk", async () => {
  const files = await productionFiles();
  const writes = /\b(?:writeFile|appendFile|createWriteStream|unlink|rmdir|rm|rename|copyFile|truncate|chmod|symlink|mkdir)\b\s*\(|\bwriteFileSync\b/;
  assert.deepEqual(offenders(files, writes, [path.join("config", "load.js")]), []);
});
