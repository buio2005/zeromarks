use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(u8)]
pub enum NodeType {
    Folder = 0,
    Bookmark = 1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FlatNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: u8,
    pub parent_id: String,
    pub name: String,
    pub url: String,
    pub icon: String,
    #[serde(rename = "iconURI")]
    pub icon_uri: String,
    pub add_date: String,
    pub last_modified: String,
    pub meta: String,
    pub child_count: i32,
}

impl Default for FlatNode {
    fn default() -> Self {
        Self {
            id: String::new(),
            node_type: NodeType::Bookmark as u8,
            parent_id: String::new(),
            name: String::new(),
            url: String::new(),
            icon: String::new(),
            icon_uri: String::new(),
            add_date: String::new(),
            last_modified: String::new(),
            meta: String::new(),
            child_count: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkIndexEntry {
    pub node_id: String,
    pub title: String,
    pub url: String,
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub title: String,
    pub url: String,
    pub icon: String,
    #[serde(rename = "iconURI")]
    pub icon_uri: String,
    pub add_date: String,
    pub last_modified: String,
    pub meta: String,
    /// Text of the `<DD>` line that follows the entry (browser "description").
    #[serde(default)]
    pub description: String,
    /// Attributes this app does not interpret (TAGS, SHORTCUTURL,
    /// PERSONAL_TOOLBAR_FOLDER, ...), kept in file order so saving never drops them.
    #[serde(default)]
    pub extra_attrs: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkPatch {
    pub title: Option<String>,
    pub url: Option<String>,
    pub icon: Option<String>,
    #[serde(rename = "iconURI")]
    pub icon_uri: Option<String>,
    pub meta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub add_date: String,
    pub last_modified: String,
    pub meta: String,
    /// Text of the `<DD>` line that follows the entry (browser "description").
    #[serde(default)]
    pub description: String,
    /// Attributes this app does not interpret (TAGS, SHORTCUTURL,
    /// PERSONAL_TOOLBAR_FOLDER, ...), kept in file order so saving never drops them.
    #[serde(default)]
    pub extra_attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: u8,
    pub folder: Option<Folder>,
    pub bookmark: Option<Bookmark>,
}

impl Node {
    pub fn folder(id: impl Into<String>, name: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            id: id.clone(),
            node_type: NodeType::Folder as u8,
            folder: Some(Folder {
                id,
                name: name.into(),
                ..Folder::default()
            }),
            bookmark: None,
        }
    }

    pub fn bookmark(id: impl Into<String>, title: impl Into<String>, url: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            id: id.clone(),
            node_type: NodeType::Bookmark as u8,
            folder: None,
            bookmark: Some(Bookmark {
                id,
                title: title.into(),
                url: url.into(),
                ..Bookmark::default()
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryState {
    pub can_undo: bool,
    pub can_redo: bool,
    pub undo_label: String,
    pub redo_label: String,
}
