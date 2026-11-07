use serde::{Deserialize, Serialize};

use crate::models::{Bookmark, BookmarkPatch, FlatNode, Node};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkCreateDto {
    pub title: String,
    pub url: String,
    pub icon: String,
    #[serde(rename = "iconURI")]
    pub icon_uri: String,
    pub meta: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkDto {
    pub id: String,
    pub title: String,
    pub url: String,
    pub icon: String,
    #[serde(rename = "iconURI")]
    pub icon_uri: String,
    pub add_date: String,
    pub last_modified: String,
    pub meta: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderDto {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub add_date: String,
    pub last_modified: String,
    pub meta: String,
    pub children: Vec<NodeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NodeDto {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: u8,
    pub folder: Option<FolderDto>,
    pub bookmark: Option<BookmarkDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    pub moved_nodes: Vec<FlatNode>,
    pub old_parent_id: String,
    pub new_parent_id: String,
    pub new_index: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TreeStats {
    pub folders: i32,
    pub bookmarks: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderMergeItem {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkMergeItem {
    pub folder_path: String,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkConflictItem {
    pub folder_path: String,
    /// Where the matching bookmark already lives (may differ from `folder_path`).
    pub existing_folder_path: String,
    pub existing_title: String,
    pub incoming_title: String,
    pub url: String,
    pub existing_meta: String,
    pub incoming_meta: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    pub folders_to_add: Vec<FolderMergeItem>,
    pub bookmarks_to_add: Vec<BookmarkMergeItem>,
    pub duplicate_bookmarks: Vec<BookmarkMergeItem>,
    pub potential_updates: Vec<BookmarkConflictItem>,
}

/// One copy of a link that appears more than once in the library.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub folder_path: String,
    pub add_date: String,
}

/// All copies of the same link, in library order (top to bottom).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub url: String,
    pub items: Vec<DuplicateItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeApplyResult {
    pub folders_added: i32,
    pub bookmarks_added: i32,
    pub duplicates_skipped: i32,
    pub potential_updates: i32,
    /// Existing matches that gained missing details (icon, description, tags...).
    pub bookmarks_updated: i32,
}

impl From<BookmarkCreateDto> for Bookmark {
    fn from(value: BookmarkCreateDto) -> Self {
        Self {
            title: value.title,
            url: value.url,
            icon: value.icon,
            icon_uri: value.icon_uri,
            meta: value.meta,
            ..Bookmark::default()
        }
    }
}

impl From<BookmarkPatch> for BookmarkDto {
    fn from(value: BookmarkPatch) -> Self {
        Self {
            title: value.title.unwrap_or_default(),
            url: value.url.unwrap_or_default(),
            icon: value.icon.unwrap_or_default(),
            icon_uri: value.icon_uri.unwrap_or_default(),
            meta: value.meta.unwrap_or_default(),
            ..Self::default()
        }
    }
}

impl From<Bookmark> for BookmarkDto {
    fn from(value: Bookmark) -> Self {
        Self {
            id: value.id,
            title: value.title,
            url: value.url,
            icon: value.icon,
            icon_uri: value.icon_uri,
            add_date: value.add_date,
            last_modified: value.last_modified,
            meta: value.meta,
        }
    }
}

impl From<Node> for NodeDto {
    fn from(value: Node) -> Self {
        Self {
            id: value.id,
            node_type: value.node_type,
            folder: value.folder.map(|folder| FolderDto {
                id: folder.id,
                name: folder.name,
                icon: folder.icon,
                add_date: folder.add_date,
                last_modified: folder.last_modified,
                meta: folder.meta,
                children: folder.children.into_iter().map(NodeDto::from).collect(),
            }),
            bookmark: value.bookmark.map(BookmarkDto::from),
        }
    }
}
