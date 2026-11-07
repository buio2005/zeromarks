// @ts-check

import { t } from "../../shared/i18n/i18n.js";
import { searchState } from "../../features/search/state/search-state.js";
import { treeState } from "../../features/tree/state/tree-state.js";
import {
  attr,
  cleanupCollector,
  effect,
  listener,
  mount,
  requireRef,
  template,
} from "../../shared/runtime/naf.js";
import { bindRecentFilesList } from "../../features/recent-files/recent-files.js";
import {
  showEmptyLibraryFrame,
  showLibraryFrame,
} from "../page-frame.js";

/**
 * @typedef {object} EmptyLibraryPageShell
 * @property {HTMLElement} root
 * @property {HTMLElement} appToolbar
 * @property {HTMLElement} mainContent
 * @property {HTMLElement} treePane
 * @property {HTMLElement} detailPane
 * @property {HTMLButtonElement} paneResizer
 */

/**
 * @typedef {object} EmptyLibraryPageActions
 * @property {() => Promise<void>} openFile
 * @property {() => Promise<void>} createFile
 */

/**
 * @param {EmptyLibraryPageActions} actions
 * @returns {Component<HTMLElement>}
 */
function createEmptyLibrarySplash(actions) {
  /** @type {TemplateTag} */
  const renderSplash =
    /** @type {TemplateTag} */ (
      template({
        root: ".empty-library-page",
        onMount(_el, _parent, ctx) {
          const openButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "openButton"));
          const createButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "createButton"));
          const recentList = /** @type {HTMLElement} */ (requireRef(ctx.refs, "recentList"));

          const handleOpenClick = () => {
            void actions.openFile();
          };
          const handleCreateClick = () => {
            void actions.createFile();
          };

          cleanup.add(
            listener(openButton, "click", handleOpenClick),
            listener(createButton, "click", handleCreateClick),
            attr(openButton, "disabled", () => treeState.selectors.isLoading()),
            attr(createButton, "disabled", () => treeState.selectors.isLoading()),
            bindRecentFilesList(recentList),
          );

          queueMicrotask(() => {
            openButton.focus();
          });
        },
        onUnmount() {
          cleanup.run();
        },
      })
    );

  const cleanup = cleanupCollector();

  return renderSplash /*html*/ `
    <section class="empty-library-page" aria-labelledby="empty-library-title">
      <h2 id="empty-library-title" class="empty-library-page__title">
        Open your archive or start a fresh one.
      </h2>
      <p class="empty-library-page__copy">
        Everything is kept in a plain bookmarks HTML file, so your
        library stays portable, inspectable, and yours.
      </p>
      <div class="empty-library-page__actions">
        <button
          type="button"
          class="btn btn-primary"
          data-ref="openButton"
        >
          Open File
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          data-ref="createButton"
        >
          Create File
        </button>
      </div>
      <div class="recent-files__list" data-ref="recentList" hidden></div>
    </section>
  `;
}

/**
 * @param {EmptyLibraryPageShell} shell
 * @param {EmptyLibraryPageActions} actions
 * @returns {{ cleanup: () => void }}
 */
export function mountEmptyLibraryPage(shell, actions) {
  searchState.actions.clearQuery();
  showEmptyLibraryFrame(shell);

  const emptyLibraryHost =
    /** @type {HTMLElement|null} */ (document.getElementById("empty-library-host"));
  if (!(emptyLibraryHost instanceof HTMLElement)) {
    throw new Error("Expected #empty-library-host element");
  }

  const splash = createEmptyLibrarySplash(actions);
  mount(splash, emptyLibraryHost);

  const titlebarMeta =
    /** @type {HTMLElement|null} */ (document.getElementById("titlebar-meta"));
  if (!(titlebarMeta instanceof HTMLElement)) {
    throw new Error("Expected #titlebar-meta element");
  }

  const stopEffect = effect(() => {
    const treeError = treeState.selectors.getError();
    const loading = treeState.selectors.isLoading();

    titlebarMeta.textContent = t(
      treeError || (loading ? "Loading bookmark library..." : "No bookmark file is open"),
    );
  });

  return {
    cleanup() {
      stopEffect();
      titlebarMeta.textContent = "";
      splash.unmount?.();
      emptyLibraryHost.replaceChildren();
      showLibraryFrame(shell);
    },
  };
}
