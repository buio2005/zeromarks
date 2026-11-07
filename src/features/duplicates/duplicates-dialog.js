// @ts-check

import { t, tn } from "../../shared/i18n/i18n.js";
import { DeleteNodes } from "../../shared/api/api.js";
import { getErrorMessage } from "../../shared/infra/errors.js";
import { trapFocusInContainer } from "../../shared/infra/focus.js";
import {
  cleanupCollector,
  effect,
  listener,
  mount,
  requireElement,
  requireRef,
  template,
  when,
} from "../../shared/runtime/naf.js";
import { uiState } from "../../shared/state/ui-state.js";
import { treeState } from "../tree/state/tree-state.js";
import { duplicatesState } from "./duplicates-state.js";

/**
 * @param {string} value
 * @returns {string}
 */
function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}


async function removeSelected() {
  const ids = duplicatesState.selectors.getRemoveIds();
  if (ids.length === 0) {
    return;
  }
  try {
    await DeleteNodes(ids);
    treeState.actions.clearSelection();
    await treeState.actions.refresh();
    duplicatesState.actions.close();
    uiState.actions.showToast(
      tn(ids.length, "{count} duplicate removed. Press Ctrl+Z to undo.", "{count} duplicates removed. Press Ctrl+Z to undo."),
      "success",
    );
  } catch (caughtError) {
    uiState.actions.showToast(getErrorMessage(caughtError, "Failed to remove duplicates"), "error");
  }
}

/**
 * Builds one group card with plain DOM (text only via textContent).
 *
 * @param {DuplicateGroup} group
 * @returns {HTMLElement}
 */
function renderGroup(group) {
  const card = document.createElement("section");
  card.className = "duplicates-dialog__group";

  const header = document.createElement("header");
  header.className = "duplicates-dialog__group-header";
  const url = document.createElement("span");
  url.className = "duplicates-dialog__group-url";
  url.textContent = group.url;
  url.title = group.url;
  const count = document.createElement("span");
  count.className = "badge";
  count.textContent = tn(group.items.length, "{count} copy", "{count} copies");
  header.append(url, count);
  card.append(header);

  for (const item of group.items) {
    const removing = duplicatesState.selectors.isMarkedForRemoval(item.id);
    const row = document.createElement("label");
    row.className = "duplicates-dialog__row";
    row.classList.toggle("is-removing", removing);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "duplicates-dialog__checkbox";
    checkbox.checked = removing;
    checkbox.dataset.itemId = item.id;
    checkbox.setAttribute(
      "aria-label",
      t('Remove "{title}" in {folder}', { title: item.title || item.url, folder: item.folderPath || t("Root") }),
    );

    const text = document.createElement("span");
    text.className = "duplicates-dialog__row-text";
    const title = document.createElement("span");
    title.className = "duplicates-dialog__row-title";
    title.textContent = item.title || item.url;
    const meta = document.createElement("span");
    meta.className = "duplicates-dialog__row-meta";
    const date = formatDate(item.addDate);
    meta.textContent = [item.folderPath || t("Root"), date && t("added {date}", { date })].filter(Boolean).join(" · ");
    text.append(title, meta);

    const status = document.createElement("span");
    status.className = "duplicates-dialog__row-status";
    status.textContent = t(removing ? "Remove" : "Keep");

    row.append(checkbox, text, status);
    card.append(row);
  }
  return card;
}

/** @returns {Component} */
function createDuplicatesDialogComponent() {
  const cleanup = cleanupCollector();
  const render = /** @type {TemplateTag} */ (
    template({
      onMount(_el, _parent, ctx) {
        const backdrop = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "backdrop"));
        const dialog = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "dialog"));
        const subtitle = /** @type {HTMLElement} */ (requireRef(ctx.refs, "subtitle"));
        const list = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "list"));
        const keepAllButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "keepAllButton"));
        const resetButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "resetButton"));
        const cancelButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "cancelButton"));
        const confirmButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "confirmButton"));

        let busy = false;
        const runRemove = async () => {
          if (busy) {
            return;
          }
          busy = true;
          confirmButton.disabled = true;
          try {
            await removeSelected();
          } finally {
            busy = false;
          }
        };

        cleanup.add(
          effect(() => {
            const groups = duplicatesState.selectors.getGroups();
            const loading = duplicatesState.selectors.isLoading();
            const error = duplicatesState.selectors.getError();
            const toRemove = duplicatesState.selectors.getRemoveIds().length;
            const scrollTop = list.scrollTop;

            if (loading) {
              subtitle.textContent = t("Scanning your library…");
            } else if (error) {
              subtitle.textContent = error;
            } else if (groups.length === 0) {
              subtitle.textContent = t("No duplicates found. Every link appears only once.");
            } else {
              const copies = groups.reduce((sum, group) => sum + group.items.length, 0);
              subtitle.textContent =
                tn(groups.length, "{count} link saved more than once ({copies} bookmarks).", "{count} links saved more than once ({copies} bookmarks).", { copies }) +
                " " +
                t("Checked copies will be removed; the first copy is kept by default.");
            }

            list.replaceChildren(...groups.map(renderGroup));
            list.scrollTop = scrollTop;
            list.hidden = groups.length === 0;

            const hasGroups = groups.length > 0;
            keepAllButton.hidden = !hasGroups;
            resetButton.hidden = !hasGroups;
            confirmButton.hidden = !hasGroups;
            confirmButton.disabled = busy || toRemove === 0;
            confirmButton.textContent =
              toRemove === 0 ? t("Nothing to remove") : tn(toRemove, "Remove {count} copy", "Remove {count} copies");
            cancelButton.textContent = t(hasGroups ? "Cancel" : "Close");
          }),
        );

        /** @param {Event} event */
        const handleListChange = (event) => {
          const target = event.target;
          if (target instanceof HTMLInputElement && target.dataset.itemId) {
            const id = target.dataset.itemId;
            duplicatesState.actions.toggleRemove(id);
            // Keep keyboard focus on the same checkbox after the list re-renders.
            const again = list.querySelector(`input[data-item-id="${CSS.escape(id)}"]`);
            if (again instanceof HTMLInputElement) {
              again.focus();
            }
          }
        };

        /** @param {KeyboardEvent} event */
        const handleKeydown = (event) => {
          // Keep tree shortcuts (Delete, A, M, ...) from acting on the library behind the dialog.
          event.stopPropagation();
          if (trapFocusInContainer(event, dialog)) {
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            duplicatesState.actions.close();
          }
        };

        cleanup.add(
          listener(backdrop, "click", () => duplicatesState.actions.close()),
          listener(dialog, "click", (event) => event.stopPropagation()),
          listener(dialog, "keydown", handleKeydown),
          listener(list, "change", handleListChange),
          listener(keepAllButton, "click", () => duplicatesState.actions.keepAll()),
          listener(resetButton, "click", () => duplicatesState.actions.resetSelection()),
          listener(cancelButton, "click", () => duplicatesState.actions.close()),
          listener(confirmButton, "click", () => void runRemove()),
        );

        queueMicrotask(() => dialog.focus());
      },
      onUnmount() {
        cleanup.run();
      },
    })
  );

  return render /*html*/ `
    <div class="modal-backdrop" role="presentation" data-ref="backdrop">
      <div
        class="modal duplicates-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicates-dialog-title"
        tabindex="-1"
        data-focus-zone="dialog"
        data-ref="dialog"
      >
        <div class="modal__header">
          <div>
            <h3 class="shell-panel__title" id="duplicates-dialog-title">Find duplicates</h3>
            <p class="shell-panel__subtitle" data-ref="subtitle"></p>
          </div>
        </div>
        <div class="modal__body duplicates-dialog__body">
          <div class="duplicates-dialog__list" data-ref="list"></div>
        </div>
        <div class="modal__footer">
          <div class="duplicates-dialog__footer-left">
            <button type="button" class="btn btn-ghost btn-sm" data-ref="keepAllButton">Keep all</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ref="resetButton">Keep first only</button>
          </div>
          <div class="duplicates-dialog__footer-right">
            <button type="button" class="btn btn-ghost btn-sm" data-ref="cancelButton">Cancel</button>
            <button type="button" class="btn btn-primary btn-sm" data-ref="confirmButton">Remove</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/** @returns {Component} */
function createEmptyComponent() {
  return {
    html: "",
    refs: {},
    mount() {},
    unmount() {},
  };
}

/**
 * @param {ParentNode} root
 * @returns {{ cleanup: () => void }}
 */
export function mountDuplicatesDialog(root) {
  const container = /** @type {HTMLElement} */ (
    requireElement(root, "#duplicates-dialog-container", "duplicates-dialog-container")
  );
  const renderShell = /** @type {TemplateTag} */ (template);
  const component = renderShell`
    ${when(
      () => duplicatesState.selectors.isOpen(),
      () => createDuplicatesDialogComponent(),
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
