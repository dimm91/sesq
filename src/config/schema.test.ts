import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, validateConfig } from "./schema.js";

test("an empty object yields the default configuration", () => {
  const result = validateConfig({});
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.config, DEFAULT_CONFIG);
  }
});

test("partial settings are merged over the defaults", () => {
  const result = validateConfig({ pageSize: 10, agents: { codex: { executable: "/opt/codex" } } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.pageSize, 10);
    assert.equal(result.config.agents.codex.executable, "/opt/codex");
    assert.equal(result.config.agents.codex.enabled, true);
    assert.equal(result.config.agents.claude.executable, "claude");
  }
});

test("the defaults object is never mutated by validation", () => {
  validateConfig({ pageSize: 25, agents: { claude: { enabled: false } } });
  assert.equal(DEFAULT_CONFIG.pageSize, 5);
  assert.equal(DEFAULT_CONFIG.agents.claude.enabled, true);
});

test("accepts null paths and string paths", () => {
  const result = validateConfig({ agents: { codex: { sessionsPath: "/x", archivedSessionsPath: null } } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.agents.codex.sessionsPath, "/x");
    assert.equal(result.config.agents.codex.archivedSessionsPath, null);
  }
});

test("rejects invalid values with a message naming the setting", () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ pageSize: 3 }, /pageSize/],
    [{ pageSize: "10" }, /pageSize/],
    [{ pageSize: 7.5 }, /pageSize/],
    [{ defaultCwd: "elsewhere" }, /defaultCwd/],
    [{ includeArchived: "yes" }, /includeArchived/],
    [{ showPreview: 1 }, /showPreview/],
    [{ agents: { codex: { enabled: "true" } } }, /agents\.codex\.enabled/],
    [{ agents: { claude: { executable: "" } } }, /agents\.claude\.executable/],
    [{ agents: { claude: { sessionsPath: 5 } } }, /agents\.claude\.sessionsPath/],
    [{ agents: { codex: { archivedSessionsPath: "" } } }, /archivedSessionsPath/],
  ];
  for (const [input, pattern] of cases) {
    const result = validateConfig(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) {
      assert.match(result.error, pattern);
    }
  }
});

test("rejects unknown settings so typos are not silently ignored", () => {
  assert.equal(validateConfig({ pagesize: 10 }).ok, false);
  assert.equal(validateConfig({ agents: { codex: { colour: "red" } } }).ok, false);
  assert.equal(validateConfig({ agents: { gemini: {} } }).ok, false);
  assert.equal(validateConfig({ agents: { claude: { archivedSessionsPath: "/x" } } }).ok, false);
});

test("tolerates a copilot entry since that agent is planned but not supported yet", () => {
  assert.equal(validateConfig({ agents: { copilot: { enabled: true, executable: "copilot" } } }).ok, true);
});

test("rejects non-object roots", () => {
  assert.equal(validateConfig([]).ok, false);
  assert.equal(validateConfig("nope").ok, false);
  assert.equal(validateConfig(null).ok, false);
});
