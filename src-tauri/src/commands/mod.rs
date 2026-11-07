use std::path::Path;
#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use base64::Engine;
use reqwest::blocking::Client;
use scraper::{Html, Selector};
use tauri::State;

use crate::dto::{
    BookmarkCreateDto, DuplicateGroup, MergeApplyResult, MergePreview, MoveResult, NodeDto, TreeStats,
};
use crate::models::{BookmarkIndexEntry, BookmarkPatch, FlatNode, HistoryState};
use crate::state::SharedState;
use crate::{bookmarks, bookmarks::SnapshotCommand};

type CommandResult<T> = Result<T, String>;

#[derive(Clone)]
struct FaviconRefreshTarget {
    id: String,
    url: String,
}

#[cfg(test)]
static FORCE_SAVE_FAILURE: AtomicBool = AtomicBool::new(false);

fn persist_tree(path: &str, tree: &[crate::models::Node], force_backup: bool) -> Result<(), String> {
    #[cfg(test)]
    if FORCE_SAVE_FAILURE.load(Ordering::Relaxed) {
        return Err("forced save failure".to_string());
    }

    if path.is_empty() {
        return Ok(());
    }

    bookmarks::save_file_with_backup(path, tree, force_backup)
}

/// Saves `tree` to the current file. If another program changed the file since we last
/// loaded or saved it, that version is backed up first (no throttle). Afterwards the
/// remembered fingerprint matches what we wrote.
fn save_tracked(state: &mut crate::state::AppState, tree: &[crate::models::Node]) -> Result<(), String> {
    let changed_outside = state.disk_hash.is_some() && bookmarks::disk_fingerprint(&state.file_path) != state.disk_hash;
    persist_tree(&state.file_path, tree, changed_outside)?;
    state.disk_hash = bookmarks::disk_fingerprint(&state.file_path);
    Ok(())
}

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalChange {
    Unchanged,
    Changed,
    Missing,
}

/// Has the open file been changed or removed by another program since we last
/// loaded or saved it?
#[tauri::command]
pub fn check_external_change(state: State<'_, SharedState>) -> CommandResult<ExternalChange> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    external_change_status(&state)
}

fn external_change_status(state: &crate::state::AppState) -> CommandResult<ExternalChange> {
    if state.file_path.is_empty() || state.disk_hash.is_none() {
        return Ok(ExternalChange::Unchanged);
    }
    if !Path::new(&state.file_path).exists() {
        return Ok(ExternalChange::Missing);
    }
    Ok(match bookmarks::disk_fingerprint(&state.file_path) {
        Some(hash) if Some(hash) == state.disk_hash => ExternalChange::Unchanged,
        Some(_) => ExternalChange::Changed,
        // Exists but unreadable right now (e.g. a sync client holds it): ask again later.
        None => ExternalChange::Unchanged,
    })
}

/// "Keep my version": back up the other program's version now, then treat the file as
/// ours again. Our next save overwrites it.
#[tauri::command]
pub fn keep_local_version(state: State<'_, SharedState>) -> CommandResult<()> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    if Path::new(&state.file_path).exists() {
        bookmarks::backup_now(&state.file_path).map_err(|e| format!("failed to back up the changed file: {e}"))?;
    }
    let tree = state.tree.clone();
    // Write our version now so the file matches what the app shows.
    persist_tree(&state.file_path, &tree, false)?;
    state.disk_hash = bookmarks::disk_fingerprint(&state.file_path);
    Ok(())
}

fn commit_snapshot(
    state: &mut crate::state::AppState,
    label: &str,
    before: Vec<crate::models::Node>,
    after: Vec<crate::models::Node>,
) -> Result<(), String> {
    save_tracked(state, &after)?;
    state.tree = after.clone();
    state.undo_stack.push(SnapshotCommand {
        label: label.to_string(),
        before,
        after,
    });
    state.redo_stack.clear();
    Ok(())
}

fn html_client(timeout_secs: u64) -> CommandResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("failed to create HTTP client: {e}"))
}

fn select_path(open: bool, title: &str) -> Option<String> {
    let dialog = rfd::FileDialog::new()
        .set_title(title)
        .add_filter("HTML Files", &["html"])
        .add_filter("All Files", &["*"]);
    if open {
        dialog.pick_file().map(|p| p.display().to_string())
    } else {
        dialog
            .set_file_name("bookmarks.html")
            .save_file()
            .map(|p| p.display().to_string())
    }
}

fn ensure_html_extension(path: &str) -> String {
    if Path::new(path)
        .extension()
        .map(|ext| ext.to_string_lossy().eq_ignore_ascii_case("html"))
        .unwrap_or(false)
    {
        path.to_string()
    } else {
        format!("{path}.html")
    }
}

fn extract_title(document: &Html) -> String {
    let selector = Selector::parse("title").expect("valid title selector");
    document
        .select(&selector)
        .next()
        .map(|node| node.text().collect::<String>().trim().to_string())
        .unwrap_or_default()
}

fn extract_icon_hrefs(document: &Html) -> Vec<String> {
    let selector = Selector::parse("link[href][rel]").expect("valid link selector");
    document
        .select(&selector)
        .filter_map(|node| {
            let rel = node.value().attr("rel")?.to_ascii_lowercase();
            let is_icon = rel.split_whitespace().any(|part| {
                matches!(
                    part,
                    "icon" | "shortcut" | "apple-touch-icon" | "apple-touch-icon-precomposed"
                )
            });
            if !is_icon {
                return None;
            }
            node.value().attr("href").map(ToString::to_string)
        })
        .collect()
}

fn fetch_icon_url(client: &Client, icon_url: &str) -> CommandResult<String> {
    let response = client
        .get(icon_url)
        .send()
        .and_then(|resp| resp.error_for_status())
        .map_err(|e| format!("failed to fetch favicon: {e}"))?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = response
        .bytes()
        .map_err(|e| format!("failed to read favicon: {e}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{content_type};base64,{encoded}"))
}

fn fetch_favicon_for_url(client: &Client, page_url: &str) -> CommandResult<String> {
    let page = client
        .get(page_url)
        .send()
        .and_then(|resp| resp.error_for_status())
        .map_err(|e| format!("failed to fetch favicon: {e}"))?
        .text()
        .map_err(|e| format!("failed to read favicon HTML: {e}"))?;

    let page_uri = reqwest::Url::parse(page_url).map_err(|e| format!("invalid URL: {e}"))?;
    let document = Html::parse_document(&page);

    for href in extract_icon_hrefs(&document) {
        if let Ok(icon_url) = page_uri.join(&href) {
            if let Ok(icon_data) = fetch_icon_url(client, icon_url.as_ref()) {
                if !icon_data.is_empty() {
                    return Ok(icon_data);
                }
            }
        }
    }

    if let Ok(fallback) = page_uri.join("/favicon.ico") {
        if let Ok(icon_data) = fetch_icon_url(client, fallback.as_ref()) {
            if !icon_data.is_empty() {
                return Ok(icon_data);
            }
        }
    }

    // Privacy: no third-party favicon service (it would learn every bookmarked domain).
    // Only the bookmarked site itself is contacted; without an icon there, none is set.
    Err("no favicon found on this site".to_string())
}

#[tauri::command]
pub fn get_file_path(state: State<'_, SharedState>) -> CommandResult<String> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    Ok(state.file_path.clone())
}

#[tauri::command]
pub fn open_file_picker() -> CommandResult<String> {
    Ok(select_path(true, "Open Bookmark File").unwrap_or_default())
}

#[tauri::command]
pub fn open_import_file_picker() -> CommandResult<String> {
    Ok(select_path(true, "Import Bookmark File").unwrap_or_default())
}

#[tauri::command]
pub fn create_bookmark_file(state: State<'_, SharedState>) -> CommandResult<String> {
    let Some(path) = select_path(false, "Create Bookmark File") else {
        return Ok(String::new());
    };
    let path = ensure_html_extension(&path);
    let empty_tree: Vec<crate::models::Node> = Vec::new();
    bookmarks::save_file(&path, &empty_tree)?;
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    state.disk_hash = bookmarks::disk_fingerprint(&path);
    state.file_path = path.clone();
    state.tree = empty_tree;
    state.undo_stack.clear();
    state.redo_stack.clear();
    Ok(path)
}

#[tauri::command]
pub fn load_bookmark_file(path: String, state: State<'_, SharedState>) -> CommandResult<()> {
    let tree = bookmarks::load_file(&path)?;
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    state.disk_hash = bookmarks::disk_fingerprint(&path);
    state.file_path = path;
    state.tree = tree;
    state.undo_stack.clear();
    state.redo_stack.clear();
    Ok(())
}

#[tauri::command]
pub fn load_file(path: String, state: State<'_, SharedState>) -> CommandResult<()> {
    let tree = bookmarks::load_file(&path)?;
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    state.disk_hash = bookmarks::disk_fingerprint(&path);
    state.file_path = path;
    state.tree = tree;
    state.undo_stack.clear();
    state.redo_stack.clear();
    Ok(())
}

#[tauri::command]
pub fn get_flat_tree(state: State<'_, SharedState>) -> CommandResult<Vec<FlatNode>> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    Ok(bookmarks::flatten_tree(&state.tree))
}

#[tauri::command]
pub fn get_root_nodes(state: State<'_, SharedState>) -> CommandResult<Vec<FlatNode>> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    Ok(state.tree.iter().map(|node| bookmarks::new_flat_node(node, "")).collect())
}

#[tauri::command]
pub fn get_folder_children(folder_id: String, state: State<'_, SharedState>) -> CommandResult<Vec<FlatNode>> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let folder = bookmarks::find_node(&state.tree, &folder_id).ok_or_else(|| "node not found".to_string())?;
    let children = folder
        .folder
        .as_ref()
        .ok_or_else(|| "cannot move into a bookmark (only folders)".to_string())?
        .children
        .iter()
        .map(|node| bookmarks::new_flat_node(node, &folder_id))
        .collect();
    Ok(children)
}

#[tauri::command]
pub fn get_flat_index(state: State<'_, SharedState>) -> CommandResult<Vec<BookmarkIndexEntry>> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    Ok(bookmarks::build_flat_index(&state.tree))
}

#[tauri::command]
pub fn get_all_folders(state: State<'_, SharedState>) -> CommandResult<Vec<NodeDto>> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    Ok(bookmarks::collect_folder_nodes(&state.tree))
}

#[tauri::command]
pub fn get_tree_stats(state: State<'_, SharedState>) -> CommandResult<TreeStats> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    Ok(bookmarks::tree_stats(&state.tree))
}

/// Async so the window stays responsive; the network work runs on its own OS thread
/// (reqwest's blocking client must not run inside the async runtime).
#[tauri::command]
pub async fn check_links(targets: Vec<crate::link_check::LinkCheckTarget>) -> CommandResult<Vec<crate::link_check::LinkCheckResult>> {
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::spawn(move || crate::link_check::check_links(&targets, Duration::from_secs(12)))
            .join()
            .map_err(|_| "link check crashed".to_string())?
    })
    .await
    .map_err(|e| format!("link check failed: {e}"))?
}

#[tauri::command]
pub fn sort_folder(folder_id: String, options: crate::sorting::SortOptions, state: State<'_, SharedState>) -> CommandResult<()> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let before = state.tree.clone();
    let mut next_tree = before.clone();
    crate::sorting::sort_folder(&mut next_tree, &folder_id, options)?;
    commit_snapshot(&mut state, "Sort Folder", before, next_tree)
}

#[tauri::command]
pub fn find_duplicates(state: State<'_, SharedState>) -> CommandResult<Vec<DuplicateGroup>> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    Ok(bookmarks::find_duplicates(&state.tree))
}

#[tauri::command]
pub fn add_bookmark(parent_id: String, bm: BookmarkCreateDto, state: State<'_, SharedState>) -> CommandResult<FlatNode> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let before = state.tree.clone();
    let mut next_tree = before.clone();
    let flat = bookmarks::add_bookmark(&mut next_tree, &parent_id, bm)?;
    commit_snapshot(&mut state, "Add Bookmark", before, next_tree)?;
    Ok(flat)
}

#[tauri::command]
pub fn add_folder(parent_id: String, name: String, state: State<'_, SharedState>) -> CommandResult<FlatNode> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let before = state.tree.clone();
    let mut next_tree = before.clone();
    let flat = bookmarks::add_folder(&mut next_tree, &parent_id, &name)?;
    commit_snapshot(&mut state, "Add Folder", before, next_tree)?;
    Ok(flat)
}

#[tauri::command]
pub fn update_bookmark(id: String, patch: BookmarkPatch, state: State<'_, SharedState>) -> CommandResult<()> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let before = state.tree.clone();
    let mut next_tree = before.clone();
    bookmarks::update_bookmark(&mut next_tree, &id, patch)?;
    commit_snapshot(&mut state, "Edit Bookmark", before, next_tree)
}

#[tauri::command]
pub fn update_folder_name(id: String, name: String, state: State<'_, SharedState>) -> CommandResult<()> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let before = state.tree.clone();
    let mut next_tree = before.clone();
    bookmarks::update_folder_name(&mut next_tree, &id, &name)?;
    commit_snapshot(&mut state, "Rename Folder", before, next_tree)
}

#[tauri::command]
pub fn delete_node(id: String, state: State<'_, SharedState>) -> CommandResult<()> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let before = state.tree.clone();
    let mut next_tree = before.clone();
    bookmarks::delete_node(&mut next_tree, &id)?;
    commit_snapshot(&mut state, "Delete Bookmark", before, next_tree)
}

#[tauri::command]
pub fn delete_nodes(ids: Vec<String>, state: State<'_, SharedState>) -> CommandResult<()> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let before = state.tree.clone();
    let mut next_tree = before.clone();
    bookmarks::delete_nodes(&mut next_tree, &ids)?;
    commit_snapshot(&mut state, &format!("Delete {} Items", ids.len()), before, next_tree)
}

#[tauri::command]
pub fn move_node(node_id: String, new_parent_id: String, new_index: i32, _state: State<'_, SharedState>) -> CommandResult<MoveResult> {
    let mut state = _state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let before = state.tree.clone();
    let mut next_tree = before.clone();
    let result = bookmarks::move_node(&mut next_tree, &node_id, &new_parent_id, new_index)?;
    commit_snapshot(&mut state, "Move Bookmark", before, next_tree)?;
    Ok(result)
}

#[tauri::command]
pub fn move_nodes(node_ids: Vec<String>, target_folder_id: String, _state: State<'_, SharedState>) -> CommandResult<MoveResult> {
    let mut state = _state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let before = state.tree.clone();
    let mut next_tree = before.clone();
    let result = bookmarks::move_nodes(&mut next_tree, &node_ids, &target_folder_id)?;
    commit_snapshot(&mut state, &format!("Move {} Items", node_ids.len()), before, next_tree)?;
    Ok(result)
}

#[tauri::command]
pub fn preview_import_merge(path: String, state: State<'_, SharedState>) -> CommandResult<MergePreview> {
    let incoming = bookmarks::load_file(&path)?;
    let current_tree = {
        let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
        state.tree.clone()
    };
    Ok(bookmarks::preview_merge(&current_tree, &incoming))
}

#[tauri::command]
pub fn apply_import_merge(path: String, state: State<'_, SharedState>) -> CommandResult<MergeApplyResult> {
    let incoming = bookmarks::load_file(&path)?;
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let before = state.tree.clone();
    let mut next_tree = before.clone();
    let result = bookmarks::apply_merge(&mut next_tree, &incoming);
    commit_snapshot(&mut state, "Import Merge", before, next_tree)?;
    Ok(result)
}

#[tauri::command]
pub fn fetch_page_title(page_url: String) -> CommandResult<String> {
    let client = html_client(3)?;
    let response = client
        .get(&page_url)
        .send()
        .and_then(|resp| resp.error_for_status())
        .map_err(|e| format!("failed to fetch page: {e}"))?;
    let body = response
        .text()
        .map_err(|e| format!("failed to read page body: {e}"))?;
    Ok(extract_title(&Html::parse_document(&body)))
}

#[tauri::command]
pub fn fetch_favicon(page_url: String) -> CommandResult<String> {
    let client = html_client(5)?;
    fetch_favicon_for_url(&client, &page_url)
}

#[tauri::command]
pub fn fetch_favicons_for_nodes(ids: Vec<String>, state: State<'_, SharedState>) -> CommandResult<Vec<FlatNode>> {
    let client = html_client(5)?;
    let (before, mut next_tree, targets, file_path) = {
        let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
        let before = state.tree.clone();
        let mut targets = Vec::with_capacity(ids.len());

        for id in ids {
            let Some(node) = bookmarks::find_node(&before, &id) else {
                return Err("node not found".to_string());
            };
            let Some(bookmark) = node.bookmark.as_ref() else {
                return Err(format!("node {id} is not a bookmark"));
            };
            targets.push(FaviconRefreshTarget {
                id,
                url: bookmark.url.clone(),
            });
        }

        (
            before.clone(),
            before,
            targets,
            state.file_path.clone(),
        )
    };
    let mut updated = Vec::new();

    for target in targets {
        let icon = match fetch_favicon_for_url(&client, &target.url) {
            Ok(icon) => icon,
            Err(_) => continue,
        };
        let Some(node) = bookmarks::find_node_mut(&mut next_tree, &target.id) else {
            return Err("node not found".to_string());
        };
        let Some(bookmark) = node.bookmark.as_mut() else {
            return Err(format!("node {} is not a bookmark", target.id));
        };
        if icon.is_empty() || icon == bookmark.icon {
            continue;
        }
        bookmark.icon = icon;
        bookmark.last_modified = bookmarks::current_timestamp();
        updated.push(bookmarks::new_flat_node(node, ""));
    }

    if updated.is_empty() {
        return Err("failed to fetch favicons for selected bookmarks".to_string());
    }

    for flat in &mut updated {
        let parent_id = bookmarks::find_parent_id(&next_tree, &flat.id).unwrap_or_default();
        flat.parent_id = parent_id;
    }

    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    if state.tree != before || state.file_path != file_path {
        return Err("bookmark state changed during favicon refresh".to_string());
    }
    commit_snapshot(&mut state, "Refresh Favicons", before, next_tree)?;
    Ok(updated)
}

#[tauri::command]
pub fn open_url(page_url: String) -> CommandResult<()> {
    webbrowser::open(&page_url)
        .map(|_| ())
        .map_err(|e| format!("failed to open URL: {e}"))
}

#[tauri::command]
pub fn file_path(state: State<'_, SharedState>) -> CommandResult<String> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    Ok(state.file_path.clone())
}

#[tauri::command]
pub fn get_history_state(state: State<'_, SharedState>) -> CommandResult<HistoryState> {
    let state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    Ok(state.history_state())
}

#[tauri::command]
pub fn undo(state: State<'_, SharedState>) -> CommandResult<HistoryState> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let command = state.undo_stack.pop().ok_or_else(|| "nothing to undo".to_string())?;
    if let Err(err) = save_tracked(&mut state, &command.before) {
        state.undo_stack.push(command);
        return Err(err);
    }
    state.tree = command.before.clone();
    state.redo_stack.push(command);
    Ok(state.history_state())
}

#[tauri::command]
pub fn redo(state: State<'_, SharedState>) -> CommandResult<HistoryState> {
    let mut state = state.lock().map_err(|_| "state lock poisoned".to_string())?;
    let command = state.redo_stack.pop().ok_or_else(|| "nothing to redo".to_string())?;
    if let Err(err) = save_tracked(&mut state, &command.after) {
        state.redo_stack.push(command);
        return Err(err);
    }
    state.tree = command.after.clone();
    state.undo_stack.push(command);
    Ok(state.history_state())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Node;
    use crate::state::AppState;

    fn sample_tree() -> Vec<Node> {
        let mut root = Node::folder("root", "Root");
        root.folder
            .as_mut()
            .expect("folder node")
            .children
            .push(Node::bookmark("bookmark-1", "Example", "https://example.com"));
        vec![root]
    }

    #[test]
    fn commit_snapshot_leaves_state_unchanged_on_save_failure() {
        let before = sample_tree();
        let mut state = AppState {
            file_path: "/tmp/should-not-write.html".to_string(),
            tree: before.clone(),
            ..AppState::default()
        };
        let after = Vec::new();

        FORCE_SAVE_FAILURE.store(true, Ordering::Relaxed);
        let result = commit_snapshot(&mut state, "Delete Bookmark", before.clone(), after);
        FORCE_SAVE_FAILURE.store(false, Ordering::Relaxed);

        assert!(result.is_err());
        assert_eq!(state.tree, before);
        assert!(state.undo_stack.is_empty());
        assert!(state.redo_stack.is_empty());
    }

    #[test]
    fn external_edits_are_detected_and_backed_up_before_overwrite() {
        let dir = std::env::temp_dir().join(format!("jb-external-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("bookmarks.html");
        let path = file.to_string_lossy().into_owned();

        let tree = sample_tree();
        bookmarks::save_file(&path, &tree).unwrap();
        let mut state = AppState {
            file_path: path.clone(),
            tree: tree.clone(),
            disk_hash: bookmarks::disk_fingerprint(&path),
            ..AppState::default()
        };
        assert_eq!(external_change_status(&state).unwrap(), ExternalChange::Unchanged);

        // Our own save is not reported as an outside change.
        save_tracked(&mut state, &tree).unwrap();
        assert_eq!(external_change_status(&state).unwrap(), ExternalChange::Unchanged);

        // Another program edits the file.
        std::fs::write(&file, "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n</DL><p>\n").unwrap();
        assert_eq!(external_change_status(&state).unwrap(), ExternalChange::Changed);

        // Saving over it keeps the outside version as a backup, even within the throttle window.
        let before = std::fs::read_dir(dir.join(bookmarks::BACKUP_DIR_NAME)).map(|d| d.count()).unwrap_or(0);
        save_tracked(&mut state, &tree).unwrap();
        let backups: Vec<_> = std::fs::read_dir(dir.join(bookmarks::BACKUP_DIR_NAME)).unwrap().flatten().collect();
        assert!(backups.len() > before || backups.iter().any(|b| std::fs::read_to_string(b.path()).unwrap().contains("<DL><p>\n</DL>")));
        assert!(backups.iter().any(|b| std::fs::read_to_string(b.path()).unwrap().contains("<DL><p>\n</DL>")));
        assert_eq!(external_change_status(&state).unwrap(), ExternalChange::Unchanged);

        std::fs::remove_file(&file).unwrap();
        assert_eq!(external_change_status(&state).unwrap(), ExternalChange::Missing);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn move_node_failure_on_clone_preserves_original_tree() {
        let before = sample_tree();
        let state = AppState {
            tree: before.clone(),
            ..AppState::default()
        };
        let mut next_tree = state.tree.clone();

        let result = bookmarks::move_node(&mut next_tree, "bookmark-1", "missing-folder", 0);

        assert!(result.is_err());
        assert_eq!(state.tree, before);
    }

    #[test]
    fn move_nodes_failure_on_clone_preserves_original_tree() {
        let before = sample_tree();
        let state = AppState {
            tree: before.clone(),
            ..AppState::default()
        };
        let mut next_tree = state.tree.clone();
        let node_ids = vec!["bookmark-1".to_string()];

        let result = bookmarks::move_nodes(&mut next_tree, &node_ids, "missing-folder");

        assert!(result.is_err());
        assert_eq!(state.tree, before);
    }
}
