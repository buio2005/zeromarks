// @ts-check

import { cleanupCollector, effect, listener } from "../shared/runtime/naf.js";
import { setPerFileTreeState } from "../shared/infra/persistence.js";
import { appState } from "../shared/state/app-state.js";
import { searchState } from "../features/search/state/search-state.js";
import { treeState } from "../features/tree/state/tree-state.js";
import { disposeSearchWorker } from "../features/search/workers/search-worker-client.js";
import { disposeTreeWorker } from "../features/tree/workers/tree-worker-client.js";

const WINDOW_SIZE_PERSIST_DELAY_MS = 150;
const TREE_STATE_PERSIST_DELAY_MS = 200;

/**
 * Allow the native context menu only when running from a local dev host.
 *
 * @returns {boolean}
 */
function shouldAllowNativeContextMenu() {
  const { protocol, hostname } = window.location;
  return (
    (protocol === "http:" || protocol === "https:") &&
    (hostname === "localhost" || hostname === "127.0.0.1")
  );
}

/**
 * @param {{ cleanup: () => void }[]} cleanups
 * @returns {() => void}
 */
function combineCleanups(cleanups) {
  return () => {
    for (const item of cleanups) {
      item.cleanup();
    }
  };
}

/**
 * @param {object} options
 * @param {Array<{ cleanup: () => void }>} options.featureCleanups
 * @returns {{ cleanup: () => void }}
 */
export function mountAppLifecycle(options) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let saveWindowSizeTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let persistTreeStateTimer = null;
  /** @type {{ path: string, state: PerFileTreeState } | null} */
  let pendingTreePersistence = null;

  function flushPendingTreePersistence() {
    if (!pendingTreePersistence) {
      return;
    }

    setPerFileTreeState(pendingTreePersistence.path, pendingTreePersistence.state);
    pendingTreePersistence = null;
  }

  function schedulePersistWindowSize() {
    if (saveWindowSizeTimer) {
      clearTimeout(saveWindowSizeTimer);
    }

    saveWindowSizeTimer = setTimeout(() => {
      void appState.actions.persistCurrentSize();
    }, WINDOW_SIZE_PERSIST_DELAY_MS);
  }

  /**
   * @param {string} path
   * @param {PerFileTreeState} state
   * @returns {void}
   */
  function schedulePersistTreeState(path, state) {
    pendingTreePersistence = { path, state };

    if (persistTreeStateTimer) {
      clearTimeout(persistTreeStateTimer);
    }

    persistTreeStateTimer = setTimeout(() => {
      flushPendingTreePersistence();
      persistTreeStateTimer = null;
    }, TREE_STATE_PERSIST_DELAY_MS);
  }

  const handleWindowResize = () => {
    schedulePersistWindowSize();
  };
  const stopTreePersistence = effect(() => {
    const currentFilePath = appState.selectors.getCurrentFilePath();
    if (!currentFilePath) {
      if (persistTreeStateTimer) {
        clearTimeout(persistTreeStateTimer);
        persistTreeStateTimer = null;
      }
      flushPendingTreePersistence();
      return;
    }

    const nextTreeState = treeState.selectors.getPersistentState();
    if (pendingTreePersistence && pendingTreePersistence.path !== currentFilePath) {
      if (persistTreeStateTimer) {
        clearTimeout(persistTreeStateTimer);
        persistTreeStateTimer = null;
      }
      flushPendingTreePersistence();
    }
    schedulePersistTreeState(currentFilePath, nextTreeState);
  });
  const stopThemeSync = effect(() => {
    const theme = appState.selectors.getTheme();
    // Also on <html>: body takes its text color from there, and anything that
    // inherits it (dialog paragraphs, ...) would otherwise keep the dark theme's
    // near-white text while the light theme is active.
    document.documentElement.setAttribute("data-theme", theme);
    const appShell = document.querySelector(".app-shell");
    if (appShell) {
      appShell.setAttribute("data-theme", theme);
    }
  });
  const stopWindowStateBinding = appState.actions.bindWindowStateSync();
  const cleanupFeatures = combineCleanups(options.featureCleanups);

  const cleanup = cleanupCollector(
    listener(window, "resize", handleWindowResize),
    listener(window, "contextmenu", (event) => {
      if (!shouldAllowNativeContextMenu()) {
        event.preventDefault();
      }
    }),
    listener(window, "beforeunload", () => {
      if (saveWindowSizeTimer) {
        clearTimeout(saveWindowSizeTimer);
      }
      if (persistTreeStateTimer) {
        clearTimeout(persistTreeStateTimer);
        persistTreeStateTimer = null;
      }
      flushPendingTreePersistence();
      void appState.actions.persistCurrentSize();
      searchState.dispose();
      disposeSearchWorker();
      disposeTreeWorker();
      cleanup.run();
    }),
    stopTreePersistence,
    stopThemeSync,
    stopWindowStateBinding,
    cleanupFeatures,
  );

  return {
    cleanup: () => {
      if (saveWindowSizeTimer) {
        clearTimeout(saveWindowSizeTimer);
      }
      if (persistTreeStateTimer) {
        clearTimeout(persistTreeStateTimer);
        persistTreeStateTimer = null;
      }
      flushPendingTreePersistence();
      void appState.actions.persistCurrentSize();
      searchState.dispose();
      disposeSearchWorker();
      disposeTreeWorker();
      cleanup.run();
    },
  };
}
