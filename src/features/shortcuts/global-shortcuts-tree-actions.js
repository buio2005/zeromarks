// @ts-check

import { t } from "../../shared/i18n/i18n.js";

import {
  DeleteNode,
  DeleteNodes,
  FetchFaviconsForNodes,
} from "../../shared/api/api.js";
import { getErrorMessage } from "../../shared/infra/errors.js";
import { moveDialogState } from "../move/move-dialog-state.js";
import { treeState } from "../tree/state/tree-state.js";
import { uiState } from "../../shared/state/ui-state.js";
import {
  clickKeyboardAction,
  focusDetailForSelection,
} from "./global-shortcuts-focus.js";

/**
 * @typedef {object} GlobalShortcutsTreeOptions
 * @property {() => void} focusSearch
 * @property {() => void} focusTree
 */

/**
 * @param {TreeNode} node
 * @returns {node is FolderNode}
 */
function isFolderNode(node) {
  return node.type === 0;
}

/**
 * @param {string} selector
 * @returns {void}
 */
function focusIfHTMLElement(selector) {
  const element = document.querySelector(selector);
  if (element instanceof HTMLElement) {
    element.focus();
  }
}

/** @returns {string} */
function getPrimarySelectionParentFolderId() {
  const primaryId = treeState.selectors.getSelectedNodeId();
  if (!primaryId) {
    return "";
  }
  return treeState.selectors.getParentId(primaryId);
}

/**
 * @returns {void}
 */
export function triggerOpenShortcut() {
  clickKeyboardAction("bookmark-open");
}

/**
 * @returns {void}
 */
export function triggerMoveShortcut() {
  if (treeState.computed.selectionCount() > 1) {
    const selectedNodes = treeState.selectors.getSelectedNodes();
    if (selectedNodes.length === 0) {
      return;
    }
    moveDialogState.actions.showBulkMoveDialog(
      treeState.selectors.getSelectedNodeIds(),
      isFolderNode(selectedNodes[0]) ? "folder" : "bookmark",
      treeState.selectors.getTree(),
    );
    return;
  }

  const selectedNode = treeState.selectors.getPrimarySelectedNode();
  if (!selectedNode) {
    return;
  }
  moveDialogState.actions.showMoveDialog(
    selectedNode.id,
    isFolderNode(selectedNode)
      ? selectedNode.folder.name
      : selectedNode.bookmark.title || selectedNode.bookmark.url,
    isFolderNode(selectedNode) ? "folder" : "bookmark",
    treeState.selectors.getTree(),
  );
}

/** @returns {void} */
export function triggerDeleteShortcut() {
  const selectedNodes = treeState.selectors.getSelectedNodes();
  if (selectedNodes.length === 0) {
    return;
  }

  if (selectedNodes.length > 1) {
    const label = isFolderNode(selectedNodes[0]) ? "Folders" : "Bookmarks";
    uiState.actions.showConfirm(
      t("Delete {label}", { label: t(label) }),
      t("Delete {count} selected {label}?", { count: selectedNodes.length, label: t(label.toLowerCase()) }),
      "Delete",
      async () => {
        try {
          await DeleteNodes(treeState.selectors.getSelectedNodeIds());
          treeState.actions.clearSelection();
          await treeState.actions.refresh();
          uiState.actions.showToast(t("{count} {label} deleted", { count: selectedNodes.length, label: t(label.toLowerCase()) }), "success");
        } catch (caughtError) {
          uiState.actions.showToast(getErrorMessage(caughtError, "Bulk delete failed"), "error");
        }
      },
    );
    return;
  }

  const selectedNode = selectedNodes[0];
  const title = isFolderNode(selectedNode)
    ? selectedNode.folder.name
    : selectedNode.bookmark.title || selectedNode.bookmark.url;
  const noun = isFolderNode(selectedNode) ? "Folder" : "Bookmark";
  const message = isFolderNode(selectedNode)
    ? t('Delete "{title}" and all of its contents?', { title })
    : t('Delete "{title}"?', { title });
  uiState.actions.showConfirm(
    `Delete ${noun}`,
    message,
    "Delete",
    async () => {
      try {
        await DeleteNode(selectedNode.id);
        treeState.actions.clearSelection();
        await treeState.actions.refresh();
        uiState.actions.showToast(`${noun} deleted`, "success");
      } catch (caughtError) {
        uiState.actions.showToast(
          getErrorMessage(caughtError, `Failed to delete ${noun.toLowerCase()}`),
          "error",
        );
      }
    },
  );
}

/**
 * @returns {Promise<void>}
 */
export async function triggerBulkRefreshShortcut() {
  const selectedNodes = treeState.selectors.getSelectedNodes();
  if (selectedNodes.length === 0 || isFolderNode(selectedNodes[0])) {
    return;
  }

  try {
    /** @type {FlatNode[]} */
    let updatedNodes;
    updatedNodes = await FetchFaviconsForNodes(treeState.selectors.getSelectedNodeIds());
    uiState.actions.showToast("Favicons refreshed", "success");
    if (treeState.actions.patchFlatNodes(updatedNodes) === 0) {
      await treeState.actions.refresh();
    }
  } catch (caughtError) {
    uiState.actions.showToast(
      getErrorMessage(caughtError, "Bulk favicon refresh failed"),
      "error",
    );
  }
}

/**
 * @returns {void}
 */
export function toggleMultiSelectOnPrimary() {
  const changed = treeState.actions.toggleSelected(treeState.selectors.getSelectedNodeId());
  if (!changed) {
    uiState.actions.showToast(
      "Multi-select only supports matching sibling bookmarks or folders",
      "warning",
    );
  }
}

/**
 * @param {GlobalShortcutsTreeOptions} _options
 * @returns {Promise<void>}
 */
export async function openAddBookmarkShortcut(_options) {
  const selectedNode = treeState.selectors.getPrimarySelectedNode();
  if (selectedNode && isFolderNode(selectedNode)) {
    if (!clickKeyboardAction("folder-add-bookmark")) {
      return;
    }
    await Promise.resolve();
    focusIfHTMLElement('[data-keyboard-action="add-bookmark-url"]');
    return;
  }

  const parentId = getPrimarySelectionParentFolderId();
  if (parentId) {
    treeState.actions.selectSingle(parentId);
    await focusDetailForSelection();
    if (clickKeyboardAction("folder-add-bookmark")) {
      await Promise.resolve();
      focusIfHTMLElement('[data-keyboard-action="add-bookmark-url"]');
    }
    return;
  }

  clickKeyboardAction("root-add-bookmark");
  await Promise.resolve();
  focusIfHTMLElement('[data-keyboard-action="add-bookmark-url"]');
}

/**
 * @param {GlobalShortcutsTreeOptions} _options
 * @returns {Promise<void>}
 */
export async function openAddFolderShortcut(_options) {
  const selectedNode = treeState.selectors.getPrimarySelectedNode();
  if (selectedNode && isFolderNode(selectedNode)) {
    if (!clickKeyboardAction("folder-add-folder")) {
      return;
    }
    await Promise.resolve();
    focusIfHTMLElement('[data-keyboard-action="add-folder-name"]');
    return;
  }

  const parentId = getPrimarySelectionParentFolderId();
  if (parentId) {
    treeState.actions.selectSingle(parentId);
    await focusDetailForSelection();
    if (clickKeyboardAction("folder-add-folder")) {
      await Promise.resolve();
      focusIfHTMLElement('[data-keyboard-action="add-folder-name"]');
    }
    return;
  }

  clickKeyboardAction("root-add-folder");
  await Promise.resolve();
  focusIfHTMLElement('[data-keyboard-action="add-folder-name"]');
}

/**
 * @param {boolean} renameOnly
 * @returns {Promise<void>}
 */
export async function triggerEditShortcut(renameOnly = false) {
  const selectedNode = treeState.selectors.getPrimarySelectedNode();
  if (!selectedNode) {
    return;
  }

  if (isFolderNode(selectedNode)) {
    if (clickKeyboardAction("folder-edit")) {
      await Promise.resolve();
      focusIfHTMLElement('[data-keyboard-action="folder-name"]');
    }
    return;
  }

  if (renameOnly || clickKeyboardAction("bookmark-edit")) {
    await Promise.resolve();
    focusIfHTMLElement('[data-keyboard-action="bookmark-title"]');
  }
}
