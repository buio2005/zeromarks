// @ts-check

import { describe, test } from "../lib/test.js";
import { deepEqual, strictEqual } from "../lib/assert.js";
import {
  MAX_RECENT_FILES,
  clearRecentFiles,
  loadPersistedUIState,
  removeRecentFile,
  setLastOpenedFile,
  withRecentFile,
  withoutRecentFile,
} from "../../src/shared/infra/persistence.js";
import { splitPath } from "../../src/features/recent-files/recent-files.js";

const STORAGE_KEY = "justbookmarks.ui-state.v1";

/**
 * Runs `fn` with an in-memory localStorage. Hooks are global in this test runner,
 * so the stub is installed per test instead of with beforeEach.
 *
 * @param {(storage: Storage) => void} fn
 */
function withStorage(fn) {
  /** @type {Map<string, string>} */
  const map = new Map();
  /** @type {Storage} */
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
  };
  const previous = globalThis.window.localStorage;
  globalThis.window.localStorage = storage;
  try {
    fn(storage);
  } finally {
    globalThis.window.localStorage = previous;
  }
}

describe("recent files list", () => {
  test("withRecentFile moves the path to the front without duplicates", () => {
    deepEqual(withRecentFile(["b", "a", "c"], "a"), ["a", "b", "c"]);
    deepEqual(withRecentFile([], "x"), ["x"]);
  });

  test("withRecentFile treats Windows paths case- and slash-insensitively", () => {
    deepEqual(withRecentFile(["C:\\Users\\Me\\b.html"], "c:/users/me/B.html"), ["c:/users/me/B.html"]);
  });

  test("withRecentFile caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => `f${i}`);
    const result = withRecentFile(many, "new");
    strictEqual(result.length, MAX_RECENT_FILES);
    strictEqual(result[0], "new");
  });

  test("withoutRecentFile removes a path", () => {
    deepEqual(withoutRecentFile(["a", "B", "c"], "b"), ["a", "c"]);
  });

  test("splitPath splits Windows and POSIX paths", () => {
    deepEqual(splitPath("C:\\Users\\me\\Desktop\\brave.html"), { name: "brave.html", folder: "C:\\Users\\me\\Desktop" });
    deepEqual(splitPath("/home/me/b.html"), { name: "b.html", folder: "/home/me" });
    deepEqual(splitPath("b.html"), { name: "b.html", folder: "" });
  });
});

describe("recent files persistence", () => {
  test("old saved state starts the list with the last opened file", () => {
    withStorage((storage) => {
      storage.setItem(STORAGE_KEY, JSON.stringify({ lastOpenedFile: "/a.html" }));
      deepEqual(loadPersistedUIState().recentFiles, ["/a.html"]);
    });
  });

  test("malformed list entries are dropped", () => {
    withStorage((storage) => {
      storage.setItem(STORAGE_KEY, JSON.stringify({ recentFiles: ["/a", 3, "", null, "/a", "/b"] }));
      deepEqual(loadPersistedUIState().recentFiles, ["/a", "/b"]);
    });
  });

  test("opening files builds the list newest first; remove and clear work", () => {
    withStorage(() => {
      setLastOpenedFile("/one.html");
      setLastOpenedFile("/two.html");
      deepEqual(setLastOpenedFile("/one.html").recentFiles, ["/one.html", "/two.html"]);
      deepEqual(removeRecentFile("/two.html").recentFiles, ["/one.html"]);
      setLastOpenedFile("/three.html");
      deepEqual(clearRecentFiles().recentFiles, ["/three.html"]);
    });
  });
});
