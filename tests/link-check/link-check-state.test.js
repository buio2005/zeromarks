// @ts-check

import { describe, test } from "../lib/test.js";
import { deepEqual, strictEqual } from "../lib/assert.js";
import { defaultRemoveIds, looksOffline, mergeResults } from "../../src/features/link-check/link-check-state.js";

/**
 * @param {string} id
 * @param {LinkCheckStatus} status
 * @param {number} httpStatus
 * @returns {import("../../src/features/link-check/link-check-state.js").LinkCheckRow}
 */
function row(id, status, httpStatus) {
  return { id, title: id, url: `https://${id}.example`, folderPath: "", status, httpStatus, finalUrl: "", message: "" };
}

describe("link check", () => {
  test("mergeResults: counts ok/skipped and keeps problems with titles and folders", () => {
    /** @type {BookmarkIndexEntry[]} */
    const entries = [
      { nodeId: "a", title: "A", url: "https://a.example", folderPath: "Work" },
      { nodeId: "b", title: "B", url: "https://b.example", folderPath: "" },
      { nodeId: "c", title: "C", url: "javascript:x", folderPath: "" },
    ];
    /** @type {LinkCheckResult[]} */
    const results = [
      { id: "a", url: "https://a.example", status: "broken", httpStatus: 404, finalUrl: "", message: "Page not found (404)" },
      { id: "b", url: "https://b.example", status: "ok", httpStatus: 200, finalUrl: "", message: "" },
      { id: "c", url: "javascript:x", status: "skipped", httpStatus: 0, finalUrl: "", message: "" },
    ];
    const merged = mergeResults(entries, results);
    strictEqual(merged.ok, 1);
    strictEqual(merged.skipped, 1);
    strictEqual(merged.problems.length, 1);
    strictEqual(merged.problems[0].title, "A");
    strictEqual(merged.problems[0].folderPath, "Work");
  });

  test("defaultRemoveIds: preselects only broken links", () => {
    const rows = [row("a", "broken", 404), row("b", "uncertain", 403), row("c", "redirected", 200), row("d", "broken", 0)];
    deepEqual(defaultRemoveIds(rows, false), ["a", "d"]);
  });

  test("defaultRemoveIds: preselects nothing when offline", () => {
    deepEqual(defaultRemoveIds([row("a", "broken", 0)], true), []);
  });

  test("looksOffline: true when no site answered at all", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id) => row(id, "broken", 0));
    strictEqual(looksOffline(rows, { ok: 0, skipped: 0 }), true);
  });

  test("looksOffline: false when at least one site answered", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id) => row(id, "broken", 0));
    strictEqual(looksOffline(rows, { ok: 1, skipped: 0 }), false);
    strictEqual(looksOffline([...rows, row("f", "broken", 404)], { ok: 0, skipped: 0 }), false);
  });

  test("looksOffline: false for very small checks", () => {
    strictEqual(looksOffline([row("a", "broken", 0)], { ok: 0, skipped: 0 }), false);
  });
});
