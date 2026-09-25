import assert from "node:assert/strict";
import { test } from "node:test";
import { runInteractiveLoop } from "./interactive.js";

function fakeRenderPage(maxIndex: number, renderedPages: number[]) {
  return (pageIndex: number) => {
    const clamped = Math.min(Math.max(0, pageIndex), maxIndex);
    renderedPages.push(clamped);
    return clamped;
  };
}

function fakeReadLine(lines: Array<string | null>) {
  let i = 0;
  return async () => (i < lines.length ? lines[i++] : null);
}

test("Enter advances to the next page and a number selects a result", async () => {
  const renderedPages: number[] = [];
  const outcome = await runInteractiveLoop({
    totalCount: 18,
    initialPageIndex: 0,
    renderPage: fakeRenderPage(3, renderedPages),
    showMessage: () => {},
    readLine: fakeReadLine(["", "7"]),
  });

  assert.deepEqual(renderedPages, [0, 1]);
  assert.deepEqual(outcome, { type: "select", ordinal: 7 });
});

test("p moves to the previous page and clamps at the first page", async () => {
  const renderedPages: number[] = [];
  const outcome = await runInteractiveLoop({
    totalCount: 18,
    initialPageIndex: 1,
    renderPage: fakeRenderPage(3, renderedPages),
    showMessage: () => {},
    readLine: fakeReadLine(["p", "p", "q"]),
  });

  assert.deepEqual(renderedPages, [1, 0, 0]);
  assert.deepEqual(outcome, { type: "quit" });
});

test("q quits immediately", async () => {
  const outcome = await runInteractiveLoop({
    totalCount: 18,
    initialPageIndex: 0,
    renderPage: fakeRenderPage(3, []),
    showMessage: () => {},
    readLine: fakeReadLine(["q"]),
  });
  assert.deepEqual(outcome, { type: "quit" });
});

test("end of input (EOF) is treated as quit", async () => {
  const outcome = await runInteractiveLoop({
    totalCount: 18,
    initialPageIndex: 0,
    renderPage: fakeRenderPage(3, []),
    showMessage: () => {},
    readLine: fakeReadLine([]),
  });
  assert.deepEqual(outcome, { type: "quit" });
});

test("out-of-range or non-numeric input shows a message and keeps looping", async () => {
  const messages: string[] = [];
  const outcome = await runInteractiveLoop({
    totalCount: 5,
    initialPageIndex: 0,
    renderPage: fakeRenderPage(0, []),
    showMessage: (message) => messages.push(message),
    readLine: fakeReadLine(["banana", "99", "0", "3"]),
  });

  assert.equal(messages.length, 3);
  assert.deepEqual(outcome, { type: "select", ordinal: 3 });
});
