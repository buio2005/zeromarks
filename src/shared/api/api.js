// @ts-check

import { beginSaving, endSaving } from "../state/save-state.js";
import {
  AddBookmark as HostAddBookmark,
  AddFolder as HostAddFolder,
  ApplyImportMerge as HostApplyImportMerge,
  CreateBookmarkFile as HostCreateBookmarkFile,
  DeleteNode as HostDeleteNode,
  DeleteNodes as HostDeleteNodes,
  FetchFavicon as HostFetchFavicon,
  FetchFaviconsForNodes as HostFetchFaviconsForNodes,
  FetchPageTitle as HostFetchPageTitle,
  FilePath as HostFilePath,
  GetAllFolders as HostGetAllFolders,
  GetFilePath as HostGetFilePath,
  GetFlatIndex as HostGetFlatIndex,
  GetFlatTree as HostGetFlatTree,
  GetFolderChildren as HostGetFolderChildren,
  GetHistoryState as HostGetHistoryState,
  GetRootNodes as HostGetRootNodes,
  GetTreeStats as HostGetTreeStats,
  FindDuplicates as HostFindDuplicates,
  CheckExternalChange as HostCheckExternalChange,
  KeepLocalVersion as HostKeepLocalVersion,
  SortFolder as HostSortFolder,
  CheckLinks as HostCheckLinks,
  LoadBookmarkFile as HostLoadBookmarkFile,
  LoadFile as HostLoadFile,
  MoveNode as HostMoveNode,
  MoveNodes as HostMoveNodes,
  OpenFilePicker as HostOpenFilePicker,
  OpenImportFilePicker as HostOpenImportFilePicker,
  OpenURL as HostOpenURL,
  PreviewImportMerge as HostPreviewImportMerge,
  Redo as HostRedo,
  Undo as HostUndo,
  UpdateBookmark as HostUpdateBookmark,
  UpdateFolderName as HostUpdateFolderName,
} from "./tauri-api-bindings.js";

/**
 * Wrap a mutation promise with save state tracking.
 * Tracks overlapping mutations so the save indicator stays active until
 * the final in-flight operation settles.
 *
 * @template T
 * @param {Promise<T>} promise
 * @returns {Promise<T>}
 */
function wrapMutation(promise) {
  beginSaving();
  return promise.finally(() => {
    endSaving();
  });
}

/**
 * @param {FolderMergeItem | null | undefined} item
 * @returns {FolderMergeItem}
 */
function normalizeFolderMergeItem(item) {
  return {
    path: item?.path ?? "",
    name: item?.name ?? "",
  };
}

/**
 * @param {BookmarkMergeItem | null | undefined} item
 * @returns {BookmarkMergeItem}
 */
function normalizeBookmarkMergeItem(item) {
  return {
    folderPath: item?.folderPath ?? "",
    title: item?.title ?? "",
    url: item?.url ?? "",
  };
}

/**
 * @param {BookmarkConflictItem | null | undefined} item
 * @returns {BookmarkConflictItem}
 */
function normalizeConflictItem(item) {
  return {
    folderPath: item?.folderPath ?? "",
    existingFolderPath: item?.existingFolderPath ?? "",
    existingTitle: item?.existingTitle ?? "",
    incomingTitle: item?.incomingTitle ?? "",
    url: item?.url ?? "",
    existingMeta: item?.existingMeta ?? "",
    incomingMeta: item?.incomingMeta ?? "",
  };
}

/**
 * @param {HistoryState | null | undefined} state
 * @returns {HistoryState}
 */
function normalizeHistoryState(state) {
  return {
    canUndo: state?.canUndo ?? false,
    canRedo: state?.canRedo ?? false,
    undoLabel: state?.undoLabel ?? "",
    redoLabel: state?.redoLabel ?? "",
  };
}

/**
 * @param {NodeDto | null | undefined} node
 * @returns {TreeNode}
 */
function normalizeTreeNode(node) {
  if (node?.type === 0 && node.folder) {
    return {
      id: node.id ?? "",
      type: 0,
      folder: {
        id: node.folder.id ?? "",
        name: node.folder.name ?? "",
        icon: node.folder.icon ?? "",
        addDate: node.folder.addDate ?? "",
        lastModified: node.folder.lastModified ?? "",
        meta: node.folder.meta ?? "",
        children: (node.folder.children ?? []).map(normalizeTreeNode),
        childCount: Array.isArray(node.folder.children) ? node.folder.children.length : 0,
        childrenLoaded: true,
      },
    };
  }

  return {
    id: node?.id ?? "",
    type: 1,
    bookmark: {
      id: node?.bookmark?.id ?? "",
      title: node?.bookmark?.title ?? "",
      url: node?.bookmark?.url ?? "",
      icon: node?.bookmark?.icon ?? "",
      iconURI: node?.bookmark?.iconURI ?? "",
      addDate: node?.bookmark?.addDate ?? "",
      lastModified: node?.bookmark?.lastModified ?? "",
      meta: node?.bookmark?.meta ?? "",
    },
  };
}

export async function GetFilePath() {
  return HostGetFilePath();
}

export async function CreateBookmarkFile() {
  return wrapMutation(HostCreateBookmarkFile());
}

export async function OpenFilePicker() {
  return HostOpenFilePicker();
}

export async function OpenImportFilePicker() {
  return HostOpenImportFilePicker();
}

/**
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function LoadBookmarkFile(path) {
  await HostLoadBookmarkFile(path);
}

/**
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function LoadFile(path) {
  await HostLoadFile(path);
}

/** @returns {Promise<FlatNode[]>} */
export async function GetFlatTree() {
  return /** @type {FlatNode[]} */ (/** @type {unknown} */ (await HostGetFlatTree()));
}

/** @returns {Promise<FlatNode[]>} */
export async function GetRootNodes() {
  return /** @type {FlatNode[]} */ (/** @type {unknown} */ (await HostGetRootNodes()));
}

/**
 * @param {string} folderId
 * @returns {Promise<FlatNode[]>}
 */
export async function GetFolderChildren(folderId) {
  return /** @type {FlatNode[]} */ (/** @type {unknown} */ (await HostGetFolderChildren(folderId)));
}

/** @returns {Promise<BookmarkIndexEntry[]>} */
export async function GetFlatIndex() {
  return HostGetFlatIndex();
}

/** @returns {Promise<TreeNode[]>} */
export async function GetAllFolders() {
  return (await HostGetAllFolders()).map(normalizeTreeNode);
}

/** @returns {Promise<TreeStats>} */
export async function GetTreeStats() {
  return /** @type {TreeStats} */ (/** @type {unknown} */ (await HostGetTreeStats()));
}

/**
 * @param {{ id: string, url: string }[]} targets
 * @returns {Promise<LinkCheckResult[]>}
 */
export async function CheckLinks(targets) {
  /** @type {any[]} */
  const results = (await HostCheckLinks(targets)) ?? [];
  return results.map((result) => ({
    id: result?.id ?? "",
    url: result?.url ?? "",
    status: result?.status ?? "uncertain",
    httpStatus: result?.httpStatus ?? 0,
    finalUrl: result?.finalUrl ?? "",
    message: result?.message ?? "",
  }));
}

/** @returns {Promise<"unchanged" | "changed" | "missing">} */
export async function CheckExternalChange() {
  return HostCheckExternalChange();
}

export async function KeepLocalVersion() {
  await wrapMutation(HostKeepLocalVersion());
}

/** @returns {Promise<DuplicateGroup[]>} */
export async function FindDuplicates() {
  /** @type {any[]} */
  const groups = (await HostFindDuplicates()) ?? [];
  return groups.map((group) => ({
    url: group?.url ?? "",
    items: (group?.items ?? []).map((/** @type {any} */ item) => ({
      id: item?.id ?? "",
      title: item?.title ?? "",
      url: item?.url ?? "",
      folderPath: item?.folderPath ?? "",
      addDate: item?.addDate ?? "",
    })),
  }));
}

/**
 * @param {string} parentFolderId
 * @param {BookmarkCreate} bookmark
 * @returns {Promise<FlatNode>}
 */
export async function AddBookmark(parentFolderId, bookmark) {
  return /** @type {FlatNode} */ (/** @type {unknown} */ (
    await wrapMutation(HostAddBookmark(parentFolderId, {
      title: bookmark.title,
      url: bookmark.url,
      icon: bookmark.icon ?? "",
      iconURI: bookmark.iconURI ?? "",
      meta: bookmark.meta ?? "",
    }))
  ));
}

/**
 * @param {string} parentFolderId
 * @param {string} name
 * @returns {Promise<FlatNode>}
 */
export async function AddFolder(parentFolderId, name) {
  return /** @type {FlatNode} */ (/** @type {unknown} */ (
    await wrapMutation(HostAddFolder(parentFolderId, name))
  ));
}

/**
 * @param {string} id
 * @param {BookmarkPatch} patch
 * @returns {Promise<void>}
 */
export async function UpdateBookmark(id, patch) {
  await wrapMutation(HostUpdateBookmark(id, /** @type {any} */ (patch)));
}

/**
 * @param {string} id
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function UpdateFolderName(id, name) {
  await wrapMutation(HostUpdateFolderName(id, name));
}

/**
 * @param {string} folderId
 * @param {SortOptions} options
 */
export async function SortFolder(folderId, options) {
  await wrapMutation(HostSortFolder(folderId, options));
}

/** @param {string} id */
export async function DeleteNode(id) {
  await wrapMutation(HostDeleteNode(id));
}

/** @param {string[]} ids */
export async function DeleteNodes(ids) {
  await wrapMutation(HostDeleteNodes(ids));
}

/**
 * @param {string} draggedId
 * @param {string} targetFolderId
 * @param {number} index
 * @returns {Promise<MoveResult>}
 */
export async function MoveNode(draggedId, targetFolderId, index) {
  return /** @type {MoveResult} */ (/** @type {unknown} */ (
    await wrapMutation(HostMoveNode(draggedId, targetFolderId, index))
  ));
}

/**
 * @param {string[]} nodeIds
 * @param {string} targetFolderId
 * @returns {Promise<MoveResult>}
 */
export async function MoveNodes(nodeIds, targetFolderId) {
  return /** @type {MoveResult} */ (/** @type {unknown} */ (
    await wrapMutation(HostMoveNodes(nodeIds, targetFolderId))
  ));
}

/** @param {string} url */
export async function FetchPageTitle(url) {
  return wrapMutation(HostFetchPageTitle(url));
}

/** @param {string} url */
export async function FetchFavicon(url) {
  return wrapMutation(HostFetchFavicon(url));
}

/**
 * @param {string[]} ids
 * @returns {Promise<FlatNode[]>}
 */
export async function FetchFaviconsForNodes(ids) {
  return /** @type {FlatNode[]} */ (/** @type {unknown} */ (await wrapMutation(HostFetchFaviconsForNodes(ids))));
}

/** @param {string} url */
export async function OpenURL(url) {
  await HostOpenURL(url);
}

/** @returns {Promise<string>} */
export async function FilePath() {
  return HostFilePath();
}

/**
 * @param {string} path
 * @returns {Promise<MergePreview>}
 */
export async function PreviewImportMerge(path) {
  const preview = await HostPreviewImportMerge(path);
  return {
    foldersToAdd: (preview?.foldersToAdd ?? []).map(normalizeFolderMergeItem),
    bookmarksToAdd: (preview?.bookmarksToAdd ?? []).map(normalizeBookmarkMergeItem),
    duplicateBookmarks: (preview?.duplicateBookmarks ?? []).map(normalizeBookmarkMergeItem),
    potentialUpdates: (preview?.potentialUpdates ?? []).map(normalizeConflictItem),
  };
}

/**
 * @param {string} path
 * @returns {Promise<MergeApplyResult>}
 */
export async function ApplyImportMerge(path) {
  const result = await wrapMutation(HostApplyImportMerge(path));
  return {
    foldersAdded: result?.foldersAdded ?? 0,
    bookmarksAdded: result?.bookmarksAdded ?? 0,
    duplicatesSkipped: result?.duplicatesSkipped ?? 0,
    potentialUpdates: result?.potentialUpdates ?? 0,
    bookmarksUpdated: result?.bookmarksUpdated ?? 0,
  };
}

/** @returns {Promise<HistoryState>} */
export async function GetHistoryState() {
  return normalizeHistoryState(await HostGetHistoryState());
}

/** @returns {Promise<HistoryState>} */
export async function Undo() {
  return normalizeHistoryState(await wrapMutation(HostUndo()));
}

/** @returns {Promise<HistoryState>} */
export async function Redo() {
  return normalizeHistoryState(await wrapMutation(HostRedo()));
}
