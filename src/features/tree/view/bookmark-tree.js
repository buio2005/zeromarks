// @ts-check

import { tn } from "../../../shared/i18n/i18n.js";
import { cleanupCollector, effect, listener, list, raw, requireElement, template } from "../../../shared/runtime/naf.js";
import { searchState } from "../../search/state/search-state.js";
import { treeState } from "../state/tree-state.js";
import { createBookmarkTreeDndController } from "../interactions/bookmark-tree-dnd.js";
import { createBookmarkTreeKeydownHandler } from "../interactions/bookmark-tree-keyboard.js";
import { mountBookmarkSearchResultRow } from "./bookmark-search-result-row.js";
import { mountBookmarkTreeRow } from "./bookmark-tree-row.js";

/** @type {string} */
const TREE_NODE_HTML = /*html*/ `
  <article class="tree-node">
    <div
      class="tree-row menu-item"
      role="treeitem"
      tabindex="-1"
      aria-selected="false"
    >
      <button
        class="tree-row__toggle btn btn-ghost btn-sm btn-square"
        type="button"
        aria-label="Toggle folder"
      ></button>
      <span
        class="tree-row__folder-icon icon-mask"
        aria-hidden="true"
      ></span>
      <img class="tree-row__favicon" alt="" hidden />
      <span
        class="tree-row__bookmark-icon icon-mask"
        aria-hidden="true"
      ></span>
      <span class="tree-row__label"></span>
      <span class="tree-row__count"></span>
    </div>
  </article>
`;

/** @type {string} */
const SEARCH_RESULT_HTML = /*html*/ `
  <article
    class="search-result menu-item"
    role="button"
    tabindex="0"
    aria-selected="false"
  >
    <span class="search-result__icon icon-mask" aria-hidden="true"></span>
    <span class="search-result__label"></span>
    <span class="search-result__meta"></span>
  </article>
`;

/** Fixed row height for virtual scrolling. */
const ROW_HEIGHT = 32;

/**
 * @param {ParentNode} root
 * @returns {{ focusTree: () => void, cleanup: () => void }}
 */
export function mountBookmarkTree(root) {
  const treeRoot = /** @type {HTMLElement} */ (root);
  const treeList = /** @type {HTMLElement} */ (requireElement(root, "#tree-list", "tree-list"));
  const treePaneMeta = requireElement(root, "#tree-pane-meta", "tree-pane-meta");
  let stopList = () => {};
  const dnd = createBookmarkTreeDndController({ treeList });
  /**
   * @param {string} nodeId
   * @returns {void}
   */
  function activateSearchNode(nodeId) {
    void treeState.actions.revealAndSelectNode(nodeId);
  }
  const handleTreeKeydown = createBookmarkTreeKeydownHandler(activateSearchNode);

  /**
   * Determine the current rendering mode.
   * @returns {"search" | "tree"}
   */
  function getCurrentMode() {
    return searchState.selectors.isSearching() ? "search" : "tree";
  }

  /**
   * Mount the list for the given mode. Only called when mode changes.
   * The list() function's internal effect handles item-level updates.
   * Always mounts the list (even if empty) -- the empty-state effect
   * manages the "No bookmarks" message independently.
   * @returns {void}
   */
  function mountListForMode() {
    stopList();
    treeList.replaceChildren();

    if (getCurrentMode() === "search") {
      stopList = list(
        treeList,
        SEARCH_RESULT_HTML,
        () => searchState.selectors.getResults(),
        (item) => item.nodeId,
        (el, item) => {
          if (!(el instanceof HTMLElement)) {
            throw new Error("Expected search result element");
          }
          return mountBookmarkSearchResultRow(el, item);
        },
        { virtual: { rowHeight: ROW_HEIGHT } },
      );
      return;
    }

    // Tree mode
    stopList = list(
      treeList,
      TREE_NODE_HTML,
      () => treeState.selectors.getVisibleNodeEntries(),
      (item) => item.id,
      (el, item) => {
        if (!(el instanceof HTMLElement)) {
          throw new Error("Expected tree row element");
        }
        return mountBookmarkTreeRow(el, item, {
          onPointerDown: dnd.handleNodePointerDown,
          shouldIgnoreClick: dnd.shouldIgnoreClick,
        });
      },
      { virtual: { rowHeight: ROW_HEIGHT } },
    );
  }

  // Effect 1: Recreate the list only when switching between search and tree modes.
  // The list() function's internal effect handles item-level updates reactively,
  // so we don't need to tear it down on every tree/selection/expansion change.
  /** @type {string | undefined} */
  let currentMode;

  const stopListEffect = effect(() => {
    const nextMode = getCurrentMode();
    if (nextMode !== currentMode) {
      currentMode = nextMode;
      mountListForMode();
    }
  });

  // Effect 2: Show/hide the empty state message based on whether the list has children.
  // This runs reactively whenever the underlying data changes (tree items, search results).
  // Key: we check children.length AFTER the list effect has run. The empty-state component
  // itself is a child, so we use a flag to distinguish "has real list items" from
  // "only has the empty-state message".
  /** @type {Component<HTMLElement> | null} */
  let emptyStateComponent = null;
  let emptyStateKind = "";

  const stopEmptyStateEffect = effect(() => {
    // Read the signals to determine if data is empty (drives reactivity).
    // The list() effect has already run by this point and added/removed DOM items.
    const isSearching = searchState.selectors.isSearching();
    const loading = treeState.selectors.isLoading();
    const dataIsEmpty = isSearching
      ? searchState.selectors.getResults().length === 0
      : treeState.selectors.getVisibleNodeEntries().length === 0;
    const nextEmptyStateKind = loading
      ? "loading"
      : dataIsEmpty
        ? `empty:${isSearching ? "search" : "tree"}`
        : "";

    if (nextEmptyStateKind && nextEmptyStateKind !== emptyStateKind) {
      emptyStateComponent?.unmount?.();
      const renderEmptyTreeState = /** @type {TemplateTag} */ (template);
      const content = loading
        ? raw('<span class="spinner spinner-sm tree-empty-state__spinner" aria-hidden="true"></span><span>Loading bookmark library...</span>')
        : isSearching
          ? "No results found"
          : "No bookmarks or folders yet";
      emptyStateComponent = renderEmptyTreeState`
        <div class="tree-empty-state">${content}</div>
      `;
      emptyStateComponent.mount(treeList);
      emptyStateKind = nextEmptyStateKind;
    } else if (!nextEmptyStateKind && emptyStateComponent !== null) {
      emptyStateComponent.unmount?.();
      emptyStateComponent = null;
      emptyStateKind = "";
    }
  });

  // Effect 3: Update the pane meta text independently.
  const stopMetaEffect = effect(() => {
    if (searchState.selectors.isSearching()) {
      const count = searchState.selectors.getResults().length;
      const query = searchState.selectors.getQuery();
      treePaneMeta.textContent = tn(count, '{count} result for "{query}"', '{count} results for "{query}"', { query });
      return;
    }

    const stats = treeState.selectors.getTreeStats();
    treePaneMeta.textContent =
      `${tn(stats.folders, "{count} folder", "{count} folders")}, ` +
      tn(stats.bookmarks, "{count} bookmark", "{count} bookmarks");
  });

  // Scroll restore: version-based handshake with restoreUIState().
  // restoreUIState() increments scrollRestoreVersion after async folder loading
  // completes. This effect applies the saved scroll position only when the
  // version changes and visible entries exist, then marks the version consumed.
  /** @type {number} */
  let consumedScrollVersion = 0;

  const stopScrollRestoreEffect = effect(() => {
    if (searchState.selectors.isSearching()) {
      return;
    }
    const currentVersion = treeState.selectors.getScrollRestoreVersion();
    if (currentVersion <= consumedScrollVersion) {
      return;
    }
    const entries = treeState.selectors.getVisibleNodeEntries();
    if (entries.length === 0) {
      return;
    }
    const scrollTop = treeState.selectors.getTreeScrollTop();
    treeList.scrollTop = scrollTop;
    treeList.dispatchEvent(new Event("scroll"));
    consumedScrollVersion = currentVersion;
  });

  function handleTreeListScroll() {
    treeState.actions.setTreeScrollTop(treeList.scrollTop);
  }

  const cleanup = cleanupCollector(
    listener(treeRoot, "keydown", handleTreeKeydown),
    listener(treeList, "scroll", handleTreeListScroll),
    listener(document, "mousemove", dnd.handleDocumentMouseMove),
    listener(document, "mouseup", dnd.handleDocumentMouseUp),
    listener(document, "mouseleave", dnd.handleDocumentMouseLeave),
    stopListEffect,
    stopEmptyStateEffect,
    stopMetaEffect,
    stopScrollRestoreEffect,
  );

  return {
    focusTree() {
      treeRoot.focus();
    },
    cleanup() {
      cleanup.run();
      stopList();
      dnd.clearDragState();
    },
  };
}
