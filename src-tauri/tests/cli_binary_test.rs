#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;
    use damright_lib::sync::config::AppConfig;
    use damright_lib::sync::sync_engine::SyncEngine;

    #[tokio::test]
    async fn test_cli_dry_run_sync_execution() {
        let tmp_dir = tempdir().unwrap();
        let app_dir = tmp_dir.path().join("cli_app");
        let server_storage_dir = tmp_dir.path().join("server_storage");
        let inbox_dir = tmp_dir.path().join("local_inbox");
        let library_dir = tmp_dir.path().join("local_library");

        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&server_storage_dir).unwrap();
        fs::create_dir_all(&inbox_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();

        // Remote file to pull
        let server_inbox = server_storage_dir.join("Inbox");
        fs::create_dir_all(&server_inbox).unwrap();
        fs::write(server_inbox.join("photo1.jpg"), b"server-photo").unwrap();

        // Local file to push
        let local_file = library_dir.join("20260822-local.jpg");
        fs::write(&local_file, b"local-photo-bytes").unwrap();

        // Client DB setup
        let conn = damright_lib::db::init_db(&app_dir).unwrap();
        damright_lib::db::source_repo::insert(
            &conn,
            &damright_lib::models::Source {
                id: "src_inbox".to_string(),
                path: inbox_dir.to_str().unwrap().to_string(),
                name: "Inbox".to_string(),
                sync_mode: "pull".to_string(),
                server_path: Some("Inbox".to_string()),
                archive_prefix: None,
                rating_enabled: false,
            },
        ).unwrap();
        damright_lib::db::source_repo::insert(
            &conn,
            &damright_lib::models::Source {
                id: "src_lib".to_string(),
                path: library_dir.to_str().unwrap().to_string(),
                name: "Library".to_string(),
                sync_mode: "push".to_string(),
                server_path: Some("Library".to_string()),
                archive_prefix: None,
                rating_enabled: true,
            },
        ).unwrap();
        damright_lib::db::photo_repo::insert(
            &conn,
            &damright_lib::models::Photo {
                id: "p_cli_test".to_string(),
                path: local_file.to_str().unwrap().to_string(),
                ..damright_lib::models::Photo::default_for_test()
            },
        ).unwrap();
        drop(conn);

        // Server setup
        let server_app_dir = tmp_dir.path().join("server_app");
        fs::create_dir_all(&server_app_dir).unwrap();
        let server_conn = damright_lib::db::init_db(&server_app_dir).unwrap();
        let db_arc = Arc::new(Mutex::new(server_conn));
        let cache_dir = server_app_dir.join("cache");
        fs::create_dir_all(&cache_dir).unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let state = Arc::new(damright_lib::web_server::WebState {
            db: db_arc,
            cache_dir,
            storage_dir: server_storage_dir.clone(),
        });

        let app = axum::Router::new()
            .route("/api/sources", axum::routing::get(damright_lib::web_server::get_sources))
            .route("/api/sync/list", axum::routing::get(damright_lib::web_server::handle_list))
            .with_state(state);

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut cfg = AppConfig::default();
        cfg.server_sync = Some(damright_lib::sync::config::ServerSyncConfig {
            endpoint: format!("http://{}", addr),
            enabled: true,
            debounce_minutes: 10,
            folder_rules: Default::default(),
        });

        let engine = SyncEngine::new(app_dir.clone(), cfg);
        let plan = engine.plan_sync(false).await.expect("Failed to plan dry-run sync");

        assert_eq!(plan.total_files, 2);
        assert_eq!(plan.pull_tasks.len(), 1);
        assert_eq!(plan.push_tasks.len(), 1);
        assert_eq!(plan.delete_tasks.len(), 0);

        // Verify JSON serialization for AI Agents
        let json_plan = serde_json::to_string_pretty(&plan).unwrap();
        assert!(json_plan.contains("photo1.jpg"));
        assert!(json_plan.contains("20260822-local.jpg"));

        // Verify dry run did not touch filesystem
        assert!(!inbox_dir.join("photo1.jpg").exists());
        assert!(!server_storage_dir.join("Library").join("20260822-local.jpg").exists());
    }

    #[tokio::test]
    async fn test_cli_full_sync_execution_operations() {
        let tmp_dir = tempdir().unwrap();
        let app_dir = tmp_dir.path().join("cli_app_full");
        let server_storage_dir = tmp_dir.path().join("server_storage");
        let inbox_dir = tmp_dir.path().join("local_inbox");
        let library_dir = tmp_dir.path().join("local_library");

        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&server_storage_dir).unwrap();
        fs::create_dir_all(&inbox_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();

        // 1. Remote file in inbox to pull
        let server_inbox = server_storage_dir.join("Inbox");
        fs::create_dir_all(&server_inbox).unwrap();
        fs::write(server_inbox.join("incoming.jpg"), b"server-photo-pull").unwrap();

        // 2. Local file to push
        let local_file = library_dir.join("20260901-upload.jpg");
        fs::write(&local_file, b"local-photo-push").unwrap();

        // 3. Previously synced file that is now deleted locally (to test delete task)
        let server_lib = server_storage_dir.join("Library");
        fs::create_dir_all(&server_lib).unwrap();
        fs::write(server_lib.join("old_deleted.jpg"), b"old-content").unwrap();

        // Client DB setup
        let conn = damright_lib::db::init_db(&app_dir).unwrap();
        damright_lib::db::source_repo::insert(
            &conn,
            &damright_lib::models::Source {
                id: "src_inbox".to_string(),
                path: inbox_dir.to_str().unwrap().to_string(),
                name: "Inbox".to_string(),
                sync_mode: "pull".to_string(),
                server_path: Some("Inbox".to_string()),
                archive_prefix: None,
                rating_enabled: false,
            },
        ).unwrap();
        damright_lib::db::source_repo::insert(
            &conn,
            &damright_lib::models::Source {
                id: "src_lib".to_string(),
                path: library_dir.to_str().unwrap().to_string(),
                name: "Library".to_string(),
                sync_mode: "push".to_string(),
                server_path: Some("Library".to_string()),
                archive_prefix: None,
                rating_enabled: true,
            },
        ).unwrap();
        damright_lib::db::photo_repo::insert(
            &conn,
            &damright_lib::models::Photo {
                id: "p_cli_push".to_string(),
                path: local_file.to_str().unwrap().to_string(),
                ..damright_lib::models::Photo::default_for_test()
            },
        ).unwrap();
        // Insert sync state for the deleted file
        damright_lib::db::sync_state_repo::set_sync_state(
            &conn,
            &damright_lib::db::sync_state_repo::SyncStateRecord {
                relative_path: "Library/old_deleted.jpg".to_string(),
                file_size: 11,
                mtime: 1000,
                hash: None,
                last_synced_at: "2026-08-01T00:00:00Z".to_string(),
                status: "synced".to_string(),
            },
        ).unwrap();
        drop(conn);

        // Server setup
        let server_app_dir = tmp_dir.path().join("server_app");
        fs::create_dir_all(&server_app_dir).unwrap();
        let server_conn = damright_lib::db::init_db(&server_app_dir).unwrap();
        let db_arc = Arc::new(Mutex::new(server_conn));
        let cache_dir = server_app_dir.join("cache");
        fs::create_dir_all(&cache_dir).unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let state = Arc::new(damright_lib::web_server::WebState {
            db: db_arc,
            cache_dir,
            storage_dir: server_storage_dir.clone(),
        });

        let app = axum::Router::new()
            .route("/api/sources", axum::routing::get(damright_lib::web_server::get_sources))
            .route("/api/sync/list", axum::routing::get(damright_lib::web_server::handle_list))
            .route("/api/sync/download", axum::routing::get(damright_lib::web_server::handle_download))
            .route("/api/sync/upload", axum::routing::post(damright_lib::web_server::handle_upload))
            .route("/api/sync/notify", axum::routing::post(damright_lib::web_server::handle_notify))
            .route("/api/sync/delete", axum::routing::post(damright_lib::web_server::handle_delete))
            .with_state(state);

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut cfg = AppConfig::default();
        cfg.server_sync = Some(damright_lib::sync::config::ServerSyncConfig {
            endpoint: format!("http://{}", addr),
            enabled: true,
            debounce_minutes: 10,
            folder_rules: Default::default(),
        });

        let engine = SyncEngine::new(app_dir.clone(), cfg);
        let count = engine.run_sync_now().await.expect("Sync execution should succeed");

        assert_eq!(count, 2); // 1 pull + 1 push
        assert!(inbox_dir.join("incoming.jpg").exists());
        assert!(server_storage_dir.join("Library").join("20260901-upload.jpg").exists());
        assert!(!server_storage_dir.join("Library").join("old_deleted.jpg").exists());
    }
}
