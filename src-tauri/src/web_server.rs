use axum::{
    extract::{DefaultBodyLimit, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower::ServiceExt;
use std::path::PathBuf;

use axum::routing::post;

pub struct WebState {
    pub db: Arc<Mutex<Connection>>,
    pub cache_dir: PathBuf,
    pub storage_dir: PathBuf,
}

#[derive(Deserialize)]
pub struct PhotoQuery {
    pub query: Option<String>,
}

#[derive(Deserialize)]
pub struct AssetQuery {
    pub path: String,
    pub thumb: Option<bool>,
    pub v: Option<String>,
}

#[derive(Deserialize)]
pub struct UploadQuery {
    pub path: String,
    pub mtime: Option<i64>,
}

#[derive(Deserialize)]
pub struct NotifyPayload {
    pub updated_paths: Vec<String>,
}

pub async fn start_server(db: Arc<Mutex<Connection>>, cache_dir: PathBuf) {
    let storage_dir = if let Ok(custom_dir) = std::env::var("DAMRIGHT_STORAGE_DIR") {
        PathBuf::from(custom_dir)
    } else if std::path::Path::new("/data/photos").exists() {
        PathBuf::from("/data/photos")
    } else {
        cache_dir.parent().unwrap_or(&cache_dir).join("photos")
    };
    let _ = std::fs::create_dir_all(&storage_dir);
    println!("Web server flat photo storage directory: {:?}", storage_dir);

    let state = Arc::new(WebState { db, cache_dir, storage_dir });

    // Spawn initial indexing of storage_dir in the background so uploaded files on disk get registered into SQLite
    let init_state = Arc::clone(&state);
    tokio::task::spawn_blocking(move || {
        let conn = init_state.db.lock().unwrap();
        let db_path = init_state.cache_dir.parent().unwrap_or(&init_state.cache_dir).join("damright.db");
        ensure_default_storage_source(&conn, &init_state.storage_dir);
        drop(conn);

        if init_state.storage_dir.exists() {
            println!("Web server: Refreshing photos in storage directory {:?}", init_state.storage_dir);
            match crate::processing::refresh_folder_headless(
                init_state.storage_dir.to_str().unwrap_or(""),
                &init_state.cache_dir,
                &db_path,
            ) {
                Ok(photos) => println!("Web server: Successfully refreshed {} photos from storage directory", photos.len()),
                Err(e) => println!("Web server: Error refreshing storage directory: {}", e),
            }
        }
    });

    // Try to find the dist folder. 
    // In dev (running from src-tauri), it's at ../dist
    // In prod, it might be next to the binary.
    let dist_path = if std::path::Path::new("dist").exists() {
        PathBuf::from("dist")
    } else if std::path::Path::new("../dist").exists() {
        PathBuf::from("../dist")
    } else {
        println!("Warning: could not find 'dist' folder for static assets");
        PathBuf::from("dist")
    };

    let index_path = dist_path.join("web.html");

    let app = Router::new()
        .route("/api/photos", get(get_photos))
        .route("/api/tags", get(get_tags))
        .route("/api/people", get(get_people))
        .route("/api/sources", get(get_sources))
        .route("/api/tree", get(get_tree))
        .route("/api/asset", get(get_asset))
        .route("/api/preview", get(get_preview))
        .route("/api/sync/upload", post(handle_upload))
        .route("/api/sync/download", get(handle_download))
        .route("/api/sync/delete", post(handle_delete))
        .route("/api/sync/move", post(handle_move))
        .route("/api/sync/list", get(handle_list))
        .route("/api/sync/notify", post(handle_notify))
        .fallback_service(
            ServeDir::new(&dist_path)
                .append_index_html_on_directories(false)
                .fallback(ServeFile::new(index_path))
        )
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8010);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Web server listening on http://{}", addr);
    if dist_path.exists() {
        println!("Serving static assets from: {:?}", dist_path.canonicalize().unwrap_or(dist_path));
    }

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn get_photos(
    State(state): State<Arc<WebState>>,
    Query(params): Query<PhotoQuery>,
) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::db::photo_repo::get_all(&conn, params.query.as_deref()) {
        Ok(photos) => (StatusCode::OK, Json(photos)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn get_tags(State(state): State<Arc<WebState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::db::photo_repo::get_all_tags(&conn) {
        Ok(tags) => (StatusCode::OK, Json(tags)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn get_people(State(state): State<Arc<WebState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::db::photo_repo::get_all_people(&conn) {
        Ok(people) => (StatusCode::OK, Json(people)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn get_sources(State(state): State<Arc<WebState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::db::source_repo::get_all(&conn) {
        Ok(sources) => (StatusCode::OK, Json(sources)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
pub struct TreeQuery {
    pub path: String,
}

async fn get_tree(
    State(state): State<Arc<WebState>>,
    Query(params): Query<TreeQuery>,
) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::processing::get_dir_tree(&conn, &params.path) {
        Ok(tree) => (StatusCode::OK, Json(tree)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

pub async fn get_asset(
    State(state): State<Arc<WebState>>,
    Query(params): Query<AssetQuery>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let clean_path = params.path.trim().replace('\\', "/");
    if has_parent_dir_traversal(&clean_path) {
        return (StatusCode::BAD_REQUEST, "Invalid path parameter").into_response();
    }

    let is_thumb = params.thumb.unwrap_or(false) || clean_path.contains("thumbnails");

    // Look up matching photo or allowed roots from DB
    let (matched_photo, allowed_roots) = if let Ok(conn) = state.db.lock() {
        let photos = crate::db::photo_repo::get_all(&conn, None).unwrap_or_default();
        let sources = crate::db::source_repo::get_all(&conn).unwrap_or_default();
        let mut roots: Vec<PathBuf> = sources.into_iter().map(|s| PathBuf::from(s.path)).collect();
        roots.push(state.cache_dir.clone());
        roots.push(state.storage_dir.clone());

        let found = photos.into_iter().find(|p| {
            let p_thumb_norm = p.thumb_path.replace('\\', "/");
            let p_path_norm = p.path.replace('\\', "/");
            p_thumb_norm == clean_path
                || p_path_norm == clean_path
                || (!clean_path.is_empty() && (
                    p_thumb_norm.ends_with(&clean_path)
                    || p_path_norm.ends_with(&clean_path)
                    || clean_path.ends_with(&p_thumb_norm)
                    || ( !p_path_norm.is_empty() && clean_path.ends_with(&p_path_norm) )
                ))
        });
        (found, roots)
    } else {
        (None, vec![state.cache_dir.clone(), state.storage_dir.clone()])
    };

    let is_allowed_path = |candidate: &std::path::Path| -> bool {
        if matched_photo.as_ref().is_some_and(|p| {
            std::path::Path::new(&p.path) == candidate || std::path::Path::new(&p.thumb_path) == candidate
        }) {
            return true;
        }
        let canon_cand = candidate.canonicalize().unwrap_or_else(|_| candidate.to_path_buf());
        allowed_roots.iter().any(|root| {
            let canon_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
            canon_cand.starts_with(&canon_root) || candidate.starts_with(root)
        })
    };

    let target_path = if is_thumb {
        // 1. Resolve candidate thumb_path in local state.cache_dir
        let thumb_path = if let Some(idx) = clean_path.find("thumbnails") {
            let rel_thumb = &clean_path[idx..];
            state.cache_dir.join(rel_thumb)
        } else {
            let raw_path = std::path::Path::new(&clean_path);
            crate::processing::image::get_thumbnail_path(raw_path, &state.cache_dir)
        };

        // 2. If thumbnail doesn't exist, try to generate it on demand (supports images and videos)
        if !thumb_path.exists() {
            if let Some(ref photo) = matched_photo {
                let media_path = std::path::Path::new(&photo.path);
                if media_path.exists() {
                    let _ = crate::processing::image::generate_thumbnail_image(photo, &thumb_path);
                }
            } else {
                let raw_path = std::path::Path::new(&clean_path);
                if raw_path.exists() && is_allowed_path(raw_path) {
                    let photo = crate::models::Photo {
                        path: raw_path.to_string_lossy().to_string(),
                        thumb_path: thumb_path.to_string_lossy().to_string(),
                        ..crate::models::Photo::default_for_test()
                    };
                    let _ = crate::processing::image::generate_thumbnail_image(&photo, &thumb_path);
                }
            }
        }

        if thumb_path.exists() {
            thumb_path
        } else {
            std::path::PathBuf::from(&clean_path)
        }
    } else {
        let raw_path = std::path::Path::new(&clean_path);
        if raw_path.exists() {
            raw_path.to_path_buf()
        } else if let Some(ref photo) = matched_photo {
            std::path::PathBuf::from(&photo.path)
        } else {
            let storage_candidate = state.storage_dir.join(clean_path.trim_start_matches('/'));
            if storage_candidate.exists() {
                storage_candidate
            } else {
                raw_path.to_path_buf()
            }
        }
    };

    if !is_allowed_path(&target_path) {
        return (StatusCode::FORBIDDEN, "Access denied").into_response();
    }

    if !target_path.exists() {
        return (StatusCode::NOT_FOUND, "File not found").into_response();
    }

    let metadata = std::fs::metadata(&target_path).ok();
    let mtime = metadata
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let file_size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
    let etag = format!("\"{:x}-{:x}\"", file_size, mtime);

    let cache_header = if params.v.is_some() {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=86400, stale-while-revalidate=604800"
    };

    if req.headers().get(axum::http::header::RANGE).is_none() {
        if let Some(if_none_match) = req.headers().get(axum::http::header::IF_NONE_MATCH) {
            if if_none_match.to_str().unwrap_or("") == etag {
                return (
                    StatusCode::NOT_MODIFIED,
                    [
                        ("etag", etag),
                        ("cache-control", cache_header.to_string()),
                    ],
                ).into_response();
            }
        }
    }

    let ext = target_path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if ext == "heic" || ext == "heif" {
        let processor = crate::processing::image::RustImageProcessor;
        if let Ok(img) = processor.load_image(&target_path) {
            let mut data = Vec::new();
            if img.write_to(&mut std::io::Cursor::new(&mut data), image::ImageFormat::Jpeg).is_ok() {
                return (
                    StatusCode::OK,
                    [
                        ("content-type", "image/jpeg".to_string()),
                        ("etag", etag),
                        ("cache-control", cache_header.to_string()),
                    ],
                    data,
                ).into_response();
            }
        }
    }

    // Serve all other files (including videos with full HTTP 206 Range seeking support) via ServeFile
    match ServeFile::new(&target_path).oneshot(req).await {
        Ok(mut resp) => {
            resp.headers_mut().insert(
                axum::http::header::CACHE_CONTROL,
                cache_header.parse().unwrap(),
            );
            if let Ok(val) = etag.parse() {
                resp.headers_mut().insert(axum::http::header::ETAG, val);
            }
            resp.into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
pub struct PreviewQuery {
    pub id: String,
    pub uncropped: Option<bool>,
    pub v: Option<String>,
}

async fn get_preview(
    State(state): State<Arc<WebState>>,
    headers: axum::http::HeaderMap,
    Query(params): Query<PreviewQuery>,
) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    let photo = match crate::db::photo_repo::get_by_id(&conn, &params.id) {
        Ok(p) => p,
        Err(e) => return (StatusCode::NOT_FOUND, e.to_string()).into_response(),
    };

    let cache_dir = state.cache_dir.clone();
    
    // Release the lock before doing heavy image processing
    drop(conn);

    let is_uncropped = params.uncropped.unwrap_or(false);
    match crate::processing::get_preview_image(&photo, &cache_dir, is_uncropped) {
        Ok(preview_path) => {
            let path = std::path::Path::new(&preview_path);
            let metadata = std::fs::metadata(path).ok();
            let mtime = metadata
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let file_size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let etag = format!("\"{:x}-{:x}\"", file_size, mtime);

            let cache_header = if params.v.is_some() {
                "public, max-age=31536000, immutable"
            } else {
                "public, max-age=86400, stale-while-revalidate=604800"
            };

            if let Some(if_none_match) = headers.get(axum::http::header::IF_NONE_MATCH) {
                if if_none_match.to_str().unwrap_or("") == etag {
                    return (
                        StatusCode::NOT_MODIFIED,
                        [
                            ("etag", etag),
                            ("cache-control", cache_header.to_string()),
                        ],
                    ).into_response();
                }
            }

            match std::fs::read(path) {
                Ok(data) => {
                    let mime = mime_guess::from_path(path).first_or_octet_stream().to_string();
                    (
                        StatusCode::OK,
                        [
                            ("content-type", mime),
                            ("etag", etag),
                            ("cache-control", cache_header.to_string()),
                        ],
                        data,
                    ).into_response()
                }
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

fn ensure_default_storage_source(conn: &rusqlite::Connection, storage_dir: &std::path::Path) {
    if let Ok(sources) = crate::db::source_repo::get_all(conn) {
        if sources.is_empty() {
            let _ = crate::db::source_repo::insert(conn, &crate::models::Source {
                id: "default_storage".to_string(),
                path: storage_dir.to_str().unwrap_or("").to_string(),
                name: "Server Storage".to_string(),
                sync_mode: "none".to_string(),
                server_path: None,
                archive_prefix: None,
                rating_enabled: true,
            });
        }
    }
}

fn has_parent_dir_traversal(path_str: &str) -> bool {
    let normalized = path_str.replace('\\', "/");
    std::path::Path::new(&normalized)
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
}

fn is_safe_relative_path(rel_path: &str) -> bool {
    let trimmed = rel_path.trim().trim_start_matches('/');
    if trimmed.is_empty() || has_parent_dir_traversal(trimmed) {
        return false;
    }
    let normalized = trimmed.replace('\\', "/");
    !std::path::Path::new(&normalized).components().any(|c| {
        matches!(
            c,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    })
}

fn resolve_target_path(storage_dir: &std::path::Path, rel_path: &str) -> PathBuf {
    let clean_rel = rel_path.trim_start_matches('/').replace('\\', "/");
    storage_dir.join(clean_rel)
}

pub async fn handle_upload(
    State(state): State<Arc<WebState>>,
    Query(params): Query<UploadQuery>,
    body: axum::body::Body,
) -> impl IntoResponse {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let rel_path = params.path.trim_start_matches('/');
    if !is_safe_relative_path(rel_path) {
        return (StatusCode::BAD_REQUEST, "Invalid path parameter").into_response();
    }

    let target_path = resolve_target_path(&state.storage_dir, rel_path);
    if let Some(parent) = target_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create directories: {}", e)).into_response();
        }
    }

    let temp_path = target_path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    let mut file = match tokio::fs::File::create(&temp_path).await {
        Ok(f) => f,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to create temp file: {}", e)).into_response(),
    };

    let mut stream = body.into_data_stream();
    while let Some(chunk_res) = stream.next().await {
        match chunk_res {
            Ok(chunk) => {
                if let Err(e) = file.write_all(&chunk).await {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write chunk: {}", e)).into_response();
                }
            }
            Err(e) => {
                let _ = tokio::fs::remove_file(&temp_path).await;
                return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to read stream chunk: {}", e)).into_response();
            }
        }
    }

    if let Err(e) = file.flush().await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to flush temp file: {}", e)).into_response();
    }
    drop(file);

    if let Some(mtime) = params.mtime {
        let ft = filetime::FileTime::from_unix_time(mtime, 0);
        let _ = filetime::set_file_mtime(&temp_path, ft);
    }

    if let Err(e) = tokio::fs::rename(&temp_path, &target_path).await {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to finalize file rename: {}", e)).into_response();
    }

    (StatusCode::OK, Json(serde_json::json!({ "status": "ok", "path": rel_path }))).into_response()
}

pub async fn handle_notify(
    State(state): State<Arc<WebState>>,
    Json(payload): Json<NotifyPayload>,
) -> impl IntoResponse {
    println!("Direct Sync Notification: Received {} updated paths", payload.updated_paths.len());
    let storage_dir = state.storage_dir.clone();
    let cache_dir = state.cache_dir.clone();
    let conn_arc = state.db.clone();
    let updated_paths = payload.updated_paths;

    tokio::task::spawn_blocking(move || {
        let conn = conn_arc.lock().unwrap();
        let db_path = cache_dir.parent().unwrap_or(&cache_dir).join("damright.db");
        ensure_default_storage_source(&conn, &storage_dir);
        drop(conn);

        if !storage_dir.exists() {
            return;
        }

        if updated_paths.is_empty() {
            // Full rescan fallback
            match crate::processing::refresh_folder_headless(
                storage_dir.to_str().unwrap_or(""),
                &cache_dir,
                &db_path,
            ) {
                Ok(photos) => println!("Direct Sync Notification: Successfully refreshed {} photos into database", photos.len()),
                Err(e) => println!("Direct Sync Notification: Error refreshing photos: {}", e),
            }
        } else {
            // Targeted incremental scan on affected subdirectories
            let mut affected_dirs = std::collections::HashSet::new();
            for rel in &updated_paths {
                let clean_rel = rel.trim_start_matches('/');
                let target = storage_dir.join(clean_rel);
                if let Some(parent) = target.parent() {
                    if parent.exists() {
                        affected_dirs.insert(parent.to_path_buf());
                    }
                }
            }

            if affected_dirs.is_empty() {
                affected_dirs.insert(storage_dir.clone());
            }

            let mut total_indexed = 0;
            for dir in affected_dirs {
                if let Ok(photos) = crate::processing::refresh_folder_headless(
                    dir.to_str().unwrap_or(""),
                    &cache_dir,
                    &db_path,
                ) {
                    total_indexed += photos.len();
                }
            }
            println!("Direct Sync Notification: Incrementally refreshed {} photos", total_indexed);
        }
    });

    (StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))).into_response()
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub folder: Option<String>,
}

#[derive(Deserialize)]
pub struct DownloadQuery {
    pub path: String,
}

pub async fn handle_list(
    State(state): State<Arc<WebState>>,
    Query(params): Query<ListQuery>,
) -> impl IntoResponse {
    let folder = params.folder.unwrap_or_else(|| "Inbox".to_string());
    let folder_clean = folder.trim_matches('/');

    if has_parent_dir_traversal(folder_clean) {
        return (StatusCode::BAD_REQUEST, "Invalid folder parameter").into_response();
    }

    let target_dir = if folder_clean.is_empty() {
        state.storage_dir.clone()
    } else {
        resolve_target_path(&state.storage_dir, folder_clean)
    };

    let mut files = Vec::new();
    if target_dir.exists() {
        for entry in walkdir::WalkDir::new(&target_dir).into_iter().filter_map(|e| e.ok()) {
            if entry.path().is_file() {
                let filename = entry.path().file_name().and_then(|n| n.to_str()).unwrap_or("");
                if filename.starts_with('.') {
                    continue;
                }
                let rel_path_str = match entry.path().strip_prefix(&state.storage_dir) {
                    Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
                    Err(_) => continue,
                };

                let file_size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                let mtime = entry.metadata().ok()
                    .and_then(|m| m.modified().ok())
                    .unwrap_or_else(|| std::time::SystemTime::now())
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);

                files.push(serde_json::json!({
                    "path": rel_path_str,
                    "size": file_size,
                    "mtime": mtime,
                }));
            }
        }
    }

    (StatusCode::OK, Json(files)).into_response()
}

pub async fn handle_download(
    State(state): State<Arc<WebState>>,
    Query(params): Query<DownloadQuery>,
) -> impl IntoResponse {
    let rel_path = params.path.trim_start_matches('/');
    if !is_safe_relative_path(rel_path) {
        return (StatusCode::BAD_REQUEST, "Invalid path parameter").into_response();
    }

    let target_path = resolve_target_path(&state.storage_dir, rel_path);

    if !target_path.exists() {
        return (StatusCode::NOT_FOUND, "File not found").into_response();
    }

    match std::fs::read(&target_path) {
        Ok(data) => {
            let mime = mime_guess::from_path(&target_path).first_or_octet_stream().to_string();
            (StatusCode::OK, [("content-type", mime)], data).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    pub path: String,
}

pub async fn handle_delete(
    State(state): State<Arc<WebState>>,
    Query(params): Query<DeleteQuery>,
) -> impl IntoResponse {
    let rel_path = params.path.trim_start_matches('/');
    if !is_safe_relative_path(rel_path) {
        return (StatusCode::BAD_REQUEST, "Invalid path parameter").into_response();
    }

    let target_path = resolve_target_path(&state.storage_dir, rel_path);

    // 1. Delete media file
    if target_path.exists() {
        if let Err(e) = std::fs::remove_file(&target_path) {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to delete file: {}", e)).into_response();
        }
    }

    // 2. Delete XMP sidecar(s)
    if let Some(ext) = target_path.extension().and_then(|s| s.to_str()) {
        let xmp_ext = target_path.with_extension(format!("{}.xmp", ext));
        let _ = std::fs::remove_file(xmp_ext);
    }
    let xmp = target_path.with_extension("xmp");
    let _ = std::fs::remove_file(xmp);

    // 3. Delete thumbnail & preview cache files
    let thumb_path = crate::processing::image::get_thumbnail_path(&target_path, &state.cache_dir);
    let _ = std::fs::remove_file(thumb_path);

    let target_str = target_path.to_string_lossy().to_string();
    let preview_path = crate::processing::image::get_preview_path(&target_str, &state.cache_dir, false);
    let _ = std::fs::remove_file(preview_path);
    let uncropped_preview_path = crate::processing::image::get_preview_path(&target_str, &state.cache_dir, true);
    let _ = std::fs::remove_file(uncropped_preview_path);

    // 4. Delete from server database
    if let Ok(conn) = state.db.lock() {
        let _ = crate::db::photo_repo::delete_by_path(&conn, &target_str);
        let _ = crate::db::photo_repo::delete_by_path(&conn, rel_path);
    }

    (StatusCode::OK, Json(serde_json::json!({ "status": "ok", "deleted": rel_path }))).into_response()
}

#[derive(Deserialize)]
pub struct MoveFolderPayload {
    pub src: String,
    pub dest: String,
}

pub async fn handle_move(
    State(state): State<Arc<WebState>>,
    Json(payload): Json<MoveFolderPayload>,
) -> impl IntoResponse {
    let clean_src = payload.src.trim_matches('/').replace('\\', "/");
    let clean_dest = payload.dest.trim_matches('/').replace('\\', "/");

    if !is_safe_relative_path(&clean_src) || !is_safe_relative_path(&clean_dest) || clean_src == clean_dest {
        return (StatusCode::BAD_REQUEST, "Invalid src or dest path").into_response();
    }

    let src_target = resolve_target_path(&state.storage_dir, &clean_src);
    let dest_target = resolve_target_path(&state.storage_dir, &clean_dest);

    if !src_target.exists() {
        return (StatusCode::NOT_FOUND, "Source folder does not exist").into_response();
    }

    if dest_target.exists() {
        return (StatusCode::CONFLICT, "Destination folder already exists").into_response();
    }

    if let Some(parent) = dest_target.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    if let Err(e) = tokio::fs::rename(&src_target, &dest_target).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to move folder: {}", e)).into_response();
    }

    // Refresh server database for destination directory
    let storage_dir = state.storage_dir.clone();
    let cache_dir = state.cache_dir.clone();
    let conn_arc = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = conn_arc.lock().unwrap();
        let db_path = cache_dir.parent().unwrap_or(&cache_dir).join("damright.db");
        ensure_default_storage_source(&conn, &storage_dir);
        drop(conn);
        let _ = crate::processing::refresh_folder_headless(
            dest_target.to_str().unwrap_or(""),
            &cache_dir,
            &db_path,
        );
    });

    (StatusCode::OK, Json(serde_json::json!({ "status": "ok", "src": clean_src, "dest": clean_dest }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;

    #[test]
    fn test_path_safety_helpers() {
        assert!(is_safe_relative_path("Inbox/photo.jpg"));
        assert!(is_safe_relative_path("/Library/2026/05/pic.jpg"));
        assert!(!is_safe_relative_path(""));
        assert!(!is_safe_relative_path("../etc/passwd"));
        assert!(!is_safe_relative_path("Inbox/../../etc/passwd"));
        assert!(!is_safe_relative_path("Inbox\\..\\secret.txt"));
        assert!(has_parent_dir_traversal("../secret"));
        assert!(has_parent_dir_traversal("/a/b/../c"));
        assert!(!has_parent_dir_traversal("/a/b/c..jpg"));
    }

    #[tokio::test]
    async fn test_get_asset_blocks_arbitrary_file_read_and_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let app_dir = tmp.path().join("app");
        let cache_dir = app_dir.join("cache");
        let storage_dir = app_dir.join("storage");
        let outside_dir = tmp.path().join("outside");
        std::fs::create_dir_all(&cache_dir).unwrap();
        std::fs::create_dir_all(&storage_dir).unwrap();
        std::fs::create_dir_all(&outside_dir).unwrap();

        let secret_file = outside_dir.join("secret.txt");
        std::fs::write(&secret_file, b"top secret").unwrap();
        let allowed_file = storage_dir.join("allowed.jpg");
        std::fs::write(&allowed_file, b"allowed image").unwrap();

        let conn = crate::db::init_db(&app_dir).unwrap();
        let state = Arc::new(WebState {
            db: Arc::new(Mutex::new(conn)),
            cache_dir,
            storage_dir,
        });

        // 1. Attempt to read arbitrary file outside allowed roots -> FORBIDDEN
        let req1 = Request::builder().uri("/api/asset").body(axum::body::Body::empty()).unwrap();
        let resp1 = get_asset(
            State(Arc::clone(&state)),
            Query(AssetQuery {
                path: secret_file.to_string_lossy().to_string(),
                thumb: Some(false),
                v: None,
            }),
            req1,
        )
        .await;
        assert_eq!(resp1.status(), StatusCode::FORBIDDEN);

        // 2. Attempt parent directory traversal -> BAD_REQUEST
        let req2 = Request::builder().uri("/api/asset").body(axum::body::Body::empty()).unwrap();
        let resp2 = get_asset(
            State(Arc::clone(&state)),
            Query(AssetQuery {
                path: "../outside/secret.txt".to_string(),
                thumb: Some(false),
                v: None,
            }),
            req2,
        )
        .await;
        assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);

        // 3. Allowed file inside storage_dir -> OK
        let req3 = Request::builder().uri("/api/asset").body(axum::body::Body::empty()).unwrap();
        let resp3 = get_asset(
            State(Arc::clone(&state)),
            Query(AssetQuery {
                path: allowed_file.to_string_lossy().to_string(),
                thumb: Some(false),
                v: None,
            }),
            req3,
        )
        .await;
        assert_eq!(resp3.status(), StatusCode::OK);
    }
}


