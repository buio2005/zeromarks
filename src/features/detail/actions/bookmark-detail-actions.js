// @ts-check

import { t } from "../../../shared/i18n/i18n.js";

import {
  DeleteNode,
  FetchFavicon,
  OpenURL,
  UpdateBookmark,
} from "../../../shared/api/api.js";
import { getErrorMessage } from "../../../shared/infra/errors.js";
import { moveDialogState } from "../../move/move-dialog-state.js";
import { treeState } from "../../tree/state/tree-state.js";
import { uiState } from "../../../shared/state/ui-state.js";

/**
 * @param {object} options
 * @param {BookmarkNode} options.bookmark
 * @param {() => string} options.getCurrentTitle
 * @param {() => string} options.getCurrentURL
 * @param {() => string} options.getCurrentIcon
 * @param {() => string} options.getCurrentMeta
 * @param {(value: string) => void} options.setCurrentIcon
 * @param {(value: boolean) => void} options.setEditing
 * @param {(value: boolean) => void} options.setFetchingFavicon
 * @param {(message: string) => void} options.setDetailError
 * @param {() => void} options.focusInvalidURL
 * @param {(title: string, icon: string) => void} options.resetMetadataTracking
 * @returns {{
 *   saveBookmark: () => Promise<void>,
 *   fetchFaviconNow: () => Promise<void>,
 *   openInBrowser: () => Promise<void>,
 *   showDeleteConfirm: () => void,
 *   showMoveDialog: () => void
 * }}
 */
export function createBookmarkDetailActions(options) {
  const { bookmark } = options;

  /** @returns {Promise<void>} */
  async function saveBookmark() {
    if (!options.getCurrentURL().trim()) {
      options.setDetailError("URL is required");
      options.focusInvalidURL();
      return;
    }

    try {
      const patch = {
        title: options.getCurrentTitle().trim(),
        url: options.getCurrentURL().trim(),
        icon: options.getCurrentIcon(),
        meta: options.getCurrentMeta().trim(),
      };
      await UpdateBookmark(bookmark.id, {
        title: patch.title,
        url: patch.url,
        icon: patch.icon,
        meta: patch.meta,
      });
      if (!treeState.actions.patchBookmark(bookmark.id, patch)) {
        await treeState.actions.refresh();
      }
      options.resetMetadataTracking(options.getCurrentTitle(), options.getCurrentIcon());
      options.setEditing(false);
      treeState.actions.selectSingle(bookmark.id);
      uiState.actions.showToast("Bookmark updated", "success");
    } catch (caughtError) {
      options.setDetailError(getErrorMessage(caughtError, "Failed to update bookmark"));
    }
  }

  /** @returns {Promise<void>} */
  async function fetchFaviconNow() {
    if (!options.getCurrentURL().trim()) {
      return;
    }

    options.setFetchingFavicon(true);
    options.setDetailError("");
    try {
      const dataUri = await FetchFavicon(options.getCurrentURL().trim());
      if (dataUri) {
        options.setCurrentIcon(dataUri);
        options.resetMetadataTracking(options.getCurrentTitle(), dataUri);
        await UpdateBookmark(bookmark.id, { icon: dataUri });
        if (!treeState.actions.patchBookmark(bookmark.id, { icon: dataUri })) {
          await treeState.actions.refresh();
        }
        treeState.actions.selectSingle(bookmark.id);
        uiState.actions.showToast("Favicon fetched", "success");
      }
    } catch (caughtError) {
      const message = getErrorMessage(caughtError, "Failed to fetch favicon");
      options.setDetailError(message);
      uiState.actions.showToast(message, "error");
    } finally {
      options.setFetchingFavicon(false);
    }
  }

  /** @returns {Promise<void>} */
  async function openInBrowser() {
    try {
      await OpenURL(bookmark.bookmark.url);
    } catch (caughtError) {
      uiState.actions.showToast(`Failed to open URL: ${getErrorMessage(caughtError)}`, "error");
    }
  }

  /** @returns {void} */
  function showDeleteConfirm() {
    uiState.actions.showConfirm(
      "Delete Bookmark",
      t('Delete "{title}"?', { title: bookmark.bookmark.title }),
      "Delete",
      async () => {
        try {
          await DeleteNode(bookmark.id);
          treeState.actions.clearSelection();
          await treeState.actions.refresh();
          uiState.actions.showToast("Bookmark deleted", "success");
        } catch (caughtError) {
          uiState.actions.showToast(
            getErrorMessage(caughtError, "Failed to delete bookmark"),
            "error",
          );
        }
      },
    );
  }

  /** @returns {void} */
  function showMoveDialog() {
    moveDialogState.actions.showMoveDialog(
      bookmark.id,
      bookmark.bookmark.title || bookmark.bookmark.url,
      "bookmark",
      treeState.selectors.getTree(),
    );
  }

  return {
    saveBookmark,
    fetchFaviconNow,
    openInBrowser,
    showDeleteConfirm,
    showMoveDialog,
  };
}
