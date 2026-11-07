// @ts-check

import {
  attr,
  cleanupCollector,
  listener,
  mount,
  requireRef,
  template,
} from "../../shared/runtime/naf.js";
import { appState } from "../../shared/state/app-state.js";
import { duplicatesState } from "../../features/duplicates/duplicates-state.js";
import { linkCheckState } from "../../features/link-check/link-check-state.js";
import { bindRecentFilesMenu } from "../../features/recent-files/recent-files.js";
import { createAddBookmarkForm } from "../../features/editing/add-bookmark-form.js";
import { createAddFolderForm } from "../../features/editing/add-folder-form.js";

/**
 * @typedef {object} AppShellActionsShell
 * @property {HTMLElement} toolbarActions
 * @property {HTMLElement} treePaneActions
 */

/**
 * @param {{
 *   openFile: () => Promise<void>,
 *   createFile: () => Promise<void>,
 *   importFile: () => Promise<void>
 * }} actions
 * @returns {Component<HTMLElement>}
 */
function createToolbarActionsComponent(actions) {
  const cleanup = cleanupCollector();
  const renderToolbarActions =
    /** @type {TemplateTag} */ (
      template({
        root: ".toolbar-actions-runtime",
        onMount(_el, _parent, ctx) {
          const openButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "openButton"));
          const createButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "createButton"));
          const importButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "importButton"));
          const duplicatesButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "duplicatesButton"));
          const linkCheckButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "linkCheckButton"));
          const recentButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "recentButton"));
          const recentMenu = /** @type {HTMLElement} */ (requireRef(ctx.refs, "recentMenu"));

          const handleOpenClick = () => {
            void actions.openFile();
          };
          const handleCreateClick = () => {
            void actions.createFile();
          };
          const handleImportClick = () => {
            void actions.importFile();
          };

          cleanup.add(
            listener(openButton, "click", handleOpenClick),
            listener(createButton, "click", handleCreateClick),
            listener(importButton, "click", handleImportClick),
            attr(importButton, "disabled", () => !appState.selectors.getCurrentFilePath()),
            listener(duplicatesButton, "click", () => void duplicatesState.actions.openDuplicates()),
            attr(duplicatesButton, "disabled", () => !appState.selectors.getCurrentFilePath()),
            listener(linkCheckButton, "click", () => linkCheckState.actions.openLinkCheck()),
            bindRecentFilesMenu(recentButton, recentMenu),
            attr(linkCheckButton, "disabled", () => !appState.selectors.getCurrentFilePath()),
          );
        },
        onUnmount() {
          cleanup.run();
        },
      })
    );

  return renderToolbarActions /*html*/ `
    <div class="toolbar-actions-runtime">
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square toolbar-action-btn"
        data-toolbar-action="open"
        data-ref="openButton"
        aria-label="Open bookmark file"
        title="Open bookmark file"
      >
        <span class="icon-mask toolbar-action-icon toolbar-action-icon--open" aria-hidden="true"></span>
      </button>
      <div class="recent-files">
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square toolbar-action-btn"
          data-toolbar-action="recent"
          data-ref="recentButton"
          aria-label="Recent files (Ctrl+Shift+O)"
          title="Recent files (Ctrl+Shift+O)"
          aria-haspopup="menu"
          aria-expanded="false"
        >
          <span class="icon-mask toolbar-action-icon toolbar-action-icon--recent" aria-hidden="true"></span>
        </button>
        <div class="recent-files__menu" role="menu" data-ref="recentMenu" hidden></div>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square toolbar-action-btn"
        data-toolbar-action="create"
        data-ref="createButton"
        aria-label="Create bookmark file"
        title="Create bookmark file"
      >
        <span class="icon-mask toolbar-action-icon toolbar-action-icon--create" aria-hidden="true"></span>
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square toolbar-action-btn"
        data-toolbar-action="import"
        data-ref="importButton"
        aria-label="Import another bookmark file into the current library"
        title="Import another bookmark file into the current library"
      >
        <span class="icon-mask toolbar-action-icon toolbar-action-icon--import" aria-hidden="true"></span>
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square toolbar-action-btn"
        data-toolbar-action="duplicates"
        data-ref="duplicatesButton"
        aria-label="Find duplicate bookmarks (Ctrl+Shift+D)"
        title="Find duplicate bookmarks (Ctrl+Shift+D)"
      >
        <span class="icon-mask toolbar-action-icon toolbar-action-icon--duplicates" aria-hidden="true"></span>
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square toolbar-action-btn"
        data-toolbar-action="link-check"
        data-ref="linkCheckButton"
        aria-label="Check for dead links (Ctrl+Shift+L)"
        title="Check for dead links (Ctrl+Shift+L)"
      >
        <span class="icon-mask toolbar-action-icon toolbar-action-icon--link-check" aria-hidden="true"></span>
      </button>
    </div>
  `;
}

/**
 * @param {AppShellActionsShell} shell
 * @param {{
 *   openFile: () => Promise<void>,
 *   createFile: () => Promise<void>,
 *   importFile: () => Promise<void>
 * }} actions
 * @returns {{ cleanup: () => void }}
 */
export function mountToolbarActions(shell, actions) {
  const component = createToolbarActionsComponent(actions);
  mount(component, shell.toolbarActions);

  return {
    cleanup() {
      component.unmount?.();
      shell.toolbarActions.replaceChildren();
    },
  };
}

/**
 * @param {AppShellActionsShell} shell
 * @returns {{ cleanup: () => void }}
 */
export function mountRootTreeActions(shell) {
  const rootAddBookmark = createAddBookmarkForm({
    triggerLabel: "",
    formTitle: "Create bookmark at root",
    triggerClassName:
      "btn btn-ghost btn-sm btn-square tree-pane__action-btn tree-pane__action-btn--bookmark",
    triggerKeyboardAction: "root-add-bookmark",
    triggerAriaLabel: "New bookmark",
    triggerTitle: "New bookmark",
    triggerIconClassName:
      "tree-pane__action-icon icon-mask tree-pane__action-icon--bookmark",
    getParentFolderId: () => "",
  });
  const rootAddFolder = createAddFolderForm({
    triggerLabel: "",
    formTitle: "Create folder at root",
    triggerClassName:
      "btn btn-ghost btn-sm btn-square tree-pane__action-btn tree-pane__action-btn--folder",
    triggerKeyboardAction: "root-add-folder",
    triggerAriaLabel: "New folder",
    triggerTitle: "New folder",
    triggerIconClassName:
      "tree-pane__action-icon icon-mask tree-pane__action-icon--folder",
    getParentFolderId: () => "",
  });
  const renderRootActions =
    /** @type {TemplateTag} */ (
      template
    );
  const rootActions = renderRootActions`
    ${rootAddBookmark}
    ${rootAddFolder}
  `;
  mount(rootActions, shell.treePaneActions);

  return {
    cleanup() {
      rootActions.unmount?.();
      shell.treePaneActions.replaceChildren();
    },
  };
}
