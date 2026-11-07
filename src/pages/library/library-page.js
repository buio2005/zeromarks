// @ts-check

import { t } from "../../shared/i18n/i18n.js";
import {
  cleanupCollector,
  effect,
  mount,
  requireElement,
  template,
} from "../../shared/runtime/naf.js";
import { appState } from "../../shared/state/app-state.js";
import { treeState } from "../../features/tree/state/tree-state.js";
import {
  mountRootTreeActions,
  mountToolbarActions,
} from "../../components/toolbar/toolbar-actions.js";
import {
  mountBookmarkTree,
} from "../../features/tree/view/bookmark-tree.js";
import {
  mountDetailPanel,
} from "../../features/detail/view/detail-panel.js";
import { mountGlobalShortcuts } from "../../features/shortcuts/global-shortcuts.js";
import {
  mountSearchBar,
} from "../../features/search/view/search-bar.js";
import {
  showLibraryFrame,
} from "../page-frame.js";

/**
 * @typedef {object} LibraryPageShell
 * @property {HTMLElement} root
 * @property {HTMLElement} titlebarMeta
 * @property {HTMLElement} appToolbar
 * @property {HTMLElement} mainContent
 * @property {HTMLElement} treePane
 * @property {HTMLElement} detailPane
 * @property {HTMLButtonElement} paneResizer
 * @property {HTMLInputElement} searchInput
 * @property {HTMLElement} treePaneActions
 * @property {HTMLElement} toolbarActions
 */

/**
 * @typedef {object} LibraryPageActions
 * @property {() => Promise<void>} openFile
 * @property {() => Promise<void>} createFile
 * @property {() => Promise<void>} importFile
 */

/**
 * @param {LibraryPageShell} shell
 * @returns {void}
 */
function activateLibraryShell(shell) {
  showLibraryFrame(shell);
  shell.searchInput.disabled = false;
  shell.searchInput.placeholder = t("Search bookmarks...");
}

/**
 * @param {LibraryPageShell} shell
 * @param {LibraryPageActions} actions
 * @returns {{ cleanup: () => void }}
 */
function mountLibraryToolbarAndFeatures(shell, actions) {
  const toolbarActions = mountToolbarActions(shell, actions);
  const rootTreeActions = mountRootTreeActions(shell);
  const searchBar = mountSearchBar(shell.root);
  const bookmarkTree = mountBookmarkTree(shell.root);
  const detailPanel = mountDetailPanel(shell.root);
  const globalShortcuts = mountGlobalShortcuts({
    searchInput: shell.searchInput,
    focusSearch: () => searchBar.focus(),
    focusTree: () => bookmarkTree.focusTree(),
    openFile: actions.openFile,
    createFile: actions.createFile,
  });

  queueMicrotask(() => {
    searchBar.focus();
  });

  return {
    cleanup() {
      globalShortcuts.cleanup();
      searchBar.cleanup();
      bookmarkTree.cleanup();
      detailPanel.cleanup();
      rootTreeActions.cleanup();
      toolbarActions.cleanup();
    },
  };
}

/**
 * @param {LibraryPageShell} shell
 * @returns {() => void}
 */
function mountLibraryTitlebarMeta(shell) {
  return effect(() => {
    const filePath = appState.selectors.getCurrentFilePath();
    const treeError = treeState.selectors.getError();
    const loading = treeState.selectors.isLoading();

    shell.titlebarMeta.textContent = treeError
      ? t(treeError)
      : filePath ||
        t(loading
          ? "Loading bookmark library..."
          : "Bookmark library");
  });
}

/**
 * @param {LibraryPageShell} shell
 * @param {LibraryPageActions} actions
 * @returns {Component<HTMLElement>}
 */
function createLibraryPageComponent(shell, actions) {
  const cleanup = cleanupCollector();
  const renderLibraryPage =
    /** @type {TemplateTag} */ (
      template({
        root: ".library-page-runtime-anchor",
        onMount() {
          activateLibraryShell(shell);

          const mountedFeatures = mountLibraryToolbarAndFeatures(shell, actions);
          cleanup.add(
            () => mountedFeatures.cleanup(),
            mountLibraryTitlebarMeta(shell),
          );
        },
        onUnmount() {
          cleanup.run();
        },
      })
    );

  return renderLibraryPage /*html*/ `
    <div class="library-page-runtime-anchor" hidden></div>
  `;
}

/**
 * @param {LibraryPageShell} shell
 * @param {LibraryPageActions} actions
 * @returns {{ cleanup: () => void }}
 */
export function mountLibraryPage(shell, actions) {
  const pageHost = requireElement(shell.root, "#page-host", "page-host");

  const libraryPage = createLibraryPageComponent(shell, actions);
  mount(libraryPage, pageHost);

  return {
    cleanup() {
      libraryPage.unmount?.();
      pageHost.replaceChildren();
    },
  };
}
