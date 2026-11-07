// @ts-check

import { FindDuplicates } from "../../shared/api/api.js";
import { getErrorMessage } from "../../shared/infra/errors.js";
import { computed, signal } from "../../shared/runtime/naf.js";
import { appState } from "../../shared/state/app-state.js";
import { uiState } from "../../shared/state/ui-state.js";

const open = signal(false);
const loading = signal(false);
const errorMessage = signal("");
const groups = signal(/** @type {DuplicateGroup[]} */ ([]));
/** Ids of the copies the user chose to remove. */
const removeIds = signal(/** @type {string[]} */ ([]));

const removeIdSet = computed(() => new Set(removeIds()));

/**
 * Default choice: keep the first copy (top of the library), remove the others.
 *
 * @param {DuplicateGroup[]} nextGroups
 * @returns {string[]}
 */
export function defaultRemoveIds(nextGroups) {
  return nextGroups.flatMap((group) => group.items.slice(1).map((item) => item.id));
}

/**
 * Toggles one copy, refusing to mark the last kept copy of a group for removal.
 *
 * @param {DuplicateGroup[]} currentGroups
 * @param {string[]} currentRemoveIds
 * @param {string} id
 * @returns {string[]}
 */
export function toggleRemoveId(currentGroups, currentRemoveIds, id) {
  const selected = new Set(currentRemoveIds);
  if (selected.has(id)) {
    selected.delete(id);
    return [...selected];
  }
  const group = currentGroups.find((candidate) => candidate.items.some((item) => item.id === id));
  if (!group) {
    return currentRemoveIds;
  }
  const keptAfter = group.items.filter((item) => item.id !== id && !selected.has(item.id)).length;
  if (keptAfter === 0) {
    return currentRemoveIds;
  }
  selected.add(id);
  return [...selected];
}

export const duplicatesState = {
  signals: {
    open,
    loading,
    errorMessage,
    groups,
    removeIds,
  },
  actions: {
    /** @returns {Promise<void>} */
    async openDuplicates() {
      if (!appState.selectors.getCurrentFilePath()) {
        uiState.actions.showToast("Open a bookmark file first", "info");
        return;
      }
      groups([]);
      removeIds([]);
      errorMessage("");
      loading(true);
      open(true);
      await duplicatesState.actions.reload();
    },
    /** @returns {Promise<void>} */
    async reload() {
      loading(true);
      errorMessage("");
      try {
        const nextGroups = await FindDuplicates();
        groups(nextGroups);
        removeIds(defaultRemoveIds(nextGroups));
      } catch (caughtError) {
        errorMessage(getErrorMessage(caughtError, "Failed to look for duplicates"));
      } finally {
        loading(false);
      }
    },
    /**
     * @param {string} id
     * @returns {void}
     */
    toggleRemove(id) {
      removeIds(toggleRemoveId(groups(), removeIds(), id));
    },
    /** @returns {void} */
    keepAll() {
      removeIds([]);
    },
    /** @returns {void} */
    resetSelection() {
      removeIds(defaultRemoveIds(groups()));
    },
    /** @returns {void} */
    close() {
      open(false);
      loading(false);
      groups([]);
      removeIds([]);
      errorMessage("");
    },
  },
  selectors: {
    /** @returns {boolean} */
    isOpen() {
      return open();
    },
    /** @returns {boolean} */
    isLoading() {
      return loading();
    },
    /** @returns {string} */
    getError() {
      return errorMessage();
    },
    /** @returns {DuplicateGroup[]} */
    getGroups() {
      return groups();
    },
    /** @returns {string[]} */
    getRemoveIds() {
      return removeIds();
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
