import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSafeRegex, matchRegexInText } from "./regex.js";

test("buildSafeRegex compiles a valid pattern", () => {
  const result = buildSafeRegex("timeout|connection refused", false);
  assert.equal(result.ok, true);
});

test("buildSafeRegex rejects an empty pattern", () => {
  const result = buildSafeRegex("", false);
  assert.equal(result.ok, false);
});

test("buildSafeRegex rejects invalid regex syntax", () => {
  const result = buildSafeRegex("(unclosed", false);
  assert.equal(result.ok, false);
});

test("buildSafeRegex rejects patterns with catastrophic nested quantifiers", () => {
  assert.equal(buildSafeRegex("(a+)+", false).ok, false);
  assert.equal(buildSafeRegex("(a*)*b", false).ok, false);
});

test("buildSafeRegex rejects overly long patterns", () => {
  const result = buildSafeRegex("a".repeat(600), false);
  assert.equal(result.ok, false);
});

test("buildSafeRegex is case-insensitive by default and case-sensitive when requested", () => {
  const insensitive = buildSafeRegex("ERROR", false);
  const sensitive = buildSafeRegex("ERROR", true);
  assert.equal(insensitive.ok && insensitive.regex.flags.includes("i"), true);
  assert.equal(sensitive.ok && !sensitive.regex.flags.includes("i"), true);
});

test("matchRegexInText counts matches and reports the first match position", () => {
  const result = buildSafeRegex("PROJ-\\d+", false);
  assert.equal(result.ok, true);
  if (result.ok) {
    const occurrence = matchRegexInText("see PROJ-12 and PROJ-345 for details", result.regex);
    assert.equal(occurrence.count, 2);
    assert.equal(occurrence.firstIndex, 4);
    assert.equal(occurrence.firstLength, 7);
  }
});

test("matchRegexInText does not hang on a zero-length match pattern", () => {
  const result = buildSafeRegex("a*", false);
  assert.equal(result.ok, true);
  if (result.ok) {
    const occurrence = matchRegexInText("bbb", result.regex);
    assert.ok(occurrence.count > 0);
  }
});
