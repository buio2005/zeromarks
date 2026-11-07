// @ts-check

import { t } from "../../shared/i18n/i18n.js";
import { MoveNode, MoveNodes } from "../../shared/api/api.js";
import { getErrorMessage } from "../../shared/infra/errors.js";
import { trapFocusInContainer } from "../../shared/infra/focus.js";
import {
  attr,
  cleanupCollector,
  collectRowRefs,
  effect,
  list,
  listener,
  mount,
  requireElement,
  requireRef,
  template,
  when,
} from "../../shared/runtime/naf.js";
import { moveDialogState } from "./move-dialog-state.js";
import { treeState } from "../tree/state/tree-state.js";
import { uiState } from "../../shared/state/ui-state.js";

/** @type {string} */
const MOVE_FOLDER_ROW_HTML = /*html*/ `
  <article class="move-dialog__tree-node">
    <div class="move-dialog__tree-row tree-row menu-item" role="treeitem" tabindex="-1" aria-selected="false" data-ref="row">
      <button
        type="button"
        class="tree-row__toggle btn btn-ghost btn-sm btn-square"
        aria-label="Toggle folder"
        data-ref="toggle"
      ></button>
      <span class="tree-row__folder-icon icon-mask" data-ref="folderIcon" aria-hidden="true"></span>
      <span class="move-dialog__tree-label" data-ref="name"></span>
      <span class="move-dialog__tree-path" data-ref="path"></span>
    </div>
  </article>
`;

/**
 * @param {MoveTarget[]} folders
 * @param {string} selectedTarget
 * @returns {void}
 */
function ensureSelectedTarget(folders, selectedTarget) {
  if (selectedTarget && folders.some((folder) => folder.id === selectedTarget)) {
    return;
  }
  if (folders[0]) {
    moveDialogState.actions.setSelectedTarget(folders[0].id);
  }
}

async function move() {
  const request = moveDialogState.selectors.getRequest();
  const targetId = moveDialogState.selectors.getSelectedTarget();
  if (!request || !targetId) {
    return;
  }

  try {
    /** @type {MoveResult} */
    let result;
    if (request.nodeIds.length === 1) {
      result = await MoveNode(request.nodeIds[0], targetId, -1);
    } else {
      result = await MoveNodes(request.nodeIds, targetId);
    }
    if (!await treeState.actions.applyMoveResult(result)) {
      await treeState.actions.refresh();
    }
    uiState.actions.showToast("Moved successfully", "success");
  } catch (caughtError) {
    uiState.actions.showToast(
      `Move failed: ${getErrorMessage(caughtError)}`,
      "error",
    );
  }

  moveDialogState.actions.closeMoveDialog();
}

/**
 * @param {{
 *   label: string,
 * }} view
 * @param {(mounted: {
 *   backdrop: HTMLDivElement,
 *   dialog: HTMLDivElement,
 *   title: HTMLElement,
 *   listbox: HTMLDivElement,
 *   emptyState: HTMLDivElement,
 *   filterInput: HTMLInputElement,
 *   cancelButton: HTMLButtonElement,
 *   confirmButton: HTMLButtonElement,
 * }) => void} onMountElements
 * @returns {Component<HTMLElement>}
 */
function createMoveDialog(view, onMountElements) {
  const renderDialog =
    /** @type {TemplateTag} */ (
      template({
        onMount(_el, _parent, ctx) {
          const backdrop = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "backdrop"));
          const dialog = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "dialog"));
          const title = /** @type {HTMLElement} */ (requireRef(ctx.refs, "title"));
          const listbox = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "listbox"));
          const emptyState = /** @type {HTMLDivElement} */ (requireRef(ctx.refs, "emptyState"));
          const filterInput = /** @type {HTMLInputElement} */ (requireRef(ctx.refs, "filterInput"));
          const cancelButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "cancelButton"));
          const confirmButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "confirmButton"));

          title.textContent = t('Move "{label}"', { label: view.label });

          onMountElements({
            backdrop,
            dialog,
            title,
            listbox,
            emptyState,
            filterInput,
            cancelButton,
            confirmButton,
          });
        },
      })
    );

  return renderDialog /*html*/ `
    <div class="modal-backdrop" role="presentation" data-ref="backdrop">
      <div
        class="modal move-dialog"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        data-focus-zone="dialog"
        data-ref="dialog"
      >
        <div class="modal__header move-dialog__header">
          <div>
            <h3 class="shell-panel__title" data-ref="title"></h3>
            <p class="shell-panel__subtitle">Select a target folder</p>
          </div>
        </div>
        <div class="modal__body">
          <div class="move-dialog__list-shell">
            <div class="eyebrow move-dialog__list-header">Folder Tree</div>
            <div class="move-dialog__filter-shell">
              <input
                type="text"
                class="input input-sm move-dialog__filter-input"
                placeholder="Filter folders..."
                data-ref="filterInput"
                data-keyboard-action="move-filter"
              />
            </div>
            <div
              class="move-dialog__listbox"
              role="tree"
              aria-label="Target folder"
              data-ref="listbox"
            ></div>
            <div class="move-dialog__empty" data-ref="emptyState" hidden>No matching folders</div>
          </div>
        </div>
        <div class="modal__footer">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            data-keyboard-action="move-cancel"
            data-ref="cancelButton"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            data-keyboard-action="move-confirm"
            data-ref="confirmButton"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * @param {string} folderId
 * @returns {Promise<void>}
 */
async function ensureFolderChildrenLoaded(folderId) {
  const node = treeState.selectors.getNode(folderId);
  if (!node || node.type !== 0 || node.folder.childrenLoaded) {
    return;
  }
  if (moveDialogState.selectors.isFolderLoading(folderId)) {
    return;
  }
  moveDialogState.actions.setFolderLoading(folderId, true);
  try {
    await treeState.actions.loadFolderChildren(folderId);
    moveDialogState.actions.setTreeNodes(treeState.selectors.getTree());
  } catch (caughtError) {
    uiState.actions.showToast(
      `Failed to load folder children: ${getErrorMessage(caughtError)}`,
      "error",
    );
  } finally {
    moveDialogState.actions.setFolderLoading(folderId, false);
  }
}

/**
 * @param {ParentNode} root
 * @returns {{ cleanup: () => void }}
 */
export function mountMoveDialog(root) {
  const container = /** @type {HTMLElement} */ (requireElement(root, "#move-dialog-container", "move-dialog-container"));
  const renderShell = /** @type {TemplateTag} */ (template);

  const component = renderShell`
    ${when(
      () => moveDialogState.selectors.isOpen(),
      () => createMoveDialogComponent(),
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

/** @returns {Component} */
function createMoveDialogComponent() {
  const request = moveDialogState.selectors.getRequest();

  /** @type {{
   *   backdrop: HTMLDivElement,
   *   dialog: HTMLDivElement,
   *   title: HTMLElement,
   *   listbox: HTMLDivElement,
   *   emptyState: HTMLDivElement,
   *   filterInput: HTMLInputElement,
   *   cancelButton: HTMLButtonElement,
   *   confirmButton: HTMLButtonElement,
   * } | undefined} */
  let mounted;

  const component = createMoveDialog(
    { label: request?.label ?? "" },
    (elements) => {
      mounted = elements;
    },
  );

  if (!mounted) {
    // Mounted is set during template onMount; we set up the mount handler below.
  }

  /** @type {Component} */
  const wrapper = {
    html: '',
    refs: {},
    mount(parent) {
      mount(component, parent);

      if (!mounted) {
        throw new Error("Expected move dialog elements after mount");
      }

      const {
        backdrop,
        dialog,
        title,
        listbox,
        emptyState,
        filterInput,
        cancelButton,
        confirmButton,
      } = mounted;

      const cleanup = cleanupCollector();
      let filterTimer = /** @type {number | null} */ (null);

      title.textContent = t('Move "{label}"', { label: request?.label ?? "" });
      filterInput.value = "";

      cleanup.add(
        attr(confirmButton, "disabled", () => !moveDialogState.selectors.getSelectedTarget()),
        effect(() => {
          const folders = moveDialogState.selectors.getVisibleFolders();
          ensureSelectedTarget(folders, moveDialogState.selectors.getSelectedTarget());
          emptyState.hidden = folders.length > 0;
        }),
        list(
          listbox,
          MOVE_FOLDER_ROW_HTML,
          () => moveDialogState.selectors.getVisibleFolders(),
          (folder) => folder.id,
          (el, folder) => {
            if (!(el instanceof HTMLElement)) {
              throw new Error("Move folder template must render an element");
            }

            const refs = collectRowRefs(el);
            const row = /** @type {HTMLElement} */ (refs.row);
            const toggle = /** @type {HTMLButtonElement} */ (refs.toggle);
            const folderIcon = /** @type {HTMLElement} */ (refs.folderIcon);
            const name = /** @type {HTMLElement} */ (refs.name);
            const path = /** @type {HTMLElement} */ (refs.path);

            const handleRowClick = () => {
              moveDialogState.actions.setSelectedTarget(folder().id);
            };
            /** @param {MouseEvent} event */
            const handleToggleClick = (event) => {
              event.stopPropagation();
              const current = folder();
              if (!current.hasChildren) {
                return;
              }
              const expanded = moveDialogState.selectors.isExpanded(current.id);
              if (expanded) {
                moveDialogState.actions.toggleExpanded(current.id);
                return;
              }
              void (async () => {
                await ensureFolderChildrenLoaded(current.id);
                moveDialogState.actions.toggleExpanded(current.id);
              })();
            };

            const stopRowEffect = effect(() => {
              const currentFolder = folder();
              const selected = moveDialogState.selectors.getSelectedTarget() === currentFolder.id;

              row.dataset.folderId = currentFolder.id;
              row.style.paddingLeft = `${currentFolder.depth * 16 + 8}px`;
              row.setAttribute("aria-selected", selected ? "true" : "false");
              row.setAttribute("aria-expanded", String(Boolean(currentFolder.expanded)));
              row.classList.toggle("is-selected", selected);
              row.classList.toggle("is-primary", selected);

              const loadingChildren = moveDialogState.selectors.isFolderLoading(currentFolder.id);
              toggle.hidden = !currentFolder.hasChildren;
              toggle.setAttribute("aria-hidden", currentFolder.hasChildren ? "false" : "true");
              toggle.disabled = loadingChildren;
              toggle.textContent = loadingChildren ? "…" : "";
              toggle.classList.toggle("is-loading", loadingChildren);
              toggle.classList.toggle("is-expanded", Boolean(currentFolder.expanded));

              folderIcon.classList.toggle("is-open", Boolean(currentFolder.expanded));

              name.textContent = currentFolder.name;
              name.title = currentFolder.name;
              path.textContent = currentFolder.pathLabel;
              path.title = currentFolder.pathLabel;
            });

            const rowCleanup = cleanupCollector(
              listener(row, "click", handleRowClick),
              listener(toggle, "click", handleToggleClick),
              stopRowEffect,
            );

            return rowCleanup.run;
          },
          { virtual: { rowHeight: 32 } },
        ),
      );

      const handleBackdropClick = () => {
        moveDialogState.actions.closeMoveDialog();
      };
      /** @param {MouseEvent} event */
      const handleDialogClick = (event) => {
        event.stopPropagation();
      };
      const handleCancelClick = () => {
        moveDialogState.actions.closeMoveDialog();
      };
      const handleConfirmClick = () => {
        void move();
      };

      /** @param {Event} event */
      const handleFilterInput = (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }
        const nextValue = target.value;
        if (filterTimer !== null) {
          window.clearTimeout(filterTimer);
        }
        filterTimer = window.setTimeout(() => {
          moveDialogState.actions.setFilterQuery(nextValue);
        }, 90);
      };

      /** @param {KeyboardEvent} event */
      const handleDialogKeydown = (event) => {
        if (trapFocusInContainer(event, dialog)) {
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          moveDialogState.actions.closeMoveDialog();
          return;
        }

        const visibleFolders = moveDialogState.selectors.getVisibleFolders();
        if (visibleFolders.length === 0) {
          return;
        }

        const currentIndex = visibleFolders.findIndex(
          (folder) => folder.id === moveDialogState.selectors.getSelectedTarget(),
        );
        const selected = currentIndex >= 0 ? visibleFolders[currentIndex] : null;

        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          const nextIndex = Math.min(
            Math.max((currentIndex >= 0 ? currentIndex : 0) + delta, 0),
            visibleFolders.length - 1,
          );
          const nextTarget = visibleFolders[nextIndex];
          if (nextTarget) {
            moveDialogState.actions.setSelectedTarget(nextTarget.id);
            const selectedEl = listbox.querySelector(`[data-folder-id="${nextTarget.id}"]`);
            if (selectedEl instanceof HTMLElement) {
              selectedEl.focus();
            }
          }
          return;
        }

        if (event.key === "ArrowRight" && selected?.hasChildren && !selected.expanded) {
          event.preventDefault();
          void (async () => {
            await ensureFolderChildrenLoaded(selected.id);
            moveDialogState.actions.toggleExpanded(selected.id);
          })();
          return;
        }

        if (event.key === "ArrowLeft" && selected?.hasChildren && selected.expanded) {
          event.preventDefault();
          moveDialogState.actions.toggleExpanded(selected.id);
          return;
        }

        if (event.key === "Enter" && moveDialogState.selectors.getSelectedTarget()) {
          event.preventDefault();
          void move();
        }
      };

      cleanup.add(
        listener(backdrop, "click", handleBackdropClick),
        listener(dialog, "click", handleDialogClick),
        listener(dialog, "keydown", handleDialogKeydown),
        listener(filterInput, "input", handleFilterInput),
        listener(cancelButton, "click", handleCancelClick),
        listener(confirmButton, "click", handleConfirmClick),
        () => {
          if (filterTimer !== null) {
            window.clearTimeout(filterTimer);
          }
        },
      );

      queueMicrotask(() => {
        const selectedEl = listbox.querySelector(
          `[data-folder-id="${moveDialogState.selectors.getSelectedTarget()}"]`,
        );
        if (selectedEl instanceof HTMLElement) {
          selectedEl.focus();
          return;
        }
        filterInput.focus();
      });
    },
    unmount() {
      component.unmount?.();
    },
  };

  return wrapper;
}
