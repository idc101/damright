use tauri::State;
use crate::models::{Source, DirEntry};
use crate::DbState;
#[tauri::command]
pub fn add_source(
    state: State<DbState>,
    path: String,
) -> Result<Source, String> {
    let conn = state.0.lock().unwrap();
    crate::processing::add_source(&path, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_sources(state: State<DbState>) -> Result<Vec<Source>, String> {
    let conn = state.0.lock().unwrap();
    crate::db::source_repo::get_all(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_dir_tree(state: State<DbState>, path: String) -> Result<DirEntry, String> {
    let conn = state.0.lock().unwrap();
    crate::processing::get_dir_tree(&conn, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_source_sync_settings(
    state: State<DbState>,
    id: String,
    sync_mode: String,
    server_path: Option<String>,
    archive_prefix: Option<String>,
    rating_enabled: Option<bool>,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    crate::db::source_repo::update_sync_settings(
        &conn,
        &id,
        &sync_mode,
        server_path.as_deref(),
        archive_prefix.as_deref(),
        rating_enabled,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_source(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    crate::db::source_repo::delete_source(&conn, &id).map_err(|e| e.to_string())
}
