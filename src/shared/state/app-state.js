// @ts-check

import {
  CreateBookmarkFile,
  GetFilePath,
  OpenFilePicker,
} from "../../shared/api/api.js";
import {
  clearRecentFiles,
  loadPersistedUIState,
  removeRecentFile,
  setLastOpenedFile,
  setTheme,
  setWindowState,
} from "../../shared/infra/persistence.js";
import { signal } from "../../shared/runtime/naf.js";
import {
  canResizeWindow,
  getWindowSize,
  hasNativeWindowHost,
  isMaximised as hostIsMaximised,
  isMinimised as hostIsMinimised,
  setWindowSize,
  subscribeWindowState,
} from "../../shared/runtime/window-host.js";
import { saving } from "./save-state.js";

/**
 * App/session state owner.
 *
 * Owns:
 * - current file path
 * - startup lifecycle
 * - window/runtime integration
 * - persisted shell settings coordination
 *
 * Uses the shared signals/actions/computed/selectors pattern used
 * throughout the frontend state modules.
 */

// -- Private signals --

const currentFilePath = signal("", { label: "app.currentFilePath" });
const hasTriedLoad = signal(false, { label: "app.hasTriedLoad" });
const persistenceReady = signal(false, { label: "app.persistenceReady" });
const isMaximised = signal(false, { label: "app.isMaximised" });
const keyboardShortcutsOpen = signal(false, { label: "app.keyboardShortcutsOpen" });
const theme = signal(loadPersistedUIState().theme ?? "light", { label: "app.theme" });
const persistedState = signal(loadPersistedUIState(), { label: "app.persistedState" });

// -- Private helpers --

/** @returns {boolean} */
/** @returns {PersistedUIState} */
function reloadPersistedState() {
  const nextState = loadPersistedUIState();
  persistedState(nextState);
  return nextState;
}

/**
 * @param {string} path
 * @returns {PersistedUIState}
 */
function rememberLoadedFile(path) {
  const nextState = setLastOpenedFile(path);
  persistedState(nextState);
  currentFilePath(path);
  return nextState;
}

/** @returns {Promise<void>} */
async function syncWindowState() {
  if (!hasNativeWindowHost()) {
    isMaximised(false);
    return;
  }

  try {
    isMaximised(await hostIsMaximised());
  } catch {
    isMaximised(false);
  }
}

/**
 * @param {WindowState | null} windowState
 * @returns {PersistedUIState}
 */
function persistWindowState(windowState) {
  const nextState = setWindowState(windowState);
  persistedState(nextState);
  return nextState;
}

/** @returns {() => void} */
function bindWindowStateSync() {
  if (!hasNativeWindowHost()) {
    return () => {};
  }
  return subscribeWindowState(() => appState.actions.syncWindowState());
}

// -- Public export --

export const appState = {
  signals: {
    currentFilePath,
    hasTriedLoad,
    persistenceReady,
    isMaximised,
    keyboardShortcutsOpen,
    saving,
    persistedState,
    theme,
  },
  computed: {},
  actions: {
    /**
     * @param {string} path
     * @returns {string}
     */
    setCurrentFilePath(path) {
      return currentFilePath(path);
    },
    /**
     * @param {boolean} value
     * @returns {boolean}
     */
    setHasTriedLoad(value) {
      return hasTriedLoad(value);
    },
    /**
     * @param {boolean} value
     * @returns {boolean}
     */
    setPersistenceReady(value) {
      return persistenceReady(value);
    },
    /**
     * @returns {Promise<string>}
     */
    async getStartupFilePath() {
      return GetFilePath();
    },
    /**
     * @returns {Promise<string>}
     */
    async openFilePicker() {
      return OpenFilePicker();
    },
    /**
     * @returns {Promise<string>}
     */
    async createBookmarkFile() {
      return CreateBookmarkFile();
    },
    /**
     * @returns {Promise<void>}
     */
    async restoreWindowSize() {
      const state = persistedState();
      if (hasNativeWindowHost() && state.window) {
        await setWindowSize(state.window.width, state.window.height);
      }
    },
    /**
     * @param {string} path
     * @returns {PersistedUIState}
     */
    rememberLoadedFile(path) {
      return rememberLoadedFile(path);
    },
    /** @returns {PersistedUIState} */
    reloadPersistedState() {
      return reloadPersistedState();
    },
    /**
     * @param {string} path
     * @returns {PersistedUIState}
     */
    removeRecentFile(path) {
      const nextState = removeRecentFile(path);
      persistedState(nextState);
      return nextState;
    },
    /** @returns {PersistedUIState} */
    clearRecentFiles() {
      const nextState = clearRecentFiles();
      persistedState(nextState);
      return nextState;
    },
    /**
     * @param {"light" | "dark"} value
     */
    setTheme(value) {
      theme(value);
      setTheme(value);
    },
    /** @returns {Promise<void>} */
    syncWindowState() {
      return syncWindowState();
    },
    /** @returns {Promise<WindowState | null>} */
    async persistCurrentSize() {
      if (!persistenceReady() || !hasNativeWindowHost()) {
        return null;
      }

      try {
        const maximised = await hostIsMaximised();
        const minimised = await hostIsMinimised();
        const normal = !maximised && !minimised;
        if (!normal) {
          return null;
        }

        const size = await getWindowSize();
        if (!size) {
          return null;
        }
        const windowState = { width: size.width, height: size.height };
        persistWindowState(windowState);
        return windowState;
      } catch {
        return null;
      }
    },
    /**
     * @param {WindowState | null} windowState
     * @returns {PersistedUIState}
     */
    persistWindowState(windowState) {
      return persistWindowState(windowState);
    },
    /** @returns {() => void} */
    bindWindowStateSync() {
      return bindWindowStateSync();
    },
    /**
     * @param {boolean} value
     * @returns {boolean}
     */
    setKeyboardShortcutsOpen(value) {
      return keyboardShortcutsOpen(value);
    },
    /** @returns {boolean} */
    openKeyboardShortcuts() {
      return keyboardShortcutsOpen(true);
    },
    /** @returns {boolean} */
    closeKeyboardShortcuts() {
      return keyboardShortcutsOpen(false);
    },
  },
  selectors: {
    /** @returns {string} */
    getCurrentFilePath() {
      return currentFilePath();
    },
    /** @returns {string[]} */
    getRecentFiles() {
      return persistedState().recentFiles ?? [];
    },
    /** @returns {boolean} */
    getHasTriedLoad() {
      return hasTriedLoad();
    },
    /** @returns {boolean} */
    getPersistenceReady() {
      return persistenceReady();
    },
    /** @returns {boolean} */
    isMaximised() {
      return isMaximised();
    },
    /** @returns {boolean} */
    isKeyboardShortcutsOpen() {
      return keyboardShortcutsOpen();
    },
    /** @returns {boolean} */
    isSaving() {
      return saving();
    },
    /** @returns {PersistedUIState} */
    getPersistedState() {
      return persistedState();
    },
    /** @returns {"light" | "dark"} */
    getTheme() {
      return theme();
    },
    /** @returns {boolean} */
    hasNativeWindowHost() {
      return hasNativeWindowHost();
    },
    /** @returns {boolean} */
    canResizeWindow() {
      return canResizeWindow();
    },
  },
};
