// @ts-check

import { listener } from "../../shared/runtime/naf.js";
import { moveDialogState } from "../move/move-dialog-state.js";
import { searchState } from "../search/state/search-state.js";
import { treeState } from "../tree/state/tree-state.js";
import { uiState } from "../../shared/state/ui-state.js";
import { appState } from "../../shared/state/app-state.js";
import { importMergeState } from "../import-merge/import-merge-state.js";
import { duplicatesState } from "../duplicates/duplicates-state.js";
import { linkCheckState } from "../link-check/link-check-state.js";
import { recentFilesMenu } from "../recent-files/recent-files.js";
import {
  focusDetail,
  focusDetailForSelection,
  getCurrentFocusZone,
  isEditableTarget,
} from "./global-shortcuts-focus.js";
import { runHistoryAction } from "./global-shortcuts-history.js";
import {
  activateSearchResult,
  createSearchInputKeydownHandler,
} from "./global-shortcuts-search.js";
import {
  openAddBookmarkShortcut,
  openAddFolderShortcut,
  toggleMultiSelectOnPrimary,
  triggerBulkRefreshShortcut,
  triggerDeleteShortcut,
  triggerEditShortcut,
  triggerMoveShortcut,
  triggerOpenShortcut,
} from "./global-shortcuts-tree-actions.js";

/**
 * @typedef {object} GlobalShortcutsOptions
 * @property {HTMLInputElement} searchInput
 * @property {() => void} focusSearch
 * @property {() => void} focusTree
 * @property {() => Promise<void>} openFile
 * @property {() => Promise<void>} createFile
 */

/**
 * @param {GlobalShortcutsOptions} options
 * @returns {{ cleanup: () => void }}
 */
export function mountGlobalShortcuts(options) {
  const handleSearchInputKeydown = createSearchInputKeydownHandler(
    options.searchInput,
    options.focusTree,
  );

  /** @param {KeyboardEvent} event */
  function handleGlobalKeydown(event) {
    const modifierPressed = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const editableTarget = isEditableTarget(event.target);

    if (event.target === options.searchInput) {
      handleSearchInputKeydown(event);
      return;
    }

    if (!editableTarget && !modifierPressed && !event.altKey) {
      if (key === "f1" || (key === "?" && event.shiftKey)) {
        event.preventDefault();
        appState.actions.openKeyboardShortcuts();
        return;
      }

      if (key === "/") {
        event.preventDefault();
        options.focusSearch();
        return;
      }

      if (key === "f6") {
        event.preventDefault();
        const zoneOrder = ["search", "tree", "detail"];
        const currentZone = getCurrentFocusZone();
        const currentIndex = zoneOrder.indexOf(currentZone === "dialog" ? "detail" : currentZone);
        const nextZone = zoneOrder[(currentIndex + 1 + zoneOrder.length) % zoneOrder.length];
        if (nextZone === "search") {
          options.focusSearch();
        } else if (nextZone === "tree") {
          options.focusTree();
        } else {
          focusDetail();
        }
        return;
      }

      if (key === "escape") {
        if (appState.selectors.isKeyboardShortcutsOpen()) {
          event.preventDefault();
          appState.actions.closeKeyboardShortcuts();
          return;
        }
        if (uiState.selectors.getModal().open) {
          return;
        }
        if (moveDialogState.selectors.isOpen()) {
          event.preventDefault();
          moveDialogState.actions.closeMoveDialog();
          return;
        }
        if (treeState.computed.selectionCount() > 1) {
          event.preventDefault();
          treeState.actions.collapseSelectionToPrimary();
        }
      }
    }

    if (editableTarget) {
      return;
    }

    if (!modifierPressed && !event.altKey && appState.selectors.getCurrentFilePath()) {
      if (key === "a" && !event.shiftKey) {
        event.preventDefault();
        void openAddBookmarkShortcut(options);
        return;
      }
      if (key === "a" && event.shiftKey) {
        event.preventDefault();
        void openAddFolderShortcut(options);
        return;
      }
      if (key === "e") {
        event.preventDefault();
        void triggerEditShortcut(false);
        return;
      }
      if (key === "f2") {
        event.preventDefault();
        void triggerEditShortcut(true);
        return;
      }
      if (key === "o") {
        event.preventDefault();
        triggerOpenShortcut();
        return;
      }
      if (key === "m") {
        event.preventDefault();
        triggerMoveShortcut();
        return;
      }
      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        triggerDeleteShortcut();
        return;
      }
      if (key === "enter" && getCurrentFocusZone() === "tree") {
        event.preventDefault();
        if (searchState.selectors.getQuery()) {
          void activateSearchResult("detail");
        } else {
          void focusDetailForSelection();
        }
        return;
      }
    }

    if (!modifierPressed || event.altKey) {
      return;
    }

    const isUndo = key === "z" && !event.shiftKey;
    const isRedo = key === "y" || (key === "z" && event.shiftKey);
    if (isUndo || isRedo) {
      event.preventDefault();
      void runHistoryAction(isUndo ? "undo" : "redo");
      return;
    }

    if (key === "o" && event.shiftKey) {
      event.preventDefault();
      recentFilesMenu.toggle();
      return;
    }
    if (key === "o") {
      event.preventDefault();
      void options.openFile();
      return;
    }
    if (key === "n") {
      event.preventDefault();
      void options.createFile();
      return;
    }
    if (key === "f" && !event.shiftKey) {
      event.preventDefault();
      options.focusSearch();
      return;
    }
    if (key === "l" && event.shiftKey) {
      event.preventDefault();
      linkCheckState.actions.openLinkCheck();
      return;
    }
    if (key === "d" && event.shiftKey) {
      event.preventDefault();
      void duplicatesState.actions.openDuplicates();
      return;
    }
    if (key === "i" && event.shiftKey) {
      event.preventDefault();
      void importMergeState.actions.openImportMerge();
      return;
    }
    if (key === "f" && event.shiftKey) {
      event.preventDefault();
      void triggerBulkRefreshShortcut();
      return;
    }
    if (key === "a" && event.shiftKey) {
      event.preventDefault();
      treeState.actions.collapseSelectionToPrimary();
      return;
    }
    if (key === "a" && !event.shiftKey) {
      event.preventDefault();
      treeState.actions.selectAllSiblings();
      return;
    }
    if (key === " " && getCurrentFocusZone() === "tree") {
      event.preventDefault();
      toggleMultiSelectOnPrimary();
      return;
    }
    if (key === "enter" && getCurrentFocusZone() === "tree" && searchState.selectors.getQuery()) {
      event.preventDefault();
      void activateSearchResult("open");
    }
  }

  const cleanup = listener(window, "keydown", handleGlobalKeydown);

  return {
    cleanup() {
      cleanup();
    },
  };
}
