// @ts-check

const STORAGE_KEY = "justbookmarks.ui-state.v1";
const MAX_FILE_STATES = 10;
export const MAX_RECENT_FILES = 8;

/** @type {PersistedUIState} */
const defaultState = {
  lastOpenedFile: "",
  leftPaneWidth: 360,
  window: null,
  files: {},
  theme: "dark",
  recentFiles: [],
};

/**
 * Paths are compared ignoring case and slash direction (Windows paths).
 *
 * @param {string} path
 * @returns {string}
 */
function pathKey(path) {
  return path.replace(/\\/g, "/").toLowerCase();
}

/**
 * Returns the list with `path` moved to the front, without duplicates, capped.
 *
 * @param {string[]} list
 * @param {string} path
 * @returns {string[]}
 */
export function withRecentFile(list, path) {
  if (!path) {
    return list.slice(0, MAX_RECENT_FILES);
  }
  const key = pathKey(path);
  return [path, ...list.filter((item) => pathKey(item) !== key)].slice(0, MAX_RECENT_FILES);
}

/**
 * @param {string[]} list
 * @param {string} path
 * @returns {string[]}
 */
export function withoutRecentFile(list, path) {
  const key = pathKey(path);
  return list.filter((item) => pathKey(item) !== key);
}

/**
 * @returns {boolean}
 */
function hasStorage() {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

/**
 * @param {unknown} raw
 * @returns {PersistedUIState}
 */
function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return { ...defaultState };
  }

  /** @type {Partial<PersistedUIState>} */
  const candidate = raw;
  /** @type {Record<string, PerFileTreeState>} */
  const files = {};

  if (candidate.files && typeof candidate.files === "object") {
    for (const [path, state] of Object.entries(candidate.files)) {
      if (!state || typeof state !== "object") {
        continue;
      }

      /** @type {Partial<PerFileTreeState>} */
      const fileState = state;
      files[path] = {
        expandedNodeIds: Array.isArray(fileState.expandedNodeIds)
          ? fileState.expandedNodeIds.filter((id) => typeof id === "string")
          : [],
        selectedNodeId:
          typeof fileState.selectedNodeId === "string"
            ? fileState.selectedNodeId
            : "",
        scrollTop:
          typeof fileState.scrollTop === "number" && Number.isFinite(fileState.scrollTop)
            ? fileState.scrollTop
            : 0,
      };
    }
  }

  const windowState = candidate.window;
  const lastOpenedFile = typeof candidate.lastOpenedFile === "string" ? candidate.lastOpenedFile : "";
  /** @type {string[]} */
  let recentFiles = [];
  if (Array.isArray(candidate.recentFiles)) {
    for (const item of candidate.recentFiles) {
      if (typeof item === "string" && item) {
        recentFiles = withoutRecentFile(recentFiles, item).concat(item);
      }
    }
    recentFiles = recentFiles.slice(0, MAX_RECENT_FILES);
  } else if (lastOpenedFile) {
    // Older saved state had no list yet: start it with the last opened file.
    recentFiles = [lastOpenedFile];
  }
  return {
    lastOpenedFile:
      typeof candidate.lastOpenedFile === "string"
        ? candidate.lastOpenedFile
        : "",
    leftPaneWidth:
      typeof candidate.leftPaneWidth === "number"
        ? candidate.leftPaneWidth
        : defaultState.leftPaneWidth,
    window:
      windowState &&
      typeof windowState === "object" &&
      typeof windowState.width === "number" &&
      typeof windowState.height === "number"
        ? {
            width: windowState.width,
            height: windowState.height,
          }
        : null,
    files,
    theme:
      typeof candidate.theme === "string" &&
      (candidate.theme === "light" || candidate.theme === "dark")
        ? candidate.theme
        : defaultState.theme,
    recentFiles,
  };
}

/**
 * @returns {PersistedUIState}
 */
export function loadPersistedUIState() {
  if (!hasStorage()) {
    return { ...defaultState };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...defaultState };
    }
    return sanitizeState(JSON.parse(raw));
  } catch {
    return { ...defaultState };
  }
}

/**
 * @param {PersistedUIState} state
 * @returns {void}
 */
export function savePersistedUIState(state) {
  if (!hasStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort persistence only.
  }
}

/**
 * @param {string} path
 * @returns {PersistedUIState}
 */
export function setLastOpenedFile(path) {
  const state = loadPersistedUIState();
  const nextState = {
    ...state,
    lastOpenedFile: path,
    recentFiles: withRecentFile(state.recentFiles, path),
  };
  savePersistedUIState(nextState);
  return nextState;
}

/**
 * @param {string} path
 * @returns {PersistedUIState}
 */
export function removeRecentFile(path) {
  const state = loadPersistedUIState();
  const nextState = { ...state, recentFiles: withoutRecentFile(state.recentFiles, path) };
  savePersistedUIState(nextState);
  return nextState;
}

/**
 * Empties the list but keeps the file that is open now (if any).
 *
 * @returns {PersistedUIState}
 */
export function clearRecentFiles() {
  const state = loadPersistedUIState();
  const nextState = { ...state, recentFiles: state.lastOpenedFile ? [state.lastOpenedFile] : [] };
  savePersistedUIState(nextState);
  return nextState;
}

/**
 * @returns {PersistedUIState}
 */
export function clearLastOpenedFile() {
  return setLastOpenedFile("");
}

/**
 * @param {number} width
 * @returns {PersistedUIState}
 */
export function setLeftPaneWidth(width) {
  const state = loadPersistedUIState();
  const nextState = { ...state, leftPaneWidth: width };
  savePersistedUIState(nextState);
  return nextState;
}

/**
 * @param {WindowState | null} windowState
 * @returns {PersistedUIState}
 */
export function setWindowState(windowState) {
  const state = loadPersistedUIState();
  const nextState = { ...state, window: windowState };
  savePersistedUIState(nextState);
  return nextState;
}

/**
 * @param {string} path
 * @param {PerFileTreeState} treeState
 * @returns {PersistedUIState}
 */
export function setPerFileTreeState(path, treeState) {
  const state = loadPersistedUIState();
  const files = { ...state.files, [path]: treeState };
  const orderedPaths = Object.keys(files);

  if (orderedPaths.length > MAX_FILE_STATES) {
    for (const stalePath of orderedPaths.slice(
      0,
      orderedPaths.length - MAX_FILE_STATES,
    )) {
      delete files[stalePath];
    }
  }

  const nextState = { ...state, files };
  savePersistedUIState(nextState);
  return nextState;
}

/**
 * @param {"light" | "dark"} theme
 * @returns {PersistedUIState}
 */
export function setTheme(theme) {
  const state = loadPersistedUIState();
  const nextState = { ...state, theme };
  savePersistedUIState(nextState);
  return nextState;
}
