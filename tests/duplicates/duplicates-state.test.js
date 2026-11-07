// @ts-check

import { describe, test } from "../lib/test.js";
import { deepEqual } from "../lib/assert.js";
import { defaultRemoveIds, toggleRemoveId } from "../../src/features/duplicates/duplicates-state.js";

/**
 * @param {string} url
 * @param {string[]} ids
 * @returns {DuplicateGroup}
 */
function group(url, ids) {
  return {
    url,
    items: ids.map((id) => ({ id, title: id, url, folderPath: "", addDate: "" })),
  };
}

const groups = [group("https://a.example", ["a1", "a2", "a3"]), group("https://b.example", ["b1", "b2"])];

describe("duplicates selection", () => {
  test("defaultRemoveIds: keeps the first copy of each group", () => {
    deepEqual(defaultRemoveIds(groups), ["a2", "a3", "b2"]);
  });

  test("defaultRemoveIds: empty when there are no groups", () => {
    deepEqual(defaultRemoveIds([]), []);
  });

  test("toggleRemoveId: unmarks a copy", () => {
    deepEqual(toggleRemoveId(groups, ["a2", "a3"], "a2"), ["a3"]);
  });

  test("toggleRemoveId: marks a copy while another stays", () => {
    deepEqual(toggleRemoveId(groups, ["a2"], "a1"), ["a2", "a1"]);
  });

  test("toggleRemoveId: refuses to remove the last kept copy", () => {
    deepEqual(toggleRemoveId(groups, ["b2"], "b1"), ["b2"]);
    deepEqual(toggleRemoveId(groups, ["a2", "a3"], "a1"), ["a2", "a3"]);
  });

  test("toggleRemoveId: ignores unknown ids", () => {
    deepEqual(toggleRemoveId(groups, ["a2"], "zz"), ["a2"]);
  });
});
