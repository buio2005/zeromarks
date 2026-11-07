// @ts-check

import { trapFocusInContainer } from "../../shared/infra/focus.js";
import { cleanupCollector, listener, mount, raw, requireElement, requireRef, template, when } from "../../shared/runtime/naf.js";
import { appState } from "../../shared/state/app-state.js";

const groups = [
  {
    title: "Global",
    items: [
      { keys: "Ctrl/Cmd+O", action: "Open file" },
      { keys: "Ctrl/Cmd+Shift+O", action: "Recent files" },
      { keys: "Ctrl/Cmd+N", action: "Create file" },
      { keys: "Ctrl/Cmd+Shift+I", action: "Import / merge" },
      { keys: "Ctrl/Cmd+Shift+D", action: "Find duplicates" },
      { keys: "Ctrl/Cmd+Shift+L", action: "Check for dead links" },
      { keys: "Ctrl/Cmd+F or /", action: "Focus search" },
      { keys: "F6", action: "Cycle focus zones" },
      { keys: "Ctrl/Cmd+Z", action: "Undo" },
      { keys: "Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z", action: "Redo" },
      { keys: "? or F1", action: "Show keyboard help" },
    ],
  },
  {
    title: "Tree",
    items: [
      { keys: "Arrow keys", action: "Navigate tree or search results" },
      { keys: "Home / End", action: "Jump first or last item" },
      { keys: "PageUp / PageDown", action: "Jump by larger step" },
      { keys: "Enter", action: "Open detail panel for selection" },
      { keys: "Space", action: "Toggle folder expand/collapse" },
    ],
  },
  {
    title: "Selection",
    items: [
      { keys: "Shift+Up / Shift+Down", action: "Extend selection range" },
      { keys: "Ctrl/Cmd+Space", action: "Toggle current item in selection" },
      { keys: "Ctrl/Cmd+A", action: "Select all siblings" },
      { keys: "Ctrl/Cmd+Shift+A", action: "Collapse to primary selection" },
    ],
  },
  {
    title: "Actions",
    items: [
      { keys: "A", action: "Add bookmark" },
      { keys: "Shift+A", action: "Add folder" },
      { keys: "E", action: "Edit item" },
      { keys: "F2", action: "Rename item" },
      { keys: "O", action: "Open bookmark" },
      { keys: "M", action: "Move selection" },
      { keys: "Delete / Backspace", action: "Delete selection" },
      { keys: "Ctrl/Cmd+Shift+F", action: "Fetch favicon(s)" },
      { keys: "Ctrl/Cmd+Shift+T", action: "Refresh title(s)" },
    ],
  },
  {
    title: "Other Features",
    items: [
      { keys: "Ctrl/Cmd+Click", action: "Add or remove an item from multi-selection" },
      { keys: "Shift+Click", action: "Select a range within the current sibling group" },
      { keys: "Drag and Drop", action: "Reorder items or move them into folders" },
      { keys: "Search + Enter", action: "Jump from search results into the detail panel" },
      { keys: "Search + Ctrl/Cmd+Enter", action: "Open the selected search result directly" },
    ],
  },
];

/**
 * @param {{ title: string, items: Array<{ keys: string, action: string }> }} group
 * @returns {string}
 */
function renderGroup(group) {
  const itemsHtml = group.items
    .map(
      (item) => /*html*/ `
        <div class="shortcuts-dialog__row">
          <kbd class="shortcuts-dialog__kbd">${item.keys}</kbd>
          <span class="shortcuts-dialog__action">${item.action}</span>
        </div>
      `,
    )
    .join("");

  return /*html*/ `
    <section class="shortcuts-dialog__section">
      <div class="shortcuts-dialog__section-header">
        <h3 class="shortcuts-dialog__section-title">${group.title}</h3>
      </div>
      <div class="shortcuts-dialog__rows">${itemsHtml}</div>
    </section>
  `;
}

/**
 * @returns {Component<HTMLElement>}
 */
function createKeyboardShortcutsDialog() {
  let cleanupRendered = () => {};
  const groupsHtml = groups.map(renderGroup).join("");
  const renderDialog = /** @type {TemplateTag} */ (
    template({
      onMount(_el, _parent, ctx) {
        const backdrop = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "backdrop"));
        const dialog = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "dialog"));
        const closeButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "closeButton"));

        const closeDialog = () => {
          appState.actions.closeKeyboardShortcuts();
        };
        /** @param {MouseEvent} event */
        const handleBackdropClick = (event) => {
          if (event.target === backdrop) {
            closeDialog();
          }
        };
        /** @param {MouseEvent} event */
        const handleDialogClick = (event) => {
          event.stopPropagation();
        };
        const handleCloseClick = () => {
          closeDialog();
        };
        /** @param {KeyboardEvent} event */
        const handleDialogKeydown = (event) => {
          if (trapFocusInContainer(event, dialog)) {
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            closeDialog();
          }
        };

        queueMicrotask(() => {
          closeButton.focus();
        });

        const cleanup = cleanupCollector(
          listener(backdrop, "click", handleBackdropClick),
          listener(dialog, "click", handleDialogClick),
          listener(dialog, "keydown", handleDialogKeydown),
          listener(closeButton, "click", handleCloseClick),
        );

        cleanupRendered = () => {
          cleanup.run();
        };
      },
      onUnmount() {
        cleanupRendered();
        cleanupRendered = () => {};
      },
    })
  );

  return renderDialog /*html*/ `
    <div class="modal-backdrop" role="presentation" data-ref="backdrop">
      <div
        class="modal shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        data-focus-zone="dialog"
        tabindex="-1"
        data-ref="dialog"
      >
        <div class="modal__header shortcuts-dialog__header">
          <div>
            <h2 id="keyboard-shortcuts-title" class="shortcuts-dialog__title">Keyboard Shortcuts</h2>
            <p class="shortcuts-dialog__subtitle">Core commands for mouse-free bookmark management.</p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-square titlebar__window-button titlebar__window-button--close"
            data-keyboard-action="shortcuts-close"
            data-ref="closeButton"
          >
            &#10005;
          </button>
        </div>
        <div class="modal__body shortcuts-dialog__body">${raw(groupsHtml)}</div>
      </div>
    </div>
  `;
}

/**
 * @param {ParentNode} root
 * @returns {{ cleanup: () => void }}
 */
export function mountKeyboardShortcutsDialog(root) {
  const container = /** @type {HTMLElement} */ (requireElement(root, "#keyboard-shortcuts-dialog-container", "keyboard-shortcuts-dialog-container"));
  const renderShell = /** @type {TemplateTag} */ (template);

  const component = renderShell`
    ${when(
      () => appState.selectors.isKeyboardShortcutsOpen(),
      () => createKeyboardShortcutsDialog(),
      () => createEmptyComponent(),
    )}
  `;

  mount(component, container);

  return {
    cleanup() {
      component.unmount?.();
    },
  };
}

/** @returns {Component} */
function createEmptyComponent() {
  return {
    html: '',
    refs: {},
    mount() {},
    unmount() {},
  };
}
