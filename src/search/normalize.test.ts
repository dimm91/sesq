import assert from "node:assert/strict";
import { test } from "node:test";
import { countNonOverlapping, normalizeForSearch, splitIntoWords } from "./normalize.js";

test("normalizeForSearch lowercases and strips accents", () => {
  assert.equal(normalizeForSearch("Autenticación"), "autenticacion");
  assert.equal(normalizeForSearch("CAFÉ"), "cafe");
  assert.equal(normalizeForSearch("plain text"), "plain text");
});

test("splitIntoWords normalizes, trims, dedupes and splits on whitespace", () => {
  assert.deepEqual(splitIntoWords("Error   de Autenticación"), ["error", "de", "autenticacion"]);
  assert.deepEqual(splitIntoWords("  "), []);
  assert.deepEqual(splitIntoWords("repetido repetido"), ["repetido"]);
});

test("countNonOverlapping counts non-overlapping occurrences and finds the first index", () => {
  assert.deepEqual(countNonOverlapping("aaaa", "aa"), { count: 2, firstIndex: 0 });
  assert.deepEqual(countNonOverlapping("hello world", "world"), { count: 1, firstIndex: 6 });
  assert.deepEqual(countNonOverlapping("hello world", "missing"), { count: 0, firstIndex: null });
});

test("countNonOverlapping treats an empty needle as no match", () => {
  assert.deepEqual(countNonOverlapping("anything", ""), { count: 0, firstIndex: null });
});
