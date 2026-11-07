#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;
    use tauri::test::{mock_builder};
    use tauri::Manager;
    use damright_lib::commands::{get_preview};
    use damright_lib::DbState;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn test_get_preview_follows_thumb_path() {
        // 1. Setup temporary environment
        let tmp_dir = tempdir().unwrap();
        // Use a sub-path that is unlikely to exist in real app data
        let app_data_dir = tmp_dir.path().join("app_data_test_lifecycle");
        let cache_dir = app_data_dir.join("cache");
        
        fs::create_dir_all(&cache_dir).unwrap();

        // 2. Initialize Mock App with DbState
        let app = mock_builder()
            .setup(move |app| {
                let conn = damright_lib::db::init_db(&app_data_dir).unwrap();
                app.manage(DbState(Arc::new(Mutex::new(conn))));
                Ok(())
            })
            .build(tauri::generate_context!("../src-tauri/tauri.conf.json"))
            .unwrap();
        
        let handle = app.handle();

        // 3. Prepare dummy test assets
        let test_assets_dir = tmp_dir.path().join("assets");
        fs::create_dir_all(&test_assets_dir).unwrap();
        let img_path = test_assets_dir.join("test.jpg");
        
        let img = image::DynamicImage::ImageRgb8(image::ImageBuffer::new(1, 1));
        img.save(&img_path).unwrap();

        let path_str = img_path.to_string_lossy().to_string();
        let path_hash = blake3::hash(path_str.as_bytes()).to_string();
        let prefix = &path_hash[0..2];
        let thumb_path = cache_dir.join("thumbnails").join(prefix).join(format!("{}.jpg", path_hash));
        fs::create_dir_all(thumb_path.parent().unwrap()).unwrap();

        // 4. Create a Photo object with a thumb_path pointing to our mock cache
        // In the real app, this is created by import_photos.
        // By setting thumb_path manually, we verify that get_preview derives the preview path correctly.
        let photo = damright_lib::models::Photo {
            id: "test-lifecycle-id".to_string(),
            path: img_path.to_string_lossy().to_string(),
            thumb_path: thumb_path.to_string_lossy().to_string(),
            ..damright_lib::models::Photo::default_for_test()
        };

        let preview_path_str = get_preview(
            handle.clone(),
            photo.clone(),
            None
        ).await.expect("Get preview failed");

        let preview_path = Path::new(&preview_path_str);
        
        // 6. Final Validation
        assert!(preview_path.exists(), "Preview file should exist at {}", preview_path_str);
        assert!(preview_path_str.contains("app_data_test_lifecycle"), "Preview path should be within our mock app_data_dir");
        assert!(preview_path_str.contains("previews"), "Preview path should contain 'previews' subdirectory");
        
        println!("Success: Lifecycle verified. Preview at: {}", preview_path_str);
    }
}
