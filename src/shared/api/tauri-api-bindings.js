// @ts-check

/**
 * @param {string} command
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<any>}
 */
async function invoke(command, args = {}) {
  return window.__TAURI__.core.invoke(command, args);
}

export async function GetFilePath() {
  return invoke("get_file_path");
}

export async function CreateBookmarkFile() {
  return invoke("create_bookmark_file");
}

export async function OpenFilePicker() {
  return invoke("open_file_picker");
}

export async function OpenImportFilePicker() {
  return invoke("open_import_file_picker");
}

/**
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function LoadBookmarkFile(path) {
  await invoke("load_bookmark_file", { path });
}

/**
 * @param {string} path
 * @returns {Promise<void>}
 */
export async function LoadFile(path) {
  await invoke("load_file", { path });
}

export async function GetFlatTree() {
  return invoke("get_flat_tree");
}

export async function GetRootNodes() {
  return invoke("get_root_nodes");
}

/**
 * @param {string} folderId
 */
export async function GetFolderChildren(folderId) {
  return invoke("get_folder_children", { folderId });
}

export async function GetFlatIndex() {
  return invoke("get_flat_index");
}

export async function GetAllFolders() {
  return invoke("get_all_folders");
}

export async function GetTreeStats() {
  return invoke("get_tree_stats");
}

/**
 * @param {string} folderId
 * @param {{ mode: string, foldersFirst: boolean, recursive: boolean }} options
 */
export async function SortFolder(folderId, options) {
  await invoke("sort_folder", { folderId, options });
}

/** @returns {Promise<"unchanged" | "changed" | "missing">} */
export async function CheckExternalChange() {
  return invoke("check_external_change");
}

export async function KeepLocalVersion() {
  await invoke("keep_local_version");
}

export async function FindDuplicates() {
  return invoke("find_duplicates");
}

/**
 * @param {{ id: string, url: string }[]} targets
 */
export async function CheckLinks(targets) {
  return invoke("check_links", { targets });
}

/**
 * @param {string} parentID
 * @param {BookmarkCreate} bm
 */
export async function AddBookmark(parentID, bm) {
  return invoke("add_bookmark", { parentId: parentID, bm });
}

/**
 * @param {string} parentID
 * @param {string} name
 */
export async function AddFolder(parentID, name) {
  return invoke("add_folder", { parentId: parentID, name });
}

/**
 * @param {string} id
 * @param {BookmarkPatch} patch
 */
export async function UpdateBookmark(id, patch) {
  await invoke("update_bookmark", { id, patch });
}

/**
 * @param {string} id
 * @param {string} name
 */
export async function UpdateFolderName(id, name) {
  await invoke("update_folder_name", { id, name });
}

/**
 * @param {string} id
 */
export async function DeleteNode(id) {
  await invoke("delete_node", { id });
}

/**
 * @param {string[]} ids
 */
export async function DeleteNodes(ids) {
  await invoke("delete_nodes", { ids });
}

/**
 * @param {string} nodeID
 * @param {string} newParentID
 * @param {number} newIndex
 */
export async function MoveNode(nodeID, newParentID, newIndex) {
  return invoke("move_node", { nodeId: nodeID, newParentId: newParentID, newIndex });
}

/**
 * @param {string[]} nodeIDs
 * @param {string} targetFolderID
 */
export async function MoveNodes(nodeIDs, targetFolderID) {
  return invoke("move_nodes", { nodeIds: nodeIDs, targetFolderId: targetFolderID });
}

/**
 * @param {string} path
 */
export async function PreviewImportMerge(path) {
  return invoke("preview_import_merge", { path });
}

/**
 * @param {string} path
 */
export async function ApplyImportMerge(path) {
  return invoke("apply_import_merge", { path });
}

/**
 * @param {string} pageURL
 */
export async function FetchPageTitle(pageURL) {
  return invoke("fetch_page_title", { pageUrl: pageURL });
}

/**
 * @param {string} pageURL
 */
export async function FetchFavicon(pageURL) {
  return invoke("fetch_favicon", { pageUrl: pageURL });
}

/**
 * @param {string[]} ids
 */
export async function FetchFaviconsForNodes(ids) {
  return invoke("fetch_favicons_for_nodes", { ids });
}

/**
 * @param {string} pageURL
 */
export async function OpenURL(pageURL) {
  await invoke("open_url", { pageUrl: pageURL });
}

export async function FilePath() {
  return invoke("file_path");
}

export async function GetHistoryState() {
  return invoke("get_history_state");
}

export async function Undo() {
  return invoke("undo");
}

export async function Redo() {
  return invoke("redo");
}
