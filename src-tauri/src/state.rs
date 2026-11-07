use std::sync::Mutex;

use crate::bookmarks::SnapshotCommand;
use crate::models::{HistoryState, Node};

#[derive(Debug, Default)]
pub struct AppState {
    pub file_path: String,
    pub tree: Vec<Node>,
    pub undo_stack: Vec<SnapshotCommand>,
    pub redo_stack: Vec<SnapshotCommand>,
    /// Fingerprint of the file as we last loaded or saved it (see `disk_fingerprint`).
    pub disk_hash: Option<u64>,
}

impl AppState {
    pub fn history_state(&self) -> HistoryState {
        HistoryState {
            can_undo: !self.undo_stack.is_empty(),
            can_redo: !self.redo_stack.is_empty(),
            undo_label: self
                .undo_stack
                .last()
                .map(|entry| entry.label.clone())
                .unwrap_or_default(),
            redo_label: self
                .redo_stack
                .last()
                .map(|entry| entry.label.clone())
                .unwrap_or_default(),
        }
    }
}

pub type SharedState = Mutex<AppState>;
