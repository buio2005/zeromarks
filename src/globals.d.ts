import * as core from '@tauri-apps/api/core';
import * as tauriWindow from '@tauri-apps/api/window';
import * as webviewWindow from '@tauri-apps/api/webviewWindow';
import * as dpi from '@tauri-apps/api/dpi';

declare global {
  interface Window {
    __TAURI__: {
      core: typeof core;
      window: typeof tauriWindow;
      webviewWindow: typeof webviewWindow;
      dpi: typeof dpi;
      // Add other namespaces here if you use them (e.g., window, dialog, etc.)
    };
  }

  // =============================================================================
  // NAF runtime types (mirror of shared/runtime/naf.js JSDoc typedefs)
  // =============================================================================

  interface Component<T extends Element = Element> {
    html: string;
    el?: T;
    refs: Record<string, Element>;
    mount: (parent: Element) => void;
    unmount?: () => void;
  }

  type Signal<T> = (() => T) & ((value: T) => T);

  type Computed<T> = Signal<T>;

  type Effect = () => void;

  type Subs = (() => void)[];

  type TemplateTag = (
    strings: TemplateStringsArray,
    ...values: Array<
      string | number | boolean | null | undefined | Component | { __raw: true; html: string }
    >
  ) => Component<HTMLElement>;

  // =============================================================================
  // Domain types (mirror of types.js)
  // =============================================================================

  type NodeType = 0 | 1;

  type TimestampValue = string;

  interface BookmarkData {
    id: string;
    title: string;
    url: string;
    icon: string;
    iconURI: string;
    addDate: TimestampValue;
    lastModified: TimestampValue;
    meta: string;
  }

  interface BookmarkCreate {
    title: string;
    url: string;
    icon?: string;
    iconURI?: string;
    meta?: string;
  }

  interface BookmarkPatch {
    title?: string;
    url?: string;
    icon?: string;
    iconURI?: string;
    meta?: string;
  }

  interface BookmarkNode {
    type: 1;
    id: string;
    bookmark: BookmarkData;
  }

  interface FolderData {
    id: string;
    name: string;
    icon: string;
    addDate: TimestampValue;
    lastModified: TimestampValue;
    meta: string;
    childCount: number;
    children: TreeNode[];
    childrenLoaded: boolean;
  }

  interface FolderNode {
    type: 0;
    id: string;
    folder: FolderData;
  }

  type TreeNode = FolderNode | BookmarkNode;

  interface FlatNode {
    id: string;
    type: NodeType;
    parentId: string;
    name: string;
    url: string;
    icon: string;
    iconURI: string;
    addDate: TimestampValue;
    lastModified: TimestampValue;
    meta: string;
    childCount: number;
  }

  interface BookmarkDto {
    id: string;
    title: string;
    url: string;
    icon: string;
    iconURI: string;
    addDate: TimestampValue;
    lastModified: TimestampValue;
    meta: string;
  }

  interface FolderDto {
    id: string;
    name: string;
    icon: string;
    addDate: TimestampValue;
    lastModified: TimestampValue;
    meta: string;
    children: NodeDto[];
  }

  interface NodeDto {
    id: string;
    type: NodeType;
    folder: FolderDto | null;
    bookmark: BookmarkDto | null;
  }

  interface BookmarkIndexEntry {
    nodeId: string;
    title: string;
    url: string;
    folderPath: string;
  }

  interface MoveResult {
    movedNodes: FlatNode[];
    oldParentId: string;
    newParentId: string;
    newIndex: number;
  }

  interface FolderMergeItem {
    path: string;
    name: string;
  }

  interface BookmarkMergeItem {
    folderPath: string;
    title: string;
    url: string;
  }

  interface BookmarkConflictItem {
    folderPath: string;
    existingFolderPath: string;
    existingTitle: string;
    incomingTitle: string;
    url: string;
    existingMeta: string;
    incomingMeta: string;
  }

  interface MergePreview {
    foldersToAdd: FolderMergeItem[];
    bookmarksToAdd: BookmarkMergeItem[];
    duplicateBookmarks: BookmarkMergeItem[];
    potentialUpdates: BookmarkConflictItem[];
  }

  interface DuplicateItem {
    id: string;
    title: string;
    url: string;
    folderPath: string;
    addDate: string;
  }

  type SortMode = "nameAsc" | "nameDesc" | "dateNewest" | "dateOldest" | "domain";

  interface SortOptions {
    mode: SortMode;
    foldersFirst: boolean;
    recursive: boolean;
  }

  type LinkCheckStatus = "ok" | "redirected" | "broken" | "uncertain" | "skipped";

  interface LinkCheckResult {
    id: string;
    url: string;
    status: LinkCheckStatus;
    httpStatus: number;
    finalUrl: string;
    message: string;
  }

  interface DuplicateGroup {
    url: string;
    items: DuplicateItem[];
  }

  interface MergeApplyResult {
    foldersAdded: number;
    bookmarksAdded: number;
    duplicatesSkipped: number;
    potentialUpdates: number;
    bookmarksUpdated: number;
  }

  interface HistoryState {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string;
    redoLabel: string;
  }

  interface TreeStats {
    folders: number;
    bookmarks: number;
  }

  type ToastType = "info" | "success" | "error" | "warning";

  interface Toast {
    id: number;
    message: string;
    type: ToastType;
  }

  type ConfirmCallback = (() => void | Promise<void>) | null;

  interface ConfirmModalState {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: ConfirmCallback;
  }

  interface MoveTarget {
    id: string;
    name: string;
    depth: number;
    pathLabel: string;
    hasChildren?: boolean;
    expanded?: boolean;
  }

  interface MoveDialogRequest {
    nodeIds: string[];
    label: string;
    type: "bookmark" | "folder";
  }

  interface VisibleTreeNodeEntry {
    id: string;
    node: TreeNode;
    depth: number;
    parentId: string;
  }

  interface PerFileTreeState {
    expandedNodeIds: string[];
    selectedNodeId: string;
    scrollTop: number;
  }

  interface SelectionSnapshot {
    selectedNodeIds: string[];
    primaryNodeId: string;
    ancestorIds: string[];
  }

  interface WindowState {
    width: number;
    height: number;
  }

  interface PersistedUIState {
    lastOpenedFile: string;
    leftPaneWidth: number;
    window: WindowState | null;
    files: Record<string, PerFileTreeState>;
    theme: "light" | "dark";
    /** Most recently opened bookmark files, newest first. */
    recentFiles: string[];
  }
}

export {};
