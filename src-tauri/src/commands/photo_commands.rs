use tauri::{AppHandle, Manager, State};
use std::path::Path;
use crate::models::Photo;
use crate::processing::{import_folder, update_exposure as update_exposure_logic, update_metadata as update_metadata_logic, update_crop as update_crop_logic};
use crate::DbState;

#[tauri::command]
pub async fn import_photos<R: tauri::Runtime>(
    app: AppHandle<R>,
    folder_path: String,
) -> Result<Vec<Photo>, String> {
    println!("Rust: import_photos command called for path: {}", folder_path);
    let app_dir = crate::get_app_dir(&app).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("damright.db");
    let cache_dir = app_dir.join("cache");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let db_path_copy = db_path.clone();
    let res = crate::handle_blocking!(import_folder(&folder_path, &cache_dir, &db_path_copy, Some(&app)))?;
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = crate::badge::update_inbox_badge(&conn);
    }
    Ok(res)
}

#[tauri::command]
pub async fn refresh_folder<R: tauri::Runtime>(
    app: AppHandle<R>,
    folder_path: String,
) -> Result<Vec<Photo>, String> {
    println!("Rust: refresh_folder command called for path: {}", folder_path);
    let app_dir = crate::get_app_dir(&app).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("damright.db");
    let cache_dir = app_dir.join("cache");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let db_path_copy = db_path.clone();
    let res = crate::handle_blocking!(crate::processing::refresh_folder(&folder_path, &cache_dir, &db_path_copy, Some(&app)))?;
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = crate::badge::update_inbox_badge(&conn);
    }
    Ok(res)
}

#[tauri::command]
pub fn get_all_photos(state: State<DbState>, query: Option<String>) -> Result<Vec<Photo>, String> {
    let conn = state.0.lock().unwrap();
    crate::db::photo_repo::get_all(&conn, query.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_tags(state: State<DbState>) -> Result<Vec<crate::models::TagWithCount>, String> {
    let conn = state.0.lock().unwrap();
    crate::db::photo_repo::get_all_tags(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_people(state: State<DbState>) -> Result<Vec<crate::models::PersonWithCount>, String> {
    let conn = state.0.lock().unwrap();
    crate::db::photo_repo::get_all_people(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_exposure(
    state: State<DbState>,
    id: String,
    exposure: f32,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    update_exposure_logic(&id, exposure, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_portrait_blur(
    state: State<DbState>,
    id: String,
    portrait_blur: f64,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    crate::processing::metadata::update_portrait_blur(&id, portrait_blur, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_metadata(
    state: State<DbState>,
    id: String,
    rating: u8,
    tags: String,
    title: String,
    description: String,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    update_metadata_logic(&id, rating, &tags, &title, &description, &conn).map_err(|e| e.to_string())
}

pub fn apply_tag_delta(
    current_tags_str: &str,
    add_tags: Option<&[String]>,
    remove_tags: Option<&[String]>,
) -> String {
    let mut tags: Vec<String> = current_tags_str
        .split(',')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();

    if let Some(to_remove) = remove_tags {
        tags.retain(|t| !to_remove.iter().any(|r| r.trim().eq_ignore_ascii_case(t)));
    }

    if let Some(to_add) = add_tags {
        for t in to_add {
            let trimmed = t.trim();
            if !trimmed.is_empty() && !tags.iter().any(|c| c.eq_ignore_ascii_case(trimmed)) {
                tags.push(trimmed.to_string());
            }
        }
    }

    tags.join(",")
}

#[tauri::command]
pub fn batch_set_metadata(
    state: State<DbState>,
    ids: Vec<String>,
    rating: Option<u8>,
    tags: Option<String>,
    title: Option<String>,
    description: Option<String>,
    add_tags: Option<Vec<String>>,
    remove_tags: Option<Vec<String>>,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    for id in ids {
        let photo = crate::db::photo_repo::get_by_id(&conn, &id).map_err(|e| e.to_string())?;
        let new_rating = rating.unwrap_or(photo.rating);
        let new_tags = if add_tags.is_some() || remove_tags.is_some() {
            apply_tag_delta(&photo.tags, add_tags.as_deref(), remove_tags.as_deref())
        } else {
            tags.as_deref().unwrap_or(&photo.tags).to_string()
        };
        let new_title = title.as_deref().unwrap_or(photo.title.as_deref().unwrap_or(""));
        let new_description = description.as_deref().unwrap_or(photo.description.as_deref().unwrap_or(""));
        update_metadata_logic(&id, new_rating, &new_tags, new_title, new_description, &conn).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct CaptureDateUpdate {
    pub id: String,
    #[serde(rename = "captureTime")]
    pub capture_time: String,
}

#[tauri::command]
pub fn batch_set_capture_date(
    state: State<DbState>,
    updates: Vec<CaptureDateUpdate>,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    for update in updates {
        crate::processing::update_capture_time(&update.id, &update.capture_time, &conn).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_crop(
    state: State<DbState>,
    id: String,
    top: Option<f64>,
    left: Option<f64>,
    bottom: Option<f64>,
    right: Option<f64>,
    angle: Option<f64>,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    update_crop_logic(&id, top, left, bottom, right, angle, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_rejected(
    state: State<DbState>,
    id: String,
    rejected: bool,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    crate::db::photo_repo::update_rejected(&conn, &id, rejected).map_err(|e| e.to_string())?;
    let _ = crate::badge::update_inbox_badge(&conn);
    Ok(())
}

#[tauri::command]
pub fn get_inbox_count(state: State<DbState>) -> Result<usize, String> {
    let conn = state.0.lock().unwrap();
    crate::badge::get_inbox_count(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_inbox_badge(state: State<DbState>) -> Result<usize, String> {
    let conn = state.0.lock().unwrap();
    crate::badge::update_inbox_badge(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_quick_collection(
    state: State<DbState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    crate::db::photo_repo::toggle_quick_collection(&conn, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_event(
    state: State<DbState>,
    id: String,
    event: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    crate::processing::metadata::update_event(&id, event, &conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn batch_set_event(
    state: State<DbState>,
    ids: Vec<String>,
    event: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    for id in ids {
        crate::processing::metadata::update_event(&id, event.clone(), &conn).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn export_photos<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: crate::processing::ExportConfig,
) -> Result<usize, String> {
    use tauri::Emitter;
    let app_dir = crate::get_app_dir(&app).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("damright.db");

    let app_handle = app.clone();
    crate::handle_blocking!({
        let conn = rusqlite::Connection::open(&db_path)?;
        let cb = move |p: crate::processing::ProgressPayload| {
            let _ = app_handle.emit("export-progress", p);
        };
        crate::processing::export_photos(&conn, config, Some(Box::new(cb)))
    })
}

#[tauri::command]
pub async fn delete_rejected<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    folder_path: String,
) -> Result<usize, String> {
    let app_dir = crate::get_app_dir(&app).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("damright.db");

    let res = crate::handle_blocking!({
        let res: anyhow::Result<usize> = (|| {
            let mut conn = rusqlite::Connection::open(&db_path)?;
            let tx = conn.transaction()?;
            let count = crate::processing::storage::AssetStorage::delete_rejected_in_folder(&tx, &folder_path)?;
            tx.commit()?;
            let _ = crate::badge::update_inbox_badge(&conn);
            Ok(count)
        })();
        res
    })?;
    Ok(res)
}

#[tauri::command]
pub async fn delete_photo<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    println!("Rust: delete_photo command called for ID: {}", id);
    let app_dir = crate::get_app_dir(&app).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("damright.db");

    let res = crate::handle_blocking!({
        let res: anyhow::Result<()> = (|| {
            let mut conn = rusqlite::Connection::open(&db_path)?;
            let tx = conn.transaction()?;
            crate::processing::storage::AssetStorage::delete_photo(&tx, &id)?;
            tx.commit()?;
            let _ = crate::badge::update_inbox_badge(&conn);
            Ok(())
        })();
        res
    })?;
    Ok(res)
}


#[tauri::command]
pub async fn auto_rename<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    id: Option<String>,
) -> Result<usize, String> {
    println!("Rust: auto_rename command called for path: {}", path);
    let app_dir = crate::get_app_dir(&app).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("damright.db");

    let res = crate::handle_blocking!({
        let res: anyhow::Result<usize> = (|| {
            let mut conn = rusqlite::Connection::open(&db_path)?;
            let tx = conn.transaction()?;
            let count = if let Some(photo_id) = id {
                crate::processing::storage::AssetStorage::auto_rename_photo(&tx, &photo_id).map(|_| 1)?
            } else {
                crate::processing::storage::AssetStorage::auto_rename_folder(&tx, &path)?
            };
            tx.commit()?;
            let _ = crate::badge::update_inbox_badge(&conn);
            Ok(count)
        })();
        res
    })?;
    Ok(res)
}

#[tauri::command]
pub async fn move_photos<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    ids: Vec<String>,
    dest_folder: String,
) -> Result<usize, String> {
    println!("Rust: move_photos command called for {} photos to {}", ids.len(), dest_folder);
    let app_dir = crate::get_app_dir(&app).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("damright.db");

    let res = crate::handle_blocking!({
        let res: anyhow::Result<usize> = (|| {
            let mut conn = rusqlite::Connection::open(&db_path)?;
            let tx = conn.transaction()?;
            let count = crate::processing::storage::AssetStorage::move_photos(&tx, &ids, &dest_folder)?;
            tx.commit()?;
            let _ = crate::badge::update_inbox_badge(&conn);
            Ok(count)
        })();
        res
    })?;
    Ok(res)
}

#[tauri::command]
pub async fn move_folder<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    src_path: String,
    dest_path: String,
) -> Result<usize, String> {
    println!("Rust: move_folder command called from '{}' to '{}'", src_path, dest_path);
    let app_dir = crate::get_app_dir(&app).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("damright.db");

    let src_clone_for_blocking = src_path.clone();
    let dest_clone_for_blocking = dest_path.clone();
    let db_path_clone = db_path.clone();

    let count = crate::handle_blocking!({
        let res: anyhow::Result<usize> = (|| {
            let mut conn = rusqlite::Connection::open(&db_path_clone)?;
            let tx = conn.transaction()?;
            let count = crate::processing::storage::AssetStorage::move_folder(&tx, &src_clone_for_blocking, &dest_clone_for_blocking)?;
            tx.commit()?;
            let _ = crate::badge::update_inbox_badge(&conn);
            Ok(count)
        })();
        res
    })?;

    // Try server sync move in background if sync is configured and enabled
    if let Ok(config) = crate::sync::config::load_config() {
        if let Some(ref server_sync) = config.server_sync {
            if server_sync.enabled {
                let endpoint = server_sync.endpoint.clone();
                let src_clone = src_path.clone();
                let dest_clone = dest_path.clone();
                tokio::spawn(async move {
                    let _ = crate::sync::sync_engine::try_server_folder_move(db_path, &endpoint, &src_clone, &dest_clone).await;
                });
            }
        }
    }

    Ok(count)
}

#[tauri::command]
pub async fn get_preview<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    photo: Photo,
    uncropped: Option<bool>,
) -> Result<String, String> {
    println!("Rust: get_preview command for: {}, uncropped: {:?}", photo.path, uncropped);
    let thumb_path = Path::new(&photo.thumb_path);
    let cache_dir = if thumb_path.to_string_lossy().contains("thumbnails") {
        thumb_path
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
    } else {
        thumb_path.parent().map(|p| p.to_path_buf())
    };
    let cache_dir = cache_dir.ok_or_else(|| "Invalid thumbnail path".to_string())?;
    
    let is_uncropped = uncropped.unwrap_or(false);
    crate::handle_blocking!(crate::processing::get_preview_image(&photo, &cache_dir, is_uncropped))
}

#[derive(serde::Serialize)]
pub struct PhotoData {
    pub data: Vec<u8>,
    pub mime_type: String,
}

#[tauri::command]
pub fn get_photo_data<R: tauri::Runtime>(app: tauri::AppHandle<R>, path: String) -> Result<PhotoData, String> {
    println!("Rust: Requesting photo data for: {}", path);
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "heic" || ext == "heif" {
        #[cfg(target_os = "macos")]
        {
            println!("Rust: HEIC detected, converting to JPEG for webview compatibility via sips");
            if let Ok(temp_dir) = app.path().app_cache_dir() {
                let _ = std::fs::create_dir_all(&temp_dir);
                let temp_path = temp_dir.join(format!("{}.jpg", uuid::Uuid::new_v4()));
                
                if let Ok(status) = std::process::Command::new("sips")
                    .arg("-s")
                    .arg("format")
                    .arg("jpeg")
                    .arg(&path)
                    .arg("--out")
                    .arg(&temp_path)
                    .status()
                {
                    if status.success() {
                        if let Ok(data) = std::fs::read(&temp_path) {
                            let _ = std::fs::remove_file(temp_path);
                            return Ok(PhotoData { data, mime_type: "image/jpeg".to_string() });
                        }
                    }
                }
            }
        }

        println!("Rust: Decoding HEIC via RustImageProcessor for webview compatibility");
        let processor = crate::processing::image::RustImageProcessor;
        let img = processor.load_image(std::path::Path::new(&path))
            .map_err(|e| format!("HEIC decoding failed: {}", e))?;
        let mut jpeg_bytes = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut jpeg_bytes), image::ImageFormat::Jpeg)
            .map_err(|e| format!("HEIC encoding to JPEG failed: {}", e))?;
        return Ok(PhotoData { data: jpeg_bytes, mime_type: "image/jpeg".to_string() });
    }

    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mime_type = crate::processing::get_mime_type(&ext);

    Ok(PhotoData { data, mime_type })
}

#[tauri::command]
pub async fn fix_all_validation_issues<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    ids: Option<Vec<String>>,
) -> Result<usize, String> {
    println!("Rust: fix_all_validation_issues command called with {:?}", ids);
    let app_dir = crate::get_app_dir(&app).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("damright.db");

    crate::handle_blocking!({
        let res: anyhow::Result<usize> = (|| {
            let mut conn = rusqlite::Connection::open(&db_path)?;
            let tx = conn.transaction()?;
            let count = crate::processing::audit::fix_validation_issues(&tx, ids)?;
            tx.commit()?;
            Ok(count)
        })();
        res
    })
}

#[tauri::command]
pub fn get_ranking_pair(
    state: State<DbState>,
    query: Option<String>,
) -> Result<Option<crate::models::RankingPair>, String> {
    let conn = state.0.lock().unwrap();
    crate::processing::ranking::get_ranking_pair(&conn, query.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_ranking_match(
    state: State<DbState>,
    winner_id: String,
    loser_id: String,
    is_tie: Option<bool>,
) -> Result<crate::models::RankingMatchResult, String> {
    let conn = state.0.lock().unwrap();
    crate::processing::ranking::record_ranking_match(
        &conn,
        &winner_id,
        &loser_id,
        is_tie.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_ranking_quad(
    state: State<DbState>,
    query: Option<String>,
) -> Result<Option<crate::models::RankingQuad>, String> {
    let conn = state.0.lock().unwrap();
    crate::processing::ranking::get_ranking_quad(&conn, query.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_ranking_quad_match(
    state: State<DbState>,
    winner_id: Option<String>,
    loser_ids: Vec<String>,
    is_tie: Option<bool>,
) -> Result<Vec<crate::models::PhotoScoreUpdate>, String> {
    let conn = state.0.lock().unwrap();
    crate::processing::ranking::record_ranking_quad_match(
        &conn,
        winner_id.as_deref(),
        &loser_ids,
        is_tie.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_ranking_stats(
    state: State<DbState>,
    query: Option<String>,
) -> Result<crate::models::RankingStats, String> {
    let conn = state.0.lock().unwrap();
    crate::processing::ranking::get_ranking_stats(&conn, query.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_suggested_ratings(
    state: State<DbState>,
    ids: Option<Vec<String>>,
) -> Result<u32, String> {
    let conn = state.0.lock().unwrap();
    crate::processing::ranking::apply_suggested_ratings(&conn, ids).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_tag_delta_add_only() {
        let current = "nature, landscape";
        let add = vec!["vacation".to_string()];
        let res = apply_tag_delta(current, Some(&add), None);
        assert_eq!(res, "nature,landscape,vacation");
    }

    #[test]
    fn test_apply_tag_delta_remove_only() {
        let current = "nature, landscape, vacation";
        let remove = vec!["landscape".to_string()];
        let res = apply_tag_delta(current, None, Some(&remove));
        assert_eq!(res, "nature,vacation");
    }

    #[test]
    fn test_apply_tag_delta_add_and_remove() {
        let current = "nature, landscape";
        let add = vec!["vacation".to_string(), "travel".to_string()];
        let remove = vec!["nature".to_string()];
        let res = apply_tag_delta(current, Some(&add), Some(&remove));
        assert_eq!(res, "landscape,vacation,travel");
    }

    #[test]
    fn test_apply_tag_delta_case_insensitivity() {
        let current = "Nature, Landscape";
        let add = vec!["nature".to_string(), "Urban".to_string()];
        let remove = vec!["LANDSCAPE".to_string()];
        let res = apply_tag_delta(current, Some(&add), Some(&remove));
        // "nature" shouldn't be duplicated because "Nature" exists. "LANDSCAPE" should be removed.
        assert_eq!(res, "Nature,Urban");
    }

    #[test]
    fn test_apply_tag_delta_empty_initial() {
        let current = "";
        let add = vec!["tagB".to_string()];
        let res = apply_tag_delta(current, Some(&add), None);
        assert_eq!(res, "tagB");
    }
}

