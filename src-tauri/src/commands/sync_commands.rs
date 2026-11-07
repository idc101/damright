use tauri::State;
use crate::sync::config::{load_config, save_config, AppConfig, ServerSyncConfig};
use crate::sync::server_client;
use crate::sync::sync_engine::{SyncEngine, SyncEngineStatus};

use crate::DbState;

#[tauri::command]
pub fn get_sync_config() -> Result<AppConfig, String> {
    load_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_sync_config(state: State<'_, DbState>, engine: State<'_, SyncEngine>, config: AppConfig) -> Result<(), String> {
    save_config(&config).map_err(|e| e.to_string())?;
    let conn = state.0.lock().unwrap();
    let _ = crate::sync::config::ensure_configured_sources(&conn, &config);
    engine.update_config(config);
    Ok(())
}

#[tauri::command]
pub async fn test_server_config(config: ServerSyncConfig) -> Result<bool, String> {
    server_client::test_server_config(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_s3_config(config: ServerSyncConfig) -> Result<bool, String> {
    server_client::test_server_config(&config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn trigger_sync_now(engine: State<'_, SyncEngine>, force_rescan: Option<bool>) -> Result<usize, String> {
    engine.run_sync_now_with_options(force_rescan.unwrap_or(false)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_sync_status(engine: State<'_, SyncEngine>) -> Result<SyncEngineStatus, String> {
    Ok(engine.get_status())
}

#[tauri::command]
pub fn get_sync_diagnostics(state: State<'_, DbState>, engine: State<'_, SyncEngine>) -> Result<crate::sync::sync_engine::SyncDiagnostics, String> {
    engine.get_diagnostics(&state).map_err(|e| e.to_string())
}
