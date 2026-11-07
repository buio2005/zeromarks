// @ts-check

import { t } from "../../../shared/i18n/i18n.js";
import { createBookmarkDetail } from "./bookmark-detail.js";
import { createBulkSelectionDetail } from "./bulk-selection-detail.js";
import { createFolderDetail } from "./folder-detail.js";
import { effect, requireElement, template, untrack } from "../../../shared/runtime/naf.js";
import { treeState } from "../../tree/state/tree-state.js";

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
function createDetailEmptyState() {
  const renderEmptyState = /** @type {TemplateTag} */ (
    template
  );

  return renderEmptyState/*html*/`
    <div class="detail-empty-state">
      <p class="detail-empty-state__title">Select a bookmark or folder</p>
      <p class="detail-empty-state__subtitle">from the tree on the left</p>
    </div>
  `;
}

/**
 * @param {ParentNode} root
 * @returns {{ cleanup: () => void }}
 */
export function mountDetailPanel(root) {
  const content = requireElement(root, "#detail-pane-content", "detail-pane-content");
  const meta = requireElement(root, "#detail-pane-meta", "detail-pane-meta");
  /** @type {Component | undefined} */
  let currentComponent;

  const stop = effect(() => {
    const selectionCount = treeState.computed.selectionCount();
    const selectedNodeId = treeState.selectors.getSelectedNodeId();
    const selectedNode = selectedNodeId ? treeState.selectors.getNode(selectedNodeId) : null;

    currentComponent?.unmount?.();

    // Mounting a detail child inside the parent effect must stay untracked.
    // The child mount reads local signals like editing/form state; if those reads
    // are captured here, typing into any detail input re-triggers this parent
    // render effect and immediately unmounts the active editor.
    const nextComponent = untrack(() => {
      if (selectionCount > 1) {
        return createBulkSelectionDetail();
      }
      if (selectedNode) {
        return isFolderNode(selectedNode)
          ? createFolderDetail(selectedNode)
          : createBookmarkDetail(selectedNode);
      }
      return createDetailEmptyState();
    });
    currentComponent = nextComponent;

    content.replaceChildren();
    // Keep the actual mount untracked for the same reason as component creation:
    // child-local reactive reads must not subscribe the parent detail host effect.
    untrack(() => nextComponent.mount(content));

    // Update meta text inline -- avoids a second effect.
    if (selectionCount > 1) {
      meta.textContent = t("{count} items selected", { count: selectionCount });
    } else if (!selectedNode) {
      meta.textContent = t("No selection yet");
    } else {
      meta.textContent = t(isFolderNode(selectedNode) ? "Folder selected" : "Bookmark selected");
    }
  });

  return {
    cleanup() {
      stop();
      currentComponent?.unmount?.();
    },
  };
}
