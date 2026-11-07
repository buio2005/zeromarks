// @ts-check

import { t } from "../../../shared/i18n/i18n.js";
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
import { createBookmarkDetailActions } from "../actions/bookmark-detail-actions.js";
import { createBookmarkMetadataWorkflow } from "../actions/bookmark-detail-metadata.js";

/**
 * @param {string} value
 * @returns {boolean}
 */
function hasRealDate(value) {
  return Boolean(value) && !String(value).startsWith("0001-01-01");
}

/**
 * @param {BookmarkNode} bookmark
 * @returns {Component<HTMLElement>}
 */
export function createBookmarkDetail(bookmark) {
  const editing = signal(false);
  const fetchingTitle = signal(false);
  const fetchingFavicon = signal(false);
  const currentTitle = signal(bookmark.bookmark.title || "");
  const currentURL = signal(bookmark.bookmark.url || "");
  const currentIcon = signal(bookmark.bookmark.icon || "");
  const currentMeta = signal(bookmark.bookmark.meta || "");
  const detailError = signal("");
  const cleanup = cleanupCollector();

  const renderBookmarkDetail = /** @type {TemplateTag} */ (
    template({
      root: ".bookmark-detail",
      onMount(_el, _parent, ctx) {
        const titleHeading = /** @type {HTMLHeadingElement} */ (requireRef(ctx.refs, "titleHeading"));
        const titleInput = /** @type {HTMLInputElement} */ (requireRef(ctx.refs, "titleInput"));
        const editButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "editButton"));
        const moveButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "moveButton"));
        const deleteButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "deleteButton"));
        const saveButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "saveButton"));
        const cancelButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "cancelButton"));
        const urlLink = /** @type {HTMLAnchorElement} */ (requireRef(ctx.refs, "urlLink"));
        const urlInputWrap = /** @type {HTMLElement} */ (requireRef(ctx.refs, "urlInputWrap"));
        const urlInput = /** @type {HTMLInputElement} */ (requireRef(ctx.refs, "urlInput"));
        const titleLoading = /** @type {HTMLElement} */ (requireRef(ctx.refs, "titleLoading"));
        const actionRow = /** @type {HTMLElement} */ (requireRef(ctx.refs, "actionRow"));
        const openButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "openButton"));
        const faviconButton = /** @type {HTMLButtonElement} */ (requireRef(ctx.refs, "faviconButton"));
        const detailsError = /** @type {HTMLElement} */ (requireRef(ctx.refs, "detailsError"));
        const iconImage = /** @type {HTMLImageElement} */ (requireRef(ctx.refs, "iconImage"));
        const fallbackIcon = /** @type {HTMLElement} */ (requireRef(ctx.refs, "fallbackIcon"));
        const addedDate = /** @type {HTMLElement} */ (requireRef(ctx.refs, "addedDate"));
        const modifiedDate = /** @type {HTMLElement} */ (requireRef(ctx.refs, "modifiedDate"));
        const notesText = /** @type {HTMLElement} */ (requireRef(ctx.refs, "notesText"));
        const notesEmpty = /** @type {HTMLElement} */ (requireRef(ctx.refs, "notesEmpty"));
        const notesInput = /** @type {HTMLTextAreaElement} */ (requireRef(ctx.refs, "notesInput"));

        const titleBinding = model(titleInput, currentTitle, { reactive: true });
        const urlBinding = model(urlInput, currentURL, { reactive: true });
        const metaBinding = model(notesInput, currentMeta, { reactive: true });
        const metadata = createBookmarkMetadataWorkflow({
          isEditing: () => editing(),
          getCurrentURL: () => currentURL(),
          getCurrentTitle: () => currentTitle(),
          getCurrentIcon: () => currentIcon(),
          setCurrentTitle: (value) => currentTitle(value),
          setCurrentIcon: (value) => currentIcon(value),
          setFetchingTitle: (value) => fetchingTitle(value),
          setDetailError: (message) => detailError(message),
        });

        function resetFromBookmark() {
          currentTitle(bookmark.bookmark.title || "");
          currentURL(bookmark.bookmark.url || "");
          currentIcon(bookmark.bookmark.icon || "");
          currentMeta(bookmark.bookmark.meta || "");
          metadata.resetTracking(currentTitle(), currentIcon());
          detailError("");
        }

        /**
         * @param {boolean} nextEditing
         * @returns {void}
         */
        function setEditing(nextEditing) {
          editing(nextEditing);
          if (!nextEditing) {
            metadata.cancelOutstandingFetches();
            resetFromBookmark();
          }
          if (nextEditing) {
            queueMicrotask(() => {
              titleInput.focus();
              titleInput.select();
            });
          }
        }

        metadata.resetTracking(currentTitle(), currentIcon());
        const actions = createBookmarkDetailActions({
          bookmark,
          getCurrentTitle: () => currentTitle(),
          getCurrentURL: () => currentURL(),
          getCurrentIcon: () => currentIcon(),
          getCurrentMeta: () => currentMeta(),
          setCurrentIcon: (value) => currentIcon(value),
          setEditing,
          setFetchingFavicon: (value) => fetchingFavicon(value),
          setDetailError: (message) => detailError(message),
          focusInvalidURL() {
            urlInput.focus();
          },
          resetMetadataTracking: metadata.resetTracking,
        });

        /** @param {KeyboardEvent} event */
        function handleEditKeydown(event) {
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
            return;
          }

          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void actions.saveBookmark();
          }
        }

        function handleTitleInput() {
          detailError("");
        }

        function handleURLInput() {
          detailError("");
          metadata.scheduleMetadataFetch();
        }

        function handleMetaInput() {
          detailError("");
        }

        /** @param {MouseEvent} event */
        function handleOpenLinkClick(event) {
          event.preventDefault();
          void actions.openInBrowser();
        }

        function handleEditClick() {
          setEditing(true);
        }

        function handleCancelClick() {
          setEditing(false);
        }

        function handleSaveClick() {
          void actions.saveBookmark();
        }

        function handleFetchFaviconClick() {
          void actions.fetchFaviconNow();
        }

        function handleOpenClick() {
          void actions.openInBrowser();
        }

        cleanup.add(
          listener(editButton, "click", handleEditClick),
          listener(moveButton, "click", actions.showMoveDialog),
          listener(deleteButton, "click", actions.showDeleteConfirm),
          listener(saveButton, "click", handleSaveClick),
          listener(cancelButton, "click", handleCancelClick),
          listener(openButton, "click", handleOpenClick),
          listener(faviconButton, "click", handleFetchFaviconClick),
          listener(urlLink, "click", handleOpenLinkClick),
          listener(titleInput, "keydown", handleEditKeydown),
          listener(urlInput, "keydown", handleEditKeydown),
          listener(notesInput, "keydown", handleEditKeydown),
          listener(titleInput, "input", handleTitleInput),
          listener(urlInput, "input", handleURLInput),
          listener(notesInput, "input", handleMetaInput),
        );

        cleanup.add(
          titleBinding.cleanup,
          urlBinding.cleanup,
          metaBinding.cleanup,
          fx(titleHeading, (currentTitleHeading) => {
            currentTitleHeading.hidden = editing();
            currentTitleHeading.textContent = bookmark.bookmark.title || "(Untitled)";
          }),
          show(titleInput, editing),
          fx(urlLink, (currentURLLink) => {
            currentURLLink.hidden = editing();
            currentURLLink.textContent = bookmark.bookmark.url || t("No URL set");
          }),
          show(urlInputWrap, editing),
          fx(saveButton, (currentSaveButton) => {
            currentSaveButton.hidden = !editing();
            currentSaveButton.disabled = fetchingFavicon();
          }),
          show(cancelButton, editing),
          hide(editButton, editing),
          hide(moveButton, editing),
          hide(deleteButton, editing),
          hide(actionRow, editing),
          fx(openButton, (currentOpenButton) => {
            currentOpenButton.disabled = !bookmark.bookmark.url;
          }),
          fx(faviconButton, (currentFaviconButton) => {
            const active = fetchingFavicon();
            currentFaviconButton.disabled = active || !currentURL().trim();
            currentFaviconButton.textContent = t(active ? "Fetching..." : "Fetch Favicon");
          }),
          fx(titleLoading, (currentTitleLoading) => {
            const active = fetchingTitle();
            currentTitleLoading.hidden = !active;
            currentTitleLoading.setAttribute("aria-hidden", active ? "false" : "true");
          }),
          fx(iconImage, (currentIconImage) => {
            const displayIcon = currentIcon();
            if (displayIcon) {
              currentIconImage.hidden = false;
              currentIconImage.src = displayIcon;
            } else {
              currentIconImage.hidden = true;
              currentIconImage.removeAttribute("src");
            }
          }),
          hide(fallbackIcon, currentIcon),
          fx(addedDate, (currentAddedDate) => {
            const hasDate = hasRealDate(bookmark.bookmark.addDate);
            currentAddedDate.hidden = !hasDate;
            currentAddedDate.textContent = hasDate
              ? t("Added: {date}", { date: new Date(bookmark.bookmark.addDate).toLocaleString() })
              : "";
          }),
          fx(modifiedDate, (currentModifiedDate) => {
            const hasDate = hasRealDate(bookmark.bookmark.lastModified);
            currentModifiedDate.hidden = !hasDate;
            currentModifiedDate.textContent = hasDate
              ? t("Modified: {date}", { date: new Date(bookmark.bookmark.lastModified).toLocaleString() })
              : "";
          }),
          show(notesInput, editing),
          fx(notesText, (currentNotesText) => {
            const nextMeta = currentMeta();
            currentNotesText.hidden = editing() || !nextMeta.trim();
            currentNotesText.textContent = nextMeta;
          }),
          fx(notesEmpty, (currentNotesEmpty) => {
            currentNotesEmpty.hidden = editing() || Boolean(currentMeta().trim());
          }),
          fx(detailsError, (currentDetailsError) => {
            const message = detailError();
            currentDetailsError.hidden = message.length === 0;
            currentDetailsError.textContent = t(message);
          }),
          () => metadata.clearScheduledFetch(),
          () => metadata.cancelOutstandingFetches(),
        );
      },
      onUnmount() {
        cleanup.run();
      },
    })
  );

  return renderBookmarkDetail/*html*/`
    <div class="bookmark-detail">
      <div class="panel bookmark-detail__header">
        <div class="bookmark-detail__top-row">
          <div class="bookmark-detail__identity">
            <img class="bookmark-detail__icon-image" alt="" hidden data-ref="iconImage" />
            <div class="bookmark-detail__icon-fallback" data-ref="fallbackIcon">
              <span
                class="icon-mask detail-action-icon--bookmark bookmark-detail__icon-fallback-icon"
                aria-hidden="true"
              ></span>
            </div>
            <div class="bookmark-detail__title-block">
              <h3 class="bookmark-detail__title" data-ref="titleHeading"></h3>
              <input
                type="text"
                class="input"
                hidden
                placeholder="Title"
                data-keyboard-action="bookmark-title"
                data-ref="titleInput"
              />
            </div>
          </div>
          <div class="detail-inline-actions">
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square detail-action-btn detail-action-btn--main"
              data-keyboard-action="bookmark-edit"
              data-ref="editButton"
              aria-label="Edit bookmark"
              title="Edit bookmark"
            >
              <span class="icon-mask detail-action-icon--edit" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square detail-action-btn detail-action-btn--main"
              data-keyboard-action="bookmark-move"
              data-ref="moveButton"
              aria-label="Move bookmark"
              title="Move bookmark"
            >
              <span class="icon-mask detail-action-icon--move" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square detail-action-btn detail-action-btn--main detail-action-btn--danger"
              data-keyboard-action="bookmark-delete"
              data-ref="deleteButton"
              aria-label="Delete bookmark"
              title="Delete bookmark"
            >
              <span class="icon-mask detail-action-icon--delete" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              hidden
              data-keyboard-action="bookmark-save"
              data-ref="saveButton"
            >
              Save
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              hidden
              data-keyboard-action="bookmark-cancel"
              data-ref="cancelButton"
            >
              Cancel
            </button>
          </div>
        </div>
        <div class="bookmark-detail__url-row">
          <a href="#" class="bookmark-detail__url-link" data-ref="urlLink"></a>
          <div class="bookmark-detail__url-input-wrap" hidden data-ref="urlInputWrap">
            <input
              type="url"
              class="input"
              placeholder="https://example.com"
              data-keyboard-action="bookmark-url"
              data-ref="urlInput"
            />
            <span
              class="spinner spinner-sm bookmark-detail__spinner"
              hidden
              aria-hidden="true"
              data-ref="titleLoading"
            ></span>
          </div>
        </div>
        <div class="detail-inline-actions" data-ref="actionRow">
          <button
            type="button"
            class="btn btn-outline btn-primary btn-sm"
            data-keyboard-action="bookmark-open"
            data-ref="openButton"
          >
            Open
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            data-keyboard-action="bookmark-fetch-favicon"
            data-ref="faviconButton"
          >
            Fetch Favicon
          </button>
        </div>
        <p class="error-text" hidden data-ref="detailsError"></p>
        <div class="bookmark-detail__dates">
          <p data-ref="addedDate"></p>
          <p data-ref="modifiedDate"></p>
        </div>
      </div>
      <div class="panel bookmark-detail__notes">
        <label class="eyebrow label" for="bookmark-notes-${bookmark.id}">Notes</label>
        <p class="bookmark-detail__notes-text" data-ref="notesText"></p>
        <p class="bookmark-detail__notes-empty" data-ref="notesEmpty">No notes</p>
        <textarea
          id="bookmark-notes-${bookmark.id}"
          class="textarea"
          hidden
          placeholder="Add notes..."
          data-keyboard-action="bookmark-meta"
          data-ref="notesInput"
        ></textarea>
      </div>
    </div>
  `;
}
