import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFooter, getPageInfo, getPageItems, pageIndexForOrdinal, resolvePageSize } from "./pagination.js";

test("resolvePageSize enforces a minimum of 5", () => {
  assert.equal(resolvePageSize(undefined), 5);
  assert.equal(resolvePageSize(3), 5);
  assert.equal(resolvePageSize(10), 10);
});

test("getPageInfo computes ordinals and clamps out-of-range page indexes", () => {
  assert.deepEqual(getPageInfo(18, 5, 1), { pageIndex: 1, totalPages: 4, startOrdinal: 6, endOrdinal: 10, totalCount: 18 });
  assert.deepEqual(getPageInfo(18, 5, 99), { pageIndex: 3, totalPages: 4, startOrdinal: 16, endOrdinal: 18, totalCount: 18 });
  assert.deepEqual(getPageInfo(18, 5, -5), { pageIndex: 0, totalPages: 4, startOrdinal: 1, endOrdinal: 5, totalCount: 18 });
});

test("getPageInfo handles zero results", () => {
  assert.deepEqual(getPageInfo(0, 5, 0), { pageIndex: 0, totalPages: 1, startOrdinal: 0, endOrdinal: 0, totalCount: 0 });
});

test("pageIndexForOrdinal maps a global result number to the page that contains it", () => {
  assert.equal(pageIndexForOrdinal(1, 5), 0);
  assert.equal(pageIndexForOrdinal(5, 5), 0);
  assert.equal(pageIndexForOrdinal(6, 5), 1);
  assert.equal(pageIndexForOrdinal(18, 5), 3);
});

test("getPageItems returns the slice for the requested page, clamped", () => {
  const items = Array.from({ length: 18 }, (_, i) => i + 1);
  assert.deepEqual(getPageItems(items, 5, 1), [6, 7, 8, 9, 10]);
  assert.deepEqual(getPageItems(items, 5, 99), [16, 17, 18]);
});

test("formatFooter reports the visible range, page count and controls", () => {
  const footer = formatFooter(getPageInfo(18, 5, 1));
  assert.match(footer, /Results 6-10 of 18/);
  assert.match(footer, /Page 2 of 4/);
  assert.match(footer, /\[1-18\] select/);
});

test("formatFooter reports no results distinctly", () => {
  assert.equal(formatFooter(getPageInfo(0, 5, 0)), "No results.");
});
