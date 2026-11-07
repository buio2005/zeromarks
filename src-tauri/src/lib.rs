mod bookmarks;
mod commands;
mod dto;
mod link_check;
mod sorting;
mod models;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::SharedState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_file_path,
            commands::open_file_picker,
            commands::open_import_file_picker,
            commands::create_bookmark_file,
            commands::load_bookmark_file,
            commands::load_file,
            commands::get_flat_tree,
            commands::get_root_nodes,
            commands::get_folder_children,
            commands::get_flat_index,
            commands::get_all_folders,
            commands::get_tree_stats,
            commands::find_duplicates,
            commands::check_links,
            commands::sort_folder,
            commands::check_external_change,
            commands::keep_local_version,
            commands::add_bookmark,
            commands::add_folder,
            commands::update_bookmark,
            commands::update_folder_name,
            commands::delete_node,
            commands::delete_nodes,
            commands::move_node,
            commands::move_nodes,
            commands::preview_import_merge,
            commands::apply_import_merge,
            commands::fetch_page_title,
            commands::fetch_favicon,
            commands::fetch_favicons_for_nodes,
            commands::open_url,
            commands::file_path,
            commands::get_history_state,
            commands::undo,
            commands::redo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
