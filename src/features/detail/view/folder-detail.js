// @ts-check

import { t, tn } from "../../../shared/i18n/i18n.js";
import { DeleteNode, SortFolder, UpdateFolderName } from "../../../shared/api/api.js";
import { createAddBookmarkForm } from "../../editing/add-bookmark-form.js";
import { createAddFolderForm } from "../../editing/add-folder-form.js";
import { getErrorMessage } from "../../../shared/infra/errors.js";
import {
  cleanupCollector,
  fx,
  hide,
  listener,
  model,
  requireRef,
  signal,
  show,
  template,
} from "../../../shared/runtime/naf.js";
import { moveDialogState } from "../../move/move-dialog-state.js";
import { treeState } from "../../tree/state/tree-state.js";
import { uiState } from "../../../shared/state/ui-state.js";

/**
 * @param {string} value
 * @returns {boolean}
 */
function hasRealDate(value) {
  return Boolean(value) && !String(value).startsWith("0001-01-01");
}

/**
 * @param {FolderNode} folder
 * @returns {Component<HTMLElement>}
 */
export function createFolderDetail(folder) {
  const editing = signal(false);
  const sorting = signal(false);
  const busy = signal(false);
  const currentName = signal(folder.folder.name);
  const nameErrorMessage = signal("");
  const addBookmark = createAddBookmarkForm({
    triggerLabel: "Add Bookmark",
    triggerClassName: "btn btn-ghost btn-sm btn-square detail-action-btn",
    formTitle: "Create bookmark inside selection",
    triggerKeyboardAction: "folder-add-bookmark",
    triggerAriaLabel: "Add bookmark",
    triggerTitle: "Add bookmark",
    triggerIconClassName: "icon-mask detail-action-icon--bookmark detail-action-icon--with-plus",
    getParentFolderId: () => folder.id,
  });
  const addFolder = createAddFolderForm({
    triggerLabel: "Add Folder",
    triggerClassName: "btn btn-ghost btn-sm btn-square detail-action-btn",
    formTitle: "Create folder inside selection",
    triggerKeyboardAction: "folder-add-folder",
    triggerAriaLabel: "Add folder",
    triggerTitle: "Add folder",
    triggerIconClassName: "icon-mask detail-action-icon--folder detail-action-icon--with-plus",
    getParentFolderId: () => folder.id,
  });
  const cleanup = cleanupCollector();

  const renderFolderDetail = /** @type {TemplateTag} */ (
    template({
      root: ".folder-detail",
      onMount(_el, _parent, ctx) {
        const title = /** @type {HTMLElement} */ (requireRef(ctx.refs, "title"));
        const count = /** @type {HTMLElement} */ (requireRef(ctx.refs, "count"));
        const created = /** @type {HTMLElement} */ (requireRef(ctx.refs, "created"));
        const header = /** @type {HTMLElement} */ (requireRef(ctx.refs, "header"));
        const editButton = requireRef(ctx.refs, "editButton");
        const moveButton = requireRef(ctx.refs, "moveButton");
        const sortButton = requireRef(ctx.refs, "sortButton");
        const sortPanel = /** @type {HTMLElement} */ (requireRef(ctx.refs, "sortPanel"));
        const sortMode = /** @type {HTMLSelectElement} */ (requireRef(ctx.refs, "sortMode"));
        const sortFoldersFirst = /** @type {HTMLInputElement} */ (requireRef(ctx.refs, "sortFoldersFirst"));
        const sortRecursive = /** @type {HTMLInputElement} */ (requireRef(ctx.refs, "sortRecursive"));
        const sortApplyButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "sortApplyButton"));
        const sortCancelButton = requireRef(ctx.refs, "sortCancelButton");
        const deleteButton = requireRef(ctx.refs, "deleteButton");
        const editPanel = /** @type {HTMLElement} */ (requireRef(ctx.refs, "editPanel"));
        const nameInput = /** @type {HTMLInputElement} */ (requireRef(ctx.refs, "nameInput"));
        const nameError = /** @type {HTMLElement} */ (requireRef(ctx.refs, "nameError"));
        const saveButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "saveButton"));
        const cancelButton = requireRef(ctx.refs, "cancelButton");

        const nameBinding = model(nameInput, currentName, { reactive: true });

        /**
         * @param {boolean} nextEditing
         * @returns {void}
         */
        function setEditing(nextEditing) {
          editing(nextEditing);
          nameErrorMessage("");
          if (nextEditing) {
            queueMicrotask(() => {
              nameInput.focus();
              nameInput.select();
            });
          }
        }

        async function saveName() {
          if (busy()) {
            return;
          }

          const nextName = currentName().trim();
          if (!nextName) {
            nameErrorMessage("Folder name is required");
            nameInput.focus();
            return;
          }

          if (nextName === folder.folder.name) {
            setEditing(false);
            return;
          }

          nameErrorMessage("");
          busy(true);

          try {
            await UpdateFolderName(folder.id, nextName);
            currentName(nextName);
            await treeState.actions.refresh();
            treeState.actions.selectSingle(folder.id);
            uiState.actions.showToast("Folder renamed", "success");
            setEditing(false);
          } catch (caughtError) {
            nameErrorMessage(getErrorMessage(caughtError, "Failed to rename folder"));
          } finally {
            busy(false);
          }
        }

        function showDeleteConfirm() {
          uiState.actions.showConfirm(
            "Delete Folder",
            t('Delete "{title}" and all of its contents?', { title: currentName() }),
            "Delete",
            async () => {
              try {
                await DeleteNode(folder.id);
                treeState.actions.clearSelection();
                await treeState.actions.refresh();
                uiState.actions.showToast("Folder deleted", "success");
              } catch (caughtError) {
                uiState.actions.showToast(
                  getErrorMessage(caughtError, "Failed to delete folder"),
                  "error",
                );
              }
            },
          );
        }

        /**
         * @param {boolean} nextSorting
         * @returns {void}
         */
        function setSorting(nextSorting) {
          sorting(nextSorting);
          if (nextSorting) {
            setEditing(false);
            queueMicrotask(() => sortMode.focus());
          }
        }

        async function applySort() {
          if (busy()) {
            return;
          }
          busy(true);
          try {
            await SortFolder(folder.id, {
              mode: /** @type {SortMode} */ (sortMode.value),
              foldersFirst: sortFoldersFirst.checked,
              recursive: sortRecursive.checked,
            });
            await treeState.actions.refresh();
            treeState.actions.selectSingle(folder.id);
            setSorting(false);
            uiState.actions.showToast("Folder sorted. Press Ctrl+Z to undo.", "success");
          } catch (caughtError) {
            uiState.actions.showToast(getErrorMessage(caughtError, "Failed to sort folder"), "error");
          } finally {
            busy(false);
          }
        }

        /** @param {KeyboardEvent} event */
        function handleSortKeydown(event) {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setSorting(false);
          } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
            event.preventDefault();
            event.stopPropagation();
            void applySort();
          }
        }

        function showMoveDialog() {
          moveDialogState.actions.showMoveDialog(
            folder.id,
            currentName() || "Untitled folder",
            "folder",
            treeState.selectors.getTree(),
          );
        }

        function handleEditClick() {
          setSorting(false);
          setEditing(true);
        }

        function handleSaveClick() {
          void saveName();
        }

        function handleCancelClick() {
          currentName(folder.folder.name);
          setEditing(false);
        }

        /** @param {KeyboardEvent} event */
        function handleNameKeydown(event) {
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
            return;
          }

          if (
            event.key === "Enter" ||
            ((event.ctrlKey || event.metaKey) && event.key === "Enter")
          ) {
            event.preventDefault();
            void saveName();
          }
        }

        cleanup.add(
          listener(editButton, "click", handleEditClick),
          listener(moveButton, "click", showMoveDialog),
          listener(sortButton, "click", () => setSorting(!sorting())),
          listener(sortApplyButton, "click", () => void applySort()),
          listener(sortCancelButton, "click", () => setSorting(false)),
          listener(sortPanel, "keydown", handleSortKeydown),
          show(sortPanel, sorting),
          fx(sortApplyButton, (currentButton) => {
            currentButton.disabled = busy();
          }),
          listener(deleteButton, "click", showDeleteConfirm),
          listener(saveButton, "click", handleSaveClick),
          listener(cancelButton, "click", handleCancelClick),
          listener(nameInput, "keydown", handleNameKeydown),
          nameBinding.cleanup,
          fx(title, (currentTitleEl) => {
            currentTitleEl.textContent = currentName() || t("Untitled folder");
          }),
          fx(count, (currentCountEl) => {
            // Children load lazily on expand; until then use the backend's count,
            // the same rule the tree row uses.
            const itemCount = folder.folder.childrenLoaded
              ? folder.folder.children.length
              : folder.folder.childCount;
            currentCountEl.textContent = tn(itemCount, "{count} item", "{count} items");
          }),
          fx(created, (currentCreatedEl) => {
            const hasDate = hasRealDate(folder.folder.addDate);
            currentCreatedEl.hidden = !hasDate;
            currentCreatedEl.textContent = hasDate
              ? t("Created: {date}", { date: new Date(folder.folder.addDate).toLocaleDateString() })
              : "";
          }),
          hide(header, editing),
          show(editPanel, editing),
          fx(saveButton, (currentSaveButton) => {
            currentSaveButton.disabled = busy();
          }),
          fx(nameError, (currentNameError) => {
            const message = nameErrorMessage();
            currentNameError.hidden = message.length === 0;
            currentNameError.textContent = t(message);
          }),
        );
      },
      onUnmount() {
        cleanup.run();
      },
    })
  );

  return renderFolderDetail/*html*/`
    <div class="folder-detail">
      <div class="panel folder-detail__header" data-ref="header">
        <div class="folder-detail__top-row">
          <div class="folder-detail__title-block">
            <h3 class="folder-detail__title" data-ref="title"></h3>
            <p class="folder-detail__meta" data-ref="count"></p>
            <p class="folder-detail__meta" data-ref="created"></p>
          </div>
          <div class="detail-inline-actions">
            ${addBookmark}
            ${addFolder}
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square detail-action-btn detail-action-btn--main"
              data-keyboard-action="folder-edit"
              data-ref="editButton"
              aria-label="Edit folder"
              title="Edit folder"
            >
              <span class="icon-mask detail-action-icon--edit" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square detail-action-btn detail-action-btn--main"
              data-keyboard-action="folder-sort"
              data-ref="sortButton"
              aria-label="Sort folder contents"
              title="Sort folder contents"
            >
              <span class="icon-mask detail-action-icon--sort" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square detail-action-btn detail-action-btn--main"
              data-keyboard-action="folder-move"
              data-ref="moveButton"
              aria-label="Move folder"
              title="Move folder"
            >
              <span class="icon-mask detail-action-icon--move" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square detail-action-btn detail-action-btn--main detail-action-btn--danger"
              data-keyboard-action="folder-delete"
              data-ref="deleteButton"
              aria-label="Delete folder"
              title="Delete folder"
            >
              <span class="icon-mask detail-action-icon--delete" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </div>

      <div class="panel folder-detail__sort" hidden data-ref="sortPanel">
        <div class="field">
          <label class="eyebrow label" for="folder-sort-mode-${folder.id}">Sort contents by</label>
          <select id="folder-sort-mode-${folder.id}" class="select" data-ref="sortMode">
            <option value="nameAsc">Name (A → Z)</option>
            <option value="nameDesc">Name (Z → A)</option>
            <option value="dateNewest">Date added (newest first)</option>
            <option value="dateOldest">Date added (oldest first)</option>
            <option value="domain">Website</option>
          </select>
        </div>
        <div class="folder-detail__sort-options">
          <label class="folder-detail__sort-option">
            <input type="checkbox" checked data-ref="sortFoldersFirst" />
            Folders first
          </label>
          <label class="folder-detail__sort-option">
            <input type="checkbox" data-ref="sortRecursive" />
            Include subfolders
          </label>
        </div>
        <div class="detail-inline-actions">
          <button type="button" class="btn btn-primary btn-sm" data-ref="sortApplyButton">Sort</button>
          <button type="button" class="btn btn-ghost btn-sm" data-ref="sortCancelButton">Cancel</button>
        </div>
      </div>

      <div class="panel folder-detail__edit" hidden data-ref="editPanel">
        <div class="field">
          <label class="eyebrow label" for="folder-detail-name-${folder.id}">Folder name</label>
          <input
            id="folder-detail-name-${folder.id}"
            type="text"
            class="input"
            data-keyboard-action="folder-name"
            data-ref="nameInput"
          />
          <p class="error-text" hidden data-ref="nameError"></p>
        </div>
        <div class="detail-inline-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            data-keyboard-action="folder-save"
            data-ref="saveButton"
          >
            Save
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            data-keyboard-action="folder-cancel"
            data-ref="cancelButton"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;
}
