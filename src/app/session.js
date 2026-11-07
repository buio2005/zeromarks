// @ts-check

import { getErrorMessage } from "../shared/infra/errors.js";
import { clearLastOpenedFile } from "../shared/infra/persistence.js";
import { appState } from "../shared/state/app-state.js";
import { treeState } from "../features/tree/state/tree-state.js";
import { uiState } from "../shared/state/ui-state.js";

/**
 * @typedef {object} AppSessionShell
 * @property {HTMLInputElement} searchInput
 */

/**
 * @param {string} path
 * @param {boolean} [silentFailure=false]
 * @returns {Promise<boolean>}
 */
export async function loadFileIntoSession(path, silentFailure = false) {
  appState.actions.setCurrentFilePath("");
  const loaded = await treeState.actions.loadFile(path);
  if (loaded) {
    const nextState = appState.actions.reloadPersistedState();
    await treeState.actions.restoreUIState(nextState.files[path]);
    appState.actions.rememberLoadedFile(path);
    return true;
  }

  if (appState.actions.reloadPersistedState().lastOpenedFile === path) {
    clearLastOpenedFile();
    appState.actions.reloadPersistedState();
  }
  appState.actions.setCurrentFilePath("");
  if (!silentFailure && treeState.selectors.getError()) {
    uiState.actions.showToast(treeState.selectors.getError(), "error");
  }
  return false;
}

/**
 * @param {AppSessionShell} shell
 * @returns {Promise<void>}
 */
export async function openFile(shell) {
  const path = await appState.actions.openFilePicker();
  if (!path) {
    return;
  }

  const loaded = await loadFileIntoSession(path);
  appState.actions.setHasTriedLoad(true);
  if (loaded) {
    shell.searchInput.focus();
  }
}

/**
 * Opens a file from the recent list. A file that can no longer be opened
 * (moved, renamed, deleted) is dropped from the list.
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export async function openRecentFile(path) {
  if (!path || path === appState.selectors.getCurrentFilePath()) {
    return true;
  }
  const loaded = await loadFileIntoSession(path, true);
  appState.actions.setHasTriedLoad(true);
  if (!loaded) {
    appState.actions.removeRecentFile(path);
    uiState.actions.showToast("That file could not be opened and was removed from the recent list", "error");
    return false;
  }
  document.getElementById("search-input")?.focus();
  return true;
}

/**
 * @param {AppSessionShell} shell
 * @returns {Promise<void>}
 */
export async function createFile(shell) {
  try {
    const path = await appState.actions.createBookmarkFile();
    if (!path) {
      return;
    }

    const loaded = await loadFileIntoSession(path);
    appState.actions.setHasTriedLoad(true);
    if (!loaded) {
      return;
    }
    uiState.actions.showToast("Bookmark file created", "success");
    shell.searchInput.focus();
  } catch (caughtError) {
    uiState.actions.showToast(
      getErrorMessage(caughtError, "Failed to create bookmark file"),
      "error",
    );
  }
}

/** @returns {Promise<void>} */
export async function bootstrapSession() {
  try {
    const persistedState = appState.actions.reloadPersistedState();
    await appState.actions.restoreWindowSize();

    if (!appState.selectors.hasNativeWindowHost()) {
      appState.actions.setPersistenceReady(true);
      return;
    }

    const filePath = await appState.actions.getStartupFilePath();
    if (typeof filePath === "string" && filePath.length > 0) {
      await loadFileIntoSession(filePath);
    } else if (persistedState.lastOpenedFile) {
      await loadFileIntoSession(persistedState.lastOpenedFile, true);
    }

    appState.actions.setHasTriedLoad(true);
    await appState.actions.syncWindowState();
  } catch (caughtError) {
    uiState.actions.showToast(
      getErrorMessage(caughtError, "Failed to initialize application session"),
      "error",
    );
  } finally {
    appState.actions.setPersistenceReady(true);
  }
}
