// Generates a synthetic session collection in a temporary HOME and measures the built CLI against it.
// Usage: node scripts/benchmark.mjs [--sessions 4000] [--kb 60] [--big 10] [--big-mb 40]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), Number(process.argv[i + 1]));
}
const sessions = args.get("sessions") ?? 4000;
const kb = args.get("kb") ?? 60;
const big = args.get("big") ?? 10;
const bigMb = args.get("big-mb") ?? 40;

const main = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli", "main.js");
const home = mkdtempSync(path.join(os.tmpdir(), "sesq-bench-"));
const words = "the quick error timeout session request payload response cache token refresh render deploy build config retry".split(" ");
let seed = 42;
const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const sentence = (n) => Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(" ");

function claudeFile(targetBytes) {
  const lines = [];
  let size = 0;
  while (size < targetBytes) {
    const user = JSON.stringify({ type: "user", cwd: "/bench/project", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: sentence(40) } });
    const assistant = JSON.stringify({ type: "assistant", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text: sentence(120) }] } });
    const toolResult = JSON.stringify({ type: "user", timestamp: "2026-01-01T00:00:02.000Z", message: { role: "user", content: [{ type: "tool_result", content: sentence(400) }] } });
    lines.push(user, assistant, toolResult);
    size += user.length + assistant.length + toolResult.length + 3;
  }
  return lines.join("\n");
}

const projectDir = path.join(home, ".claude", "projects", "-bench");
mkdirSync(projectDir, { recursive: true });
const total = sessions + big;
for (let i = 0; i < total; i++) {
  const bytes = i < big ? bigMb * 1024 * 1024 : kb * 1024;
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  writeFileSync(path.join(projectDir, `${id}.jsonl`), claudeFile(bytes));
}
const sizeMb = Number(execFileSync("du", ["-sk", home]).toString().split("\t")[0]) / 1024;
console.log(`Generated ${total} sessions (${sizeMb.toFixed(0)} MB) in ${home}\n`);

function measure(query) {
  const isMac = process.platform === "darwin";
  const timeArgs = isMac ? ["-l"] : ["-v"];
  const started = Date.now();
  const result = spawnSync("/usr/bin/time", [...timeArgs, process.execPath, main, query], {
    env: { ...process.env, HOME: home, NO_COLOR: "1" },
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const elapsed = (Date.now() - started) / 1000;
  const rss = isMac
    ? Number(/(\d+)\s+maximum resident set size/.exec(result.stderr)?.[1] ?? 0) / 1024 / 1024
    : Number(/Maximum resident set size \(kbytes\): (\d+)/.exec(result.stderr)?.[1] ?? 0) / 1024;
  const summary = result.stdout.split("\n").filter((line) => /sessions? scanned/.test(line))[0] ?? "";
  console.log(`query "${query}": ${elapsed.toFixed(1)} s, peak RSS ${rss.toFixed(0)} MB, ${summary}`);
}

measure("zzzqqq");
measure("error timeout");
measure("the");

rmSync(home, { recursive: true, force: true });
