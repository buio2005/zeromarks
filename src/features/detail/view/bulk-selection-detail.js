// @ts-check

import { t } from "../../../shared/i18n/i18n.js";
import {
  DeleteNodes,
  FetchFaviconsForNodes,
} from "../../../shared/api/api.js";
import { getErrorMessage } from "../../../shared/infra/errors.js";
import {
  cleanupCollector,
  fx,
  listener,
  requireRef,
  signal,
  template,
} from "../../../shared/runtime/naf.js";
import { moveDialogState } from "../../move/move-dialog-state.js";
import { treeState } from "../../tree/state/tree-state.js";
import { uiState } from "../../../shared/state/ui-state.js";

/**
 * @typedef {"delete" | "move" | "favicons" | ""} RunningAction
 */

/**
 * @param {TreeNode} node
 * @returns {node is FolderNode}
 */
function isFolderNode(node) {
  return node.type === 0;
}

/**
 * @returns {Component<HTMLElement>}
 */
export function createBulkSelectionDetail() {
  const runningAction = signal(/** @type {RunningAction} */ (""));
  const cleanup = cleanupCollector();

  /**
   * @returns {TreeNode[]}
   */
  function getSelectedNodes() {
    return treeState.selectors.getSelectedNodes();
  }

  /**
   * @returns {TreeNode | null}
   */
  function getFirstNode() {
    return getSelectedNodes()[0] ?? null;
  }

  function isFolderSelection() {
    const firstNode = getFirstNode();
    return Boolean(firstNode && isFolderNode(firstNode));
  }

  function getSelectionLabel() {
    return isFolderSelection() ? "Folders" : "Bookmarks";
  }

  function getParentLabel() {
    const firstNode = getFirstNode();
    if (!firstNode) {
      return "Root";
    }
    const parentId = treeState.selectors.getParentId(firstNode.id);
    const parentNode = parentId ? treeState.selectors.getNode(parentId) : null;
    return parentNode && isFolderNode(parentNode) ? parentNode.folder.name : "Root";
  }

  /**
   * @param {string} message
   * @returns {Promise<void>}
   */
  async function refreshAfterAction(message) {
    await treeState.actions.refresh();
    uiState.actions.showToast(message, "success");
  }

  function openMoveDialog() {
    const selectedIds = treeState.selectors.getSelectedNodeIds();
    moveDialogState.actions.showBulkMoveDialog(
      selectedIds,
      isFolderSelection() ? "folder" : "bookmark",
      treeState.selectors.getTree(),
    );
  }

  function confirmDelete() {
    const selectionCount = treeState.computed.selectionCount();
    const selectionLabel = getSelectionLabel();

    uiState.actions.showConfirm(
      `Delete ${selectionLabel}`,
      `Delete ${selectionCount} selected ${selectionLabel.toLowerCase()}?`,
      "Delete",
      async () => {
        runningAction("delete");
        try {
          await DeleteNodes(treeState.selectors.getSelectedNodeIds());
          treeState.actions.clearSelection();
          await refreshAfterAction(`${selectionCount} ${selectionLabel.toLowerCase()} deleted`);
        } catch (caughtError) {
          uiState.actions.showToast(getErrorMessage(caughtError, "Bulk delete failed"), "error");
        } finally {
          runningAction("");
        }
      },
    );
  }

  async function fetchFavicons() {
    runningAction("favicons");
    try {
      const updatedNodes = await FetchFaviconsForNodes(treeState.selectors.getSelectedNodeIds());
      if (treeState.actions.patchFlatNodes(updatedNodes) === 0) {
        await treeState.actions.refresh();
      }
      uiState.actions.showToast("Favicons refreshed", "success");
    } catch (caughtError) {
      uiState.actions.showToast(
        getErrorMessage(caughtError, "Bulk favicon refresh failed"),
        "error",
      );
    } finally {
      runningAction("");
    }
  }

  const renderBulkSelectionDetail = /** @type {TemplateTag} */ (
    template({
      root: ".bulk-selection-detail",
      onMount(_el, _parent, ctx) {
        const title = /** @type {HTMLElement} */ (requireRef(ctx.refs, "title"));
        const subtitle = /** @type {HTMLElement} */ (requireRef(ctx.refs, "subtitle"));
        const clearButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "clearButton"));
        const moveButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "moveButton"));
        const deleteButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "deleteButton"));
        const faviconButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "faviconButton"));

        function clearSelection() {
          treeState.actions.clearSelection();
        }

        const handleMoveClick = () => {
          openMoveDialog();
        };
        const handleDeleteClick = () => {
          confirmDelete();
        };
        const handleFaviconClick = () => {
          void fetchFavicons();
        };

        cleanup.add(
          listener(moveButton, "click", handleMoveClick),
          listener(deleteButton, "click", handleDeleteClick),
          listener(faviconButton, "click", handleFaviconClick),
          listener(clearButton, "click", clearSelection),
          fx(title, (currentTitle) => {
            const selectionCount = treeState.computed.selectionCount();
            currentTitle.textContent = `${selectionCount} ${t(getSelectionLabel())}`;
          }),
          fx(subtitle, (currentSubtitle) => {
            currentSubtitle.textContent = t("Sibling group: {group}", { group: t(getParentLabel()) });
          }),
          fx(clearButton, (currentClearButton) => {
            currentClearButton.disabled = runningAction() !== "";
          }),
          fx(moveButton, (currentMoveButton) => {
            currentMoveButton.disabled = runningAction() !== "";
          }),
          fx(deleteButton, (currentDeleteButton) => {
            const activeAction = runningAction();
            currentDeleteButton.disabled = activeAction !== "";
            currentDeleteButton.textContent = t(activeAction === "delete" ? "Deleting..." : "Delete");
          }),
          fx(faviconButton, (currentFaviconButton) => {
            const activeAction = runningAction();
            currentFaviconButton.hidden = isFolderSelection();
            currentFaviconButton.disabled = activeAction !== "";
            currentFaviconButton.textContent =
              t(activeAction === "favicons" ? "Fetching..." : "Fetch Favicons");
          }),
        );
      },
      onUnmount() {
        cleanup.run();
      },
    })
  );

  return renderBulkSelectionDetail/*html*/`
    <div class="bulk-selection-detail">
      <div class="panel bulk-selection-detail__header">
        <div>
          <p class="eyebrow bulk-selection-detail__eyebrow">Bulk Selection</p>
          <h3 class="bulk-selection-detail__title" data-ref="title"></h3>
          <p class="bulk-selection-detail__subtitle" data-ref="subtitle"></p>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          data-keyboard-action="bulk-clear"
          data-ref="clearButton"
        >
          Clear
        </button>
      </div>
      <div class="detail-inline-actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          data-keyboard-action="bulk-move"
          data-ref="moveButton"
        >
          Move
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm btn-outline"
          data-keyboard-action="bulk-delete"
          data-ref="deleteButton"
        >
          Delete
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          data-keyboard-action="bulk-fetch-favicons"
          data-ref="faviconButton"
        >
          Fetch Favicons
        </button>
      </div>
      <div class="panel bulk-selection-detail__footer">
        <p class="bulk-selection-detail__footer-text">
          Bulk actions operate on the current sibling selection and save once when the command
          completes.
        </p>
      </div>
    </div>
  `;
}
