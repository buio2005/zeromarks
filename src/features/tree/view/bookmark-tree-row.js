// @ts-check

import { cleanupCollector, fx, listener } from "../../../shared/runtime/naf.js";
import { treeState } from "../state/tree-state.js";
import { uiState } from "../../../shared/state/ui-state.js";

/**
 * @typedef {object} TreeNodeMountOptions
 * @property {(entry: VisibleTreeNodeEntry, event: MouseEvent) => void} onPointerDown
 * @property {() => boolean} shouldIgnoreClick
 */

/**
 * @param {VisibleTreeNodeEntry["node"]} node
 * @returns {node is FolderNode}
 */
function isFolderNode(node) {
  return node.type === 0;
}

/**
 * @param {VisibleTreeNodeEntry["node"]} node
 * @returns {string}
 */
function getNodeLabel(node) {
  if (isFolderNode(node)) {
    return node.folder.name || "Untitled folder";
  }
  return node.bookmark.title || node.bookmark.url || "Untitled bookmark";
}

/**
 * Mount a tree row. Uses direct child access instead of querySelector
 * for each mount -- the template structure is fixed and controlled by this module.
 *
 * Template structure (TREE_NODE_HTML in bookmark-tree.js):
 *   <article class="tree-node">           <-- el
 *     <div class="tree-row">              <-- row (el.firstElementChild)
 *       <button class="tree-row__toggle">  <-- children[0] (toggle)
 *       <span class="tree-row__folder-icon"> <-- children[1] (folderIcon)
 *       <img class="tree-row__favicon">    <-- children[2] (favicon)
 *       <span class="tree-row__bookmark-icon"> <-- children[3] (bookmarkIcon)
 *       <span class="tree-row__label">     <-- children[4] (label)
 *       <span class="tree-row__count">     <-- children[5] (count)
 *     </div>
 *   </article>
 *
 * @param {HTMLElement} el
 * @param {() => VisibleTreeNodeEntry} entry
 * @param {TreeNodeMountOptions} options
 * @returns {() => void}
 */
export function mountBookmarkTreeRow(el, entry, options) {
  const row = /** @type {HTMLElement} */ (el.firstElementChild);

  // Direct child access -- see template structure comment above
  const toggle = /** @type {HTMLElement} */ (row.children[0]);
  const folderIcon = /** @type {HTMLElement} */ (row.children[1]);
  const favicon = /** @type {HTMLImageElement} */ (row.children[2]);
  const bookmarkIcon = /** @type {HTMLElement} */ (row.children[3]);
  const label = /** @type {HTMLElement} */ (row.children[4]);
  const count = /** @type {HTMLElement} */ (row.children[5]);

  if (!(row instanceof HTMLElement)) {
    throw new Error("Expected .tree-row element");
  }

  /** @param {MouseEvent} event */
  const handleToggleClick = (event) => {
    event.stopPropagation();
    const current = entry();
    if (isFolderNode(current.node)) {
      treeState.actions.toggleExpand(current.id);
    }
  };

  /**
   * @param {MouseEvent} event
   * @returns {void}
   */
  const handleRowClick = (event) => {
    if (options.shouldIgnoreClick()) {
      return;
    }

    const current = entry();

    if (event.shiftKey) {
      const changed = treeState.actions.selectRange(
        current.id,
        treeState.selectors.getVisibleNodeIds(),
      );
      if (!changed) {
        uiState.actions.showToast(
          "Range selection must stay within the same sibling group",
          "warning",
        );
      }
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      const changed = treeState.actions.toggleSelected(current.id);
      if (!changed) {
        uiState.actions.showToast(
          "Multi-select only supports matching sibling bookmarks or folders",
          "warning",
        );
      }
      return;
    }

    treeState.actions.selectSingle(current.id);
  };

  /** @param {MouseEvent} event */
  const handlePointerDown = (event) => {
    options.onPointerDown(entry(), event);
  };

  const stop = fx(row, (currentRow) => {
    const current = entry();
    const node = current.node;
    const folder = isFolderNode(node);
    const expanded = folder
      ? treeState.selectors.isExpanded(current.id)
      : false;
    const selected = treeState.selectors.isSelected(current.id);
    const primary = treeState.selectors.getSelectedNodeId() === current.id;

    currentRow.dataset.nodeId = current.id;
    currentRow.dataset.nodeType = folder ? "folder" : "bookmark";
    currentRow.style.paddingLeft = `${current.depth * 16 + (folder ? 8 : 28)}px`;
    currentRow.classList.toggle("is-selected", selected);
    currentRow.classList.toggle("is-primary", primary);
    currentRow.setAttribute("aria-selected", selected ? "true" : "false");
    currentRow.setAttribute(
      "aria-expanded",
      folder ? String(expanded) : "false",
    );

    if (label) {
      label.textContent = getNodeLabel(node);
    }

    if (toggle instanceof HTMLElement) {
      toggle.hidden = !folder;
      toggle.setAttribute("aria-hidden", folder ? "false" : "true");
      toggle.classList.toggle("is-expanded", expanded);
    }

    if (folderIcon instanceof HTMLElement) {
      folderIcon.hidden = !folder;
      folderIcon.classList.toggle("is-open", expanded);
    }

    if (bookmarkIcon instanceof HTMLElement) {
      bookmarkIcon.hidden = folder || Boolean(!folder && node.bookmark.icon);
    }

    if (count instanceof HTMLElement) {
      count.hidden = !folder;
      if (folder) {
        const childCount = node.folder.childrenLoaded
          ? node.folder.children.length
          : node.folder.childCount;
        count.textContent = `(${childCount})`;
      } else {
        count.textContent = "";
      }
    }

    if (favicon) {
      const icon = !folder ? node.bookmark.icon : "";
      favicon.hidden = folder || !icon;
      if (icon) {
        favicon.src = icon;
      } else {
        favicon.removeAttribute("src");
      }
    }
  });

  const cleanup = cleanupCollector(
    listener(toggle, "click", handleToggleClick),
    listener(row, "click", handleRowClick),
    listener(row, "mousedown", handlePointerDown),
    stop,
  );

  return cleanup.run;
}
