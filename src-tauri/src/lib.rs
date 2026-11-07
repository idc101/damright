pub mod processing;
pub mod models;
pub mod db;
pub mod commands;
pub mod web_server;
pub mod sync;
pub mod badge;
pub mod cli;

use std::sync::{Arc, Mutex};
use tauri::{Manager, Emitter, menu::{Menu, MenuItem, Submenu, PredefinedMenuItem}};
use rusqlite::Connection;
use db::init_db;
use sync::config::load_config;
use sync::sync_engine::SyncEngine;

pub struct DbState(pub Arc<Mutex<Connection>>);

pub fn get_app_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<std::path::PathBuf> {
    let mut app_dir = app.path().app_data_dir()?;
    if cfg!(debug_assertions) {
        app_dir.push("dev");
    }
    Ok(app_dir)
}

pub fn resolve_app_dir() -> std::path::PathBuf {
    if let Ok(custom_dir) = std::env::var("DAMRIGHT_DATA_DIR") {
        std::path::PathBuf::from(custom_dir)
    } else {
        let data_dir = dirs::data_dir().expect("Could not find system data directory");
        let mut dir = data_dir.join("com.damright.app");
        if cfg!(debug_assertions) {
            dir.push("dev");
        }
        dir
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let import_item = MenuItem::with_id(app, "import", "Import Folder...", true, None::<&str>)?;
            let fix_val_item = MenuItem::with_id(app, "fix_validation", "Fix Validation Issues", true, None::<&str>)?;
            
            #[cfg(target_os = "macos")]
            let app_menu = Submenu::with_items(
                app,
                "DamRight",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            let file_menu = Submenu::with_items(app, "File", true, &[
                &import_item,
                &PredefinedMenuItem::separator(app)?,
                &fix_val_item,
            ])?;

            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;

            #[cfg(target_os = "macos")]
            let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu])?;
            #[cfg(not(target_os = "macos"))]
            let menu = Menu::with_items(app, &[&file_menu, &edit_menu])?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                if event.id == "import" {
                    let _ = app.emit("import", ());
                } else if event.id == "fix_validation" {
                    let _ = app.emit("fix_validation", ());
                }
            });

            let app_dir = get_app_dir(app.handle())?;
            std::fs::create_dir_all(&app_dir)?;
            let conn = init_db(&app_dir)?;
            
            // Clean up orphaned photos (e.g. from tests or deleted sources)
            if let Ok(count) = crate::processing::cleanup_database(&conn) {
                if count > 0 {
                    println!("Cleaned up {} orphaned photo records", count);
                }
            }

            let config = load_config().unwrap_or_default();
            let _ = crate::sync::config::ensure_configured_sources(&conn, &config);
            let _ = crate::badge::update_inbox_badge(&conn);
            let sync_engine = SyncEngine::new(app_dir.clone(), config);

            let shared_conn = Arc::new(Mutex::new(conn));

            app.manage(DbState(shared_conn));
            app.manage(sync_engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_photos,
            commands::refresh_folder,
            commands::add_source,
            commands::get_all_sources,
            commands::update_source_sync_settings,
            commands::delete_source,
            commands::get_dir_tree,
            commands::get_all_photos,
            commands::get_all_tags,
            commands::get_all_people,
            commands::set_exposure,
            commands::set_portrait_blur,
            commands::set_metadata,
            commands::batch_set_metadata,
            commands::batch_set_capture_date,
            commands::set_crop,
            commands::set_event,
            commands::batch_set_event,

            commands::set_rejected,
            commands::toggle_quick_collection,
            commands::delete_rejected,
            commands::delete_photo,
            commands::auto_rename,
            commands::move_photos,
            commands::move_folder,
            commands::export_photos,
            commands::fix_all_validation_issues,
            commands::get_photo_data,
            commands::get_preview,
            commands::reveal_in_finder,
            commands::diff_icloud_photos,
            commands::add_photos_to_icloud_album,
            commands::get_inbox_count,
            commands::update_inbox_badge,

            commands::get_sync_config,
            commands::save_sync_config,
            commands::test_server_config,
            commands::test_s3_config,
            commands::trigger_sync_now,
            commands::get_sync_status,
            commands::get_sync_diagnostics,

            commands::get_ranking_pair,
            commands::record_ranking_match,
            commands::get_ranking_quad,
            commands::record_ranking_quad_match,
            commands::get_ranking_stats,
            commands::apply_suggested_ratings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub fn run_test_app() {
    let builder = tauri::Builder::default();
    let _ = builder.invoke_handler(tauri::generate_handler![
        commands::import_photos,
        commands::refresh_folder,
        commands::add_source,
        commands::get_all_sources,
        commands::update_source_sync_settings,
        commands::delete_source,
        commands::get_dir_tree,
        commands::get_all_photos,
        commands::get_all_tags,
        commands::get_all_people,
        commands::set_exposure,
        commands::set_portrait_blur,
        commands::set_metadata,
        commands::batch_set_metadata,
        commands::batch_set_capture_date,
        commands::set_crop,
        commands::set_event,
        commands::batch_set_event,
        commands::set_rejected,
        commands::toggle_quick_collection,
        commands::delete_rejected,
        commands::delete_photo,
        commands::auto_rename,
        commands::move_photos,
        commands::move_folder,
        commands::export_photos,
        commands::fix_all_validation_issues,
        commands::get_photo_data,
        commands::get_preview,
        commands::reveal_in_finder,
        commands::diff_icloud_photos,
        commands::add_photos_to_icloud_album,
        commands::get_inbox_count,
        commands::update_inbox_badge,
        commands::get_sync_config,
        commands::save_sync_config,
        commands::test_server_config,
        commands::test_s3_config,
        commands::trigger_sync_now,
        commands::get_sync_status,
        commands::get_sync_diagnostics,
        commands::get_ranking_pair,
        commands::record_ranking_match,
        commands::get_ranking_quad,
        commands::record_ranking_quad_match,
        commands::get_ranking_stats,
        commands::apply_suggested_ratings,
    ]);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    #[test]
    fn test_command_registration() {
        let _app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                commands::import_photos,
                commands::refresh_folder,
                commands::add_source,
                commands::get_all_sources,
                commands::update_source_sync_settings,
                commands::delete_source,
                commands::get_dir_tree,
                commands::get_all_photos,
                commands::get_all_tags,
                commands::get_all_people,
                commands::set_exposure,
                commands::set_portrait_blur,
                commands::set_metadata,
                commands::batch_set_metadata,
                commands::batch_set_capture_date,
                commands::set_crop,
                commands::set_event,
                commands::batch_set_event,
                commands::set_rejected,
                commands::toggle_quick_collection,
                commands::delete_rejected,
                commands::delete_photo,
                commands::auto_rename,
                commands::move_photos,
                commands::move_folder,
                commands::export_photos,
                commands::fix_all_validation_issues,
                commands::get_photo_data,
                commands::get_preview,
                commands::reveal_in_finder,
                commands::diff_icloud_photos,
                commands::add_photos_to_icloud_album,
                commands::get_inbox_count,
                commands::update_inbox_badge,

                commands::get_sync_config,
                commands::save_sync_config,
                commands::test_s3_config,
                commands::trigger_sync_now,
                commands::get_sync_status,
                commands::get_sync_diagnostics,

                commands::get_ranking_pair,
                commands::record_ranking_match,
                commands::get_ranking_quad,
                commands::record_ranking_quad_match,
                commands::get_ranking_stats,
                commands::apply_suggested_ratings,
            ])
            .build(mock_context(noop_assets()))
            .expect("failed to build app");
    }
}
