#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    #[test]
    fn test_server_database_initialization() {
        let tmp_dir = tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app_data_server_test");
        std::fs::create_dir_all(&app_dir).unwrap();

        let conn = damright_lib::db::init_db(&app_dir).expect("Failed to init server db");
        let shared_conn = Arc::new(Mutex::new(conn));

        let photos = damright_lib::db::photo_repo::get_all(&shared_conn.lock().unwrap(), None)
            .expect("Failed to query photos from server db");
        
        assert_eq!(photos.len(), 0);
    }

    #[test]
    fn test_direct_file_upload_flat_storage() {
        let tmp_dir = tempdir().unwrap();
        let storage_dir = tmp_dir.path().join("photos");
        let target_file = storage_dir.join("2026/08-14/IMG_0930.HEIC");
        std::fs::create_dir_all(target_file.parent().unwrap()).unwrap();

        std::fs::write(&target_file, b"test-image-content").unwrap();
        assert!(target_file.exists());
        assert_eq!(std::fs::read_to_string(&target_file).unwrap(), "test-image-content");
    }

    #[tokio::test]
    async fn test_get_asset_thumbnail_and_cache_control() {
        use axum::extract::{Query, State};
        use axum::http::StatusCode;

        let tmp_dir = tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app_data");
        let cache_dir = app_dir.join("cache");
        let storage_dir = app_dir.join("storage");
        std::fs::create_dir_all(&cache_dir).unwrap();
        std::fs::create_dir_all(&storage_dir).unwrap();

        let conn = damright_lib::db::init_db(&app_dir).unwrap();

        // Create a dummy JPEG image in storage
        let img = image::DynamicImage::ImageRgb8(image::ImageBuffer::new(100, 100));
        let img_path = storage_dir.join("sample.jpg");
        img.save(&img_path).unwrap();

        let thumb_path = damright_lib::processing::image::get_thumbnail_path(&img_path, &cache_dir);
        assert!(!thumb_path.exists(), "Thumbnail should not exist before request");

        let photo = damright_lib::models::Photo {
            id: "test-photo-1".to_string(),
            path: img_path.to_string_lossy().to_string(),
            thumb_path: thumb_path.to_string_lossy().to_string(),
            ..damright_lib::models::Photo::default_for_test()
        };
        damright_lib::db::photo_repo::insert(&conn, &photo).unwrap();

        let state = Arc::new(damright_lib::web_server::WebState {
            db: Arc::new(Mutex::new(conn)),
            cache_dir: cache_dir.clone(),
            storage_dir: storage_dir.clone(),
        });

        // Request asset using relative thumbnail path
        let rel_thumb = thumb_path.strip_prefix(&cache_dir).unwrap().to_string_lossy().to_string();
        let query = damright_lib::web_server::AssetQuery {
            path: rel_thumb.clone(),
            thumb: Some(true),
            v: None,
        };

        let req = axum::extract::Request::builder()
            .uri("/api/asset")
            .body(axum::body::Body::empty())
            .unwrap();
        let response = damright_lib::web_server::get_asset(
            State(Arc::clone(&state)),
            Query(query),
            req,
        ).await;

        assert_eq!(response.status(), StatusCode::OK);
        assert!(thumb_path.exists(), "Thumbnail should have been generated on demand on disk");
        
        let etag = response.headers().get("etag").expect("ETag header should be present").to_str().unwrap().to_string();
        let cache_ctrl = response.headers().get("cache-control").expect("Cache-Control header should be present").to_str().unwrap();
        assert!(cache_ctrl.contains("stale-while-revalidate"));

        // Test conditional 304 Not Modified request
        let query_304 = damright_lib::web_server::AssetQuery {
            path: rel_thumb.clone(),
            thumb: Some(true),
            v: None,
        };
        let req_304 = axum::extract::Request::builder()
            .uri("/api/asset")
            .header(axum::http::header::IF_NONE_MATCH, etag)
            .body(axum::body::Body::empty())
            .unwrap();
        let response_304 = damright_lib::web_server::get_asset(
            State(Arc::clone(&state)),
            Query(query_304),
            req_304,
        ).await;
        assert_eq!(response_304.status(), StatusCode::NOT_MODIFIED);

        // Test versioned immutable caching
        let query_versioned = damright_lib::web_server::AssetQuery {
            path: rel_thumb,
            thumb: Some(true),
            v: Some("12345".to_string()),
        };
        let req_versioned = axum::extract::Request::builder()
            .uri("/api/asset")
            .body(axum::body::Body::empty())
            .unwrap();
        let response_versioned = damright_lib::web_server::get_asset(
            State(state.clone()),
            Query(query_versioned),
            req_versioned,
        ).await;
        assert_eq!(response_versioned.status(), StatusCode::OK);
        let versioned_cache = response_versioned.headers().get("cache-control").unwrap().to_str().unwrap();
        assert!(versioned_cache.contains("immutable"));
    }

    #[tokio::test]
    async fn test_video_asset_streaming_and_ranges() {
        use axum::extract::{Query, State};
        use axum::http::StatusCode;

        let tmp_dir = tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app_data");
        let cache_dir = app_dir.join("cache");
        let storage_dir = app_dir.join("storage");
        std::fs::create_dir_all(&cache_dir).unwrap();
        std::fs::create_dir_all(&storage_dir).unwrap();

        let conn = damright_lib::db::init_db(&app_dir).unwrap();

        // Create a dummy MP4 video file
        let video_path = storage_dir.join("clip.mp4");
        std::fs::write(&video_path, b"fake-mp4-video-content-header-and-frames-1234567890").unwrap();

        let state = Arc::new(damright_lib::web_server::WebState {
            db: Arc::new(Mutex::new(conn)),
            cache_dir: cache_dir.clone(),
            storage_dir: storage_dir.clone(),
        });

        // Test video request with Range header
        let query = damright_lib::web_server::AssetQuery {
            path: video_path.to_string_lossy().to_string(),
            thumb: None,
            v: None,
        };

        let req = axum::extract::Request::builder()
            .uri("/api/asset")
            .header("Range", "bytes=0-10")
            .body(axum::body::Body::empty())
            .unwrap();

        let response = damright_lib::web_server::get_asset(
            State(state),
            Query(query),
            req,
        ).await;

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers().get("content-range").unwrap(), "bytes 0-10/51");
    }

    #[tokio::test]
    async fn test_handle_delete_and_refresh_cleans_db() {
        use axum::extract::{Query, State};
        use axum::http::StatusCode;

        let tmp_dir = tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app_data_del_test");
        let cache_dir = app_dir.join("cache");
        let storage_dir = app_dir.join("storage");
        std::fs::create_dir_all(&cache_dir).unwrap();
        let inbox_dir = storage_dir.join("Inbox");
        std::fs::create_dir_all(&inbox_dir).unwrap();

        let conn = damright_lib::db::init_db(&app_dir).unwrap();
        let db_path = app_dir.join("damright.db");

        // Insert default storage source
        damright_lib::db::source_repo::insert(&conn, &damright_lib::models::Source {
            id: "default_storage".to_string(),
            path: storage_dir.to_str().unwrap().to_string(),
            name: "Server Storage".to_string(),
            sync_mode: "none".to_string(),
            server_path: None,
            archive_prefix: None,
            rating_enabled: true,
        }).unwrap();

        // Create 2 files in Inbox
        let file1 = inbox_dir.join("IMG_0001.jpg");
        let file2 = inbox_dir.join("IMG_0002.jpg");
        std::fs::write(&file1, b"jpg1").unwrap();
        std::fs::write(&file2, b"jpg2").unwrap();

        // Index the folder
        damright_lib::processing::import_folder_headless(
            storage_dir.to_str().unwrap(),
            &cache_dir,
            &db_path,
        ).unwrap();

        let photos = damright_lib::db::photo_repo::get_all(&conn, None).unwrap();
        assert_eq!(photos.len(), 2);

        let shared_conn = Arc::new(Mutex::new(conn));
        let state = Arc::new(damright_lib::web_server::WebState {
            db: shared_conn.clone(),
            cache_dir: cache_dir.clone(),
            storage_dir: storage_dir.clone(),
        });

        // 1. Delete file1 via handle_delete
        let query_del = damright_lib::web_server::DeleteQuery {
            path: "Inbox/IMG_0001.jpg".to_string(),
        };
        let res = damright_lib::web_server::handle_delete(State(state.clone()), Query(query_del)).await;
        let resp = axum::response::IntoResponse::into_response(res);
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(!file1.exists(), "file1 should be deleted from disk");

        // Check DB: file1 should be deleted from DB
        let photos_after_del = damright_lib::db::photo_repo::get_all(&shared_conn.lock().unwrap(), None).unwrap();
        assert_eq!(photos_after_del.len(), 1, "DB should have only 1 photo left after handle_delete");

        // 2. Simulate moving/sorting file2 externally (deleting from disk)
        std::fs::remove_file(&file2).unwrap();
        assert!(!file2.exists());

        // Refresh folder on the server
        damright_lib::processing::refresh_folder_headless(
            storage_dir.to_str().unwrap(),
            &cache_dir,
            &db_path,
        ).unwrap();

        let photos_after_refresh = damright_lib::db::photo_repo::get_all(&shared_conn.lock().unwrap(), None).unwrap();
        assert_eq!(photos_after_refresh.len(), 0, "DB should be completely clean after refresh_folder_headless");
    }

    #[tokio::test]
    async fn test_server_handle_move() {
        use axum::extract::{Json, State};
        use axum::http::StatusCode;

        let tmp_dir = tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app_data");
        let cache_dir = app_dir.join("cache");
        let storage_dir = app_dir.join("storage");
        let src_folder = storage_dir.join("Library/2026/08-04");
        std::fs::create_dir_all(&cache_dir).unwrap();
        std::fs::create_dir_all(&src_folder).unwrap();

        let file = src_folder.join("photo.jpg");
        std::fs::write(&file, b"test-data").unwrap();

        let conn = damright_lib::db::init_db(&app_dir).unwrap();
        let shared_conn = Arc::new(Mutex::new(conn));
        let state = Arc::new(damright_lib::web_server::WebState {
            db: shared_conn,
            cache_dir,
            storage_dir: storage_dir.clone(),
        });

        let payload = damright_lib::web_server::MoveFolderPayload {
            src: "Library/2026/08-04".to_string(),
            dest: "Library/2026/08-04 Birthday".to_string(),
        };

        let res = damright_lib::web_server::handle_move(State(state), Json(payload)).await;
        let resp = axum::response::IntoResponse::into_response(res);
        assert_eq!(resp.status(), StatusCode::OK);

        assert!(!src_folder.exists());
        let dest_folder = storage_dir.join("Library/2026/08-04 Birthday");
        assert!(dest_folder.exists());
        assert!(dest_folder.join("photo.jpg").exists());
    }
}


