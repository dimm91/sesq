import assert from "node:assert/strict";
import { test } from "node:test";
import { describeConfig, expandHome, resolvePaths } from "./effective.js";
import { validateConfig } from "./schema.js";

function configFrom(raw: Record<string, unknown>) {
  const result = validateConfig(raw);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.config;
}

test("expandHome expands a leading ~ only", () => {
  assert.equal(expandHome("~", "/home/d"), "/home/d");
  assert.equal(expandHome("~/x/y", "/home/d"), "/home/d/x/y");
  assert.equal(expandHome("/abs/~/x", "/home/d"), "/abs/~/x");
  assert.equal(expandHome("relative", "/home/d"), "relative");
});

test("uses the documented default locations when nothing is configured", () => {
  const paths = resolvePaths(configFrom({}), {}, "/home/d");
  assert.deepEqual(paths.codexSessions, { path: "/home/d/.codex/sessions", source: "default" });
  assert.deepEqual(paths.codexArchived, { path: "/home/d/.codex/archived_sessions", source: "default" });
  assert.deepEqual(paths.claudeProjects, { path: "/home/d/.claude/projects", source: "default" });
});

test("environment variables replace the default base directory", () => {
  const paths = resolvePaths(configFrom({}), { CODEX_HOME: "/data/codex", CLAUDE_CONFIG_DIR: "/data/claude" }, "/home/d");
  assert.deepEqual(paths.codexSessions, { path: "/data/codex/sessions", source: "environment", detail: "CODEX_HOME" });
  assert.deepEqual(paths.codexArchived, {
    path: "/data/codex/archived_sessions",
    source: "environment",
    detail: "CODEX_HOME",
  });
  assert.deepEqual(paths.claudeProjects, {
    path: "/data/claude/projects",
    source: "environment",
    detail: "CLAUDE_CONFIG_DIR",
  });
});

test("an explicit config path wins over the environment and expands ~", () => {
  const config = configFrom({ agents: { codex: { sessionsPath: "~/custom/codex" }, claude: { sessionsPath: "/x/claude" } } });
  const paths = resolvePaths(config, { CODEX_HOME: "/data/codex", CLAUDE_CONFIG_DIR: "/data/claude" }, "/home/d");
  assert.deepEqual(paths.codexSessions, { path: "/home/d/custom/codex", source: "custom" });
  assert.deepEqual(paths.claudeProjects, { path: "/x/claude", source: "custom" });
  assert.equal(paths.codexArchived.source, "environment");
});

test("describeConfig labels each value as default, environment or custom", () => {
  const raw = { pageSize: 10, agents: { codex: { executable: "/opt/codex" } } };
  const settings = describeConfig(raw, configFrom(raw), { CODEX_HOME: "/data/codex" }, "/home/d");
  const byKey = Object.fromEntries(settings.map((s) => [s.key, s]));

  assert.deepEqual(byKey.pageSize, { key: "pageSize", value: "10", source: "custom" });
  assert.equal(byKey.defaultCwd.source, "default");
  assert.equal(byKey["codex.executable"].source, "custom");
  assert.equal(byKey["claude.executable"].source, "default");
  assert.equal(byKey["codex.sessionsPath"].source, "environment");
  assert.equal(byKey["codex.sessionsPath"].detail, "CODEX_HOME");
  assert.equal(byKey["claude.sessionsPath"].value, "/home/d/.claude/projects");
});
