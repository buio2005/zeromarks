// @ts-check

import { CheckLinks, GetFlatIndex } from "../../shared/api/api.js";
import { getErrorMessage } from "../../shared/infra/errors.js";
import { computed, signal } from "../../shared/runtime/naf.js";
import { appState } from "../../shared/state/app-state.js";
import { uiState } from "../../shared/state/ui-state.js";

/** Links sent to the backend per call; small enough for smooth progress updates. */
const BATCH_SIZE = 24;

/** @typedef {"idle" | "running" | "done"} LinkCheckPhase */

/**
 * @typedef {object} LinkCheckRow
 * @property {string} id
 * @property {string} title
 * @property {string} url
 * @property {string} folderPath
 * @property {LinkCheckStatus} status
 * @property {number} httpStatus
 * @property {string} finalUrl
 * @property {string} message
 */

/**
 * @typedef {object} LinkCheckCounts
 * @property {number} ok
 * @property {number} skipped
 */

const open = signal(false);
const phase = signal(/** @type {LinkCheckPhase} */ ("idle"));
const total = signal(0);
const checked = signal(0);
const rows = signal(/** @type {LinkCheckRow[]} */ ([]));
const counts = signal(/** @type {LinkCheckCounts} */ ({ ok: 0, skipped: 0 }));
const removeIds = signal(/** @type {string[]} */ ([]));
const offline = signal(false);
const errorMessage = signal("");
const stopped = signal(false);

const removeIdSet = computed(() => new Set(removeIds()));

/** Incremented on every start/close so a stale run stops touching state. */
let runToken = 0;

/**
 * No link at all got an HTTP answer: most likely the computer is offline, so
 * "unreachable" results say nothing about the links themselves.
 *
 * @param {LinkCheckRow[]} problemRows
 * @param {LinkCheckCounts} okCounts
 * @returns {boolean}
 */
export function looksOffline(problemRows, okCounts) {
  const webChecks = okCounts.ok + problemRows.length;
  if (okCounts.ok > 0 || webChecks < 5) {
    return false;
  }
  return problemRows.every((row) => row.httpStatus === 0);
}

/**
 * Only clearly dead links are preselected for removal, and none when offline.
 *
 * @param {LinkCheckRow[]} problemRows
 * @param {boolean} isOffline
 * @returns {string[]}
 */
export function defaultRemoveIds(problemRows, isOffline) {
  if (isOffline) {
    return [];
  }
  return problemRows.filter((row) => row.status === "broken").map((row) => row.id);
}

/**
 * @param {BookmarkIndexEntry[]} entries
 * @param {LinkCheckResult[]} results
 * @returns {{ problems: LinkCheckRow[], ok: number, skipped: number }}
 */
export function mergeResults(entries, results) {
  const byId = new Map(entries.map((entry) => [entry.nodeId, entry]));
  /** @type {LinkCheckRow[]} */
  const problems = [];
  let ok = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.status === "ok") {
      ok += 1;
      continue;
    }
    if (result.status === "skipped") {
      skipped += 1;
      continue;
    }
    const entry = byId.get(result.id);
    problems.push({
      id: result.id,
      title: entry?.title ?? "",
      url: result.url,
      folderPath: entry?.folderPath ?? "",
      status: result.status,
      httpStatus: result.httpStatus,
      finalUrl: result.finalUrl,
      message: result.message,
    });
  }
  return { problems, ok, skipped };
}

async function run() {
  const token = ++runToken;
  phase("running");
  stopped(false);
  errorMessage("");
  rows([]);
  counts({ ok: 0, skipped: 0 });
  removeIds([]);
  offline(false);
  checked(0);
  total(0);

  try {
    const entries = (await GetFlatIndex()).filter((entry) => entry.url);
    if (token !== runToken) {
      return;
    }
    total(entries.length);

    for (let start = 0; start < entries.length; start += BATCH_SIZE) {
      if (stopped()) {
        break;
      }
      const batch = entries.slice(start, start + BATCH_SIZE);
      const results = await CheckLinks(batch.map((entry) => ({ id: entry.nodeId, url: entry.url })));
      if (token !== runToken) {
        return;
      }
      const merged = mergeResults(batch, results);
      rows([...rows(), ...merged.problems]);
      counts({ ok: counts().ok + merged.ok, skipped: counts().skipped + merged.skipped });
      checked(checked() + batch.length);
    }
  } catch (caughtError) {
    if (token !== runToken) {
      return;
    }
    errorMessage(getErrorMessage(caughtError, "Link check failed"));
  }

  if (token !== runToken) {
    return;
  }
  const isOffline = looksOffline(rows(), counts());
  offline(isOffline);
  removeIds(defaultRemoveIds(rows(), isOffline));
  phase("done");
}

export const linkCheckState = {
  signals: { open, phase, total, checked, rows, counts, removeIds, offline, errorMessage, stopped },
  actions: {
    /** @returns {void} */
    openLinkCheck() {
      if (!appState.selectors.getCurrentFilePath()) {
        uiState.actions.showToast("Open a bookmark file first", "info");
        return;
      }
      runToken += 1;
      phase("idle");
      rows([]);
      removeIds([]);
      errorMessage("");
      checked(0);
      total(0);
      open(true);
    },
    /** @returns {Promise<void>} */
    start() {
      return run();
    },
    /** Stops after the batch in flight; results so far are kept. */
    stop() {
      stopped(true);
    },
    /**
     * @param {string} id
     * @returns {void}
     */
    toggleRemove(id) {
      const next = new Set(removeIds());
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      removeIds([...next]);
    },
    /**
     * @param {LinkCheckStatus} status
     * @returns {void}
     */
    selectAllWithStatus(status) {
      const next = new Set(removeIds());
      for (const row of rows()) {
        if (row.status === status) {
          next.add(row.id);
        }
      }
      removeIds([...next]);
    },
    /** @returns {void} */
    clearSelection() {
      removeIds([]);
    },
    /** @returns {void} */
    close() {
      runToken += 1;
      stopped(true);
      open(false);
      phase("idle");
      rows([]);
      removeIds([]);
    },
  },
  selectors: {
    /** @returns {boolean} */
    isOpen() {
      return open();
    },
    /**
     * @param {string} id
     * @returns {boolean}
     */
    isMarkedForRemoval(id) {
      return removeIdSet().has(id);
    },
  },
};
