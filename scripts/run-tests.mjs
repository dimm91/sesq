import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const files = readdirSync(root, { recursive: true })
  .filter((file) => String(file).endsWith(".test.js"))
  .map((file) => path.join(root, String(file)));

if (files.length === 0) {
  console.error("No compiled test files found in dist/. Run `npm run build` first.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
