use std::path::Path;
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use walkdir::WalkDir;
use rusqlite::Connection;
use uuid::Uuid;
use tauri::Emitter;
use rayon::prelude::*;
use crate::models::Photo;
use crate::db::photo_repo;
use crate::processing::{ProgressPayload};
use crate::processing::image::{is_video, is_markdown, get_mime_type, get_processor, get_thumbnail_path, generate_thumbnail_image};
use crate::processing::metadata::{
    get_embedded_metadata, get_exif_orientation, get_extended_metadata_with_xmp, parse_markdown_metadata, XmpDocument,
};

#[cfg(target_os = "macos")]
use crate::processing::metadata::get_sips_orientation;

pub fn import_folder_headless(
    folder_path: &str,
    cache_dir: &Path,
    db_path: &Path,
) -> anyhow::Result<Vec<Photo>> {
    import_folder::<tauri::Wry>(folder_path, cache_dir, db_path, None)
}

pub fn refresh_folder_headless(
    folder_path: &str,
    cache_dir: &Path,
    db_path: &Path,
) -> anyhow::Result<Vec<Photo>> {
    refresh_folder::<tauri::Wry>(folder_path, cache_dir, db_path, None)
}

pub fn import_folder<R: tauri::Runtime>(
    folder_path: &str,
    cache_dir: &Path,
    db_path: &Path,
    app: Option<&tauri::AppHandle<R>>,
) -> anyhow::Result<Vec<Photo>> {
    let log_progress = |msg: &str| {
        log_to_import_log(db_path, msg);
    };

    log_progress(&format!("Starting import from folder: {}", folder_path));
    
    // Load existing paths to enable resuming and avoid double-processing
    let mut existing_paths = std::collections::HashSet::new();
    match Connection::open(db_path) {
        Ok(conn) => {
            if let Ok(photos) = photo_repo::get_photo_paths_by_prefix(&conn, folder_path) {
                for (_, path) in photos {
                    existing_paths.insert(path);
                }
            }
        }
        Err(e) => {
            log_progress(&format!("Warning: Could not open database to read existing paths: {}", e));
        }
    }
    log_progress(&format!("Found {} already imported files in DB for this folder", existing_paths.len()));

    log_progress("Scanning folder for images and videos...");
    let all_entries: Vec<_> = WalkDir::new(folder_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            if e.path().starts_with(cache_dir) {
                return false;
            }

            let ext = e.path().extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            e.path().is_file() && (
                ext == "jpg" || ext == "jpeg" || ext == "heic" || ext == "heif" ||
                ext == "png" || ext == "webp" || ext == "gif" || 
                ext == "tiff" || ext == "tif" ||
                ext == "mp4" || ext == "mov" || ext == "m4v" || 
                ext == "mkv" || ext == "avi" || ext == "webm" ||
                ext == "md" || ext == "markdown"
            )
        })
        .collect();
    
    let total_scanned = all_entries.len();
    log_progress(&format!("Scanned folder and found {} supported files total", total_scanned));

    // Filter to only new files
    let entries: Vec<_> = all_entries
        .into_iter()
        .filter(|e| {
            let path_str = e.path().to_string_lossy().to_string();
            !existing_paths.contains(&path_str)
        })
        .collect();

    let total_new = entries.len();
    log_progress(&format!("Already imported: {}. New files to import: {}.", total_scanned - total_new, total_new));

    if total_new == 0 {
        log_progress("No new files to import. Import complete.");
        if let Some(app) = app {
            let _ = app.emit("import-progress", ProgressPayload {
                message: "Import complete".to_string(),
                current: total_scanned,
                total: total_scanned,
            });
        }
        
        let conn = Connection::open(db_path)?;
        let all_photos = photo_repo::get_all(&conn, None)?;
        let normalized_prefix = if folder_path.ends_with('/') || folder_path.ends_with('\\') {
            folder_path.to_string()
        } else if folder_path.contains('\\') {
            format!("{}\\", folder_path)
        } else {
            format!("{}/", folder_path)
        };
        let folder_photos: Vec<Photo> = all_photos
            .into_iter()
            .filter(|p| p.path.starts_with(&normalized_prefix) || p.path == folder_path)
            .collect();
        return Ok(folder_photos);
    }

    let processor = get_processor();
    let completed = AtomicUsize::new(total_scanned - total_new);
    let mut all_imported_photos = Vec::new();
    
    // Emit initial progress so the UI has the correct total and starts showing progress
    if let Some(app) = app {
        let _ = app.emit("import-progress", ProgressPayload {
            message: "Starting import...".to_string(),
            current: total_scanned - total_new,
            total: total_scanned,
        });
    }
    
    // Process items in chunks of 500
    const CHUNK_SIZE: usize = 500;
    for (chunk_idx, chunk) in entries.chunks(CHUNK_SIZE).enumerate() {
        log_progress(&format!(
            "Processing chunk {}/{} (size: {})",
            chunk_idx + 1,
            (total_new + CHUNK_SIZE - 1) / CHUNK_SIZE,
            chunk.len()
        ));
        
        let chunk_photos: Vec<Photo> = chunk.par_iter().map(|entry| {
            let path = entry.path();
            let id = Uuid::new_v4().to_string();
            
            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            let thumb_path = get_thumbnail_path(&path, cache_dir);
            if let Some(parent) = thumb_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            
            let mut orientation = 1;
            let mut rating = 0;
            let mut tags = String::new();
            let mut event = None;

            let xmp_doc = if !is_video(&ext) && !is_markdown(&ext) {
                XmpDocument::load_for_media(path)
            } else {
                None
            };

            if !is_video(&ext) && !is_markdown(&ext) {
                orientation = xmp_doc
                    .as_ref()
                    .and_then(|doc| doc.orientation)
                    .or_else(|| get_exif_orientation(path))
                    .unwrap_or(1);
                
                #[cfg(target_os = "macos")]
                if orientation == 1 && (ext == "heic" || ext == "heif") {
                    if let Some(s_orient) = get_sips_orientation(path) {
                        orientation = s_orient;
                    }
                }

                if let Some(ref doc) = xmp_doc {
                    rating = doc.rating;
                    tags = doc.tags.join(",");
                    event = doc.event.clone();
                }
                
                if rating == 0 || tags.is_empty() {
                    let (e_rating, e_tags) = get_embedded_metadata(path);
                    if rating == 0 { rating = e_rating; }
                    if tags.is_empty() { tags = e_tags; }
                }
            } else if is_markdown(&ext) {
                let md_meta = parse_markdown_metadata(path);
                if !md_meta.tags.is_empty() {
                    tags = md_meta.tags.join(",");
                }
                if event.is_none() {
                    event = md_meta.event.clone();
                }
            }

            let extended = get_extended_metadata_with_xmp(path, xmp_doc.as_ref());
            if event.is_none() { event = extended.event; }
            let mime_type = get_mime_type(&ext);

            let mut photo = Photo {
                id,
                path: path.to_string_lossy().to_string(),
                thumb_path: thumb_path.to_string_lossy().to_string(),
                exposure: 0.0,
                rating,
                rejected: false,
                tags,
                orientation,
                mime_type,
                width: extended.width,
                height: extended.height,
                file_size: extended.file_size,
                camera_make: extended.camera_make,
                camera_model: extended.camera_model,
                latitude: extended.latitude,
                longitude: extended.longitude,
                capture_time: extended.capture_time,
                city: extended.city,
                state: extended.state,
                country: extended.country,
                location_name: extended.location_name,
                title: extended.title,
                description: extended.description,
                event,
                faces: extended.faces,
                crop_top: extended.crop_top,
                crop_left: extended.crop_left,
                crop_bottom: extended.crop_bottom,
                crop_right: extended.crop_right,
                crop_angle: extended.crop_angle,
                perceptual_hash: None,
                portrait_blur: None,
                validation_is_valid: true,
                validation_issues: String::new(),
                in_quick_collection: false,
                rank_score: crate::processing::ranking::calculate_initial_score(rating),
                match_count: 0,
                suggested_rating: if rating > 0 { rating } else { 3 },
            };

            let (is_valid, issues) = crate::processing::audit::compute_validation_status(&photo);
            photo.validation_is_valid = is_valid;
            photo.validation_issues = issues;

            // Generate thumbnail
            let mut thumb_generated = false;
            if thumb_path.exists() {
                thumb_generated = true;
                if !is_video(&ext) && !is_markdown(&ext) {
                    // Generate perceptual hash for images to store in DB
                    match processor.generate_perceptual_hash(&photo) {
                        Ok(hash) => photo.perceptual_hash = Some(hash),
                        Err(e) => println!("Rust: Perceptual hash generation failed for {}: {}", path.display(), e),
                    }
                }
            } else if is_markdown(&ext) {
                if let Err(e) = generate_thumbnail_image(&photo, &thumb_path) {
                    println!("Rust: Markdown thumbnail generation failed for {}: {}", path.display(), e);
                } else {
                    thumb_generated = true;
                }
            } else if is_video(&ext) {
                #[cfg(target_os = "macos")]
                {
                    use std::process::Command;
                    let thumb_parent = thumb_path.parent().unwrap();
                    let mut cmd = Command::new("qlmanage");
                    cmd.arg("-t")
                        .arg("-s")
                        .arg("400")
                        .arg("-o")
                        .arg(thumb_parent)
                        .arg(path);
                    let status = crate::processing::run_command_with_timeout(
                        &mut cmd,
                        std::time::Duration::from_secs(10),
                    );
                    
                    if status.as_ref().map(|o| o.status.success()).unwrap_or(false) {
                        let generated_name = format!("{}.png", path.file_name().unwrap().to_string_lossy());
                        let generated_path = thumb_parent.join(generated_name);
                        if generated_path.exists() {
                            let _ = fs::rename(generated_path, &thumb_path);
                            thumb_generated = true;
                        }
                    } else {
                        let err_msg = match &status {
                            Err(e) => format!("qlmanage timed out/failed for {}: {}", path.display(), e),
                            Ok(output) => format!(
                                "qlmanage failed with exit status {} for {}. stdout: '{}', stderr: '{}'",
                                output.status,
                                path.display(),
                                String::from_utf8_lossy(&output.stdout),
                                String::from_utf8_lossy(&output.stderr)
                            )
                        };
                        log_to_import_log(db_path, &err_msg);
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    use std::process::Command;
                    let ffmpeg_bin = dirs::home_dir()
                        .map(|h| h.join(".local/bin/ffmpeg"))
                        .filter(|p| p.exists())
                        .unwrap_or_else(|| std::path::PathBuf::from("ffmpeg"));
                    let mut cmd = Command::new(ffmpeg_bin);
                    cmd.arg("-ss")
                        .arg("00:00:00")
                        .arg("-i")
                        .arg(path)
                        .arg("-vframes")
                        .arg("1")
                        .arg("-y")
                        .arg(&thumb_path);
                    let status = crate::processing::run_command_with_timeout(
                        &mut cmd,
                        std::time::Duration::from_secs(10),
                    );
                    if status.as_ref().map(|o| o.status.success()).unwrap_or(false) && thumb_path.exists() {
                        thumb_generated = true;
                    } else {
                        let err_msg = match &status {
                            Err(e) => format!("ffmpeg timed out/failed for {}: {}", path.display(), e),
                            Ok(output) => format!(
                                "ffmpeg failed with exit status {} for {}. stdout: '{}', stderr: '{}'",
                                output.status,
                                path.display(),
                                String::from_utf8_lossy(&output.stdout),
                                String::from_utf8_lossy(&output.stderr)
                            )
                        };
                        log_to_import_log(db_path, &err_msg);
                    }
                }
            } else {
                if let Err(e) = processor.generate_thumbnail(&photo, &thumb_path) {
                    println!("Rust: Thumbnail generation failed for {}: {}", path.display(), e);
                } else {
                    thumb_generated = true;
                }

                // Generate perceptual hash for images
                match processor.generate_perceptual_hash(&photo) {
                    Ok(hash) => photo.perceptual_hash = Some(hash),
                    Err(e) => println!("Rust: Perceptual hash generation failed for {}: {}", path.display(), e),
                }
            }

            if !thumb_generated {
                println!("Rust: Warning: No thumbnail generated for {}", path.display());
            }

            let count = completed.fetch_add(1, Ordering::SeqCst) + 1;
            // Emit progress every 5 items, if it's the first one, or if it's the last one to reduce event spam
            if count == 1 || count % 5 == 0 || count == total_scanned {
                if let Some(app) = app {
                    let _ = app.emit("import-progress", ProgressPayload {
                        message: format!("Processing {}", path.file_name().unwrap().to_string_lossy()),
                        current: count,
                        total: total_scanned,
                    });
                }
            }

            photo
        }).collect();

        log_progress(&format!("Writing {} photos of chunk {} to database", chunk_photos.len(), chunk_idx + 1));
        
        // Batch insert into database in a single transaction
        let mut conn = Connection::open(db_path)?;
        let tx = conn.transaction()?;
        for photo in &chunk_photos {
            if let Err(e) = photo_repo::insert(&tx, photo) {
                log_progress(&format!("Error inserting photo {} into database: {}", photo.path, e));
            }
        }
        tx.commit()?;
        
        all_imported_photos.extend(chunk_photos);
    }
    
    log_progress("Import finished successfully.");

    let conn = Connection::open(db_path)?;
    let all_photos = photo_repo::get_all(&conn, None)?;
    let normalized_prefix = if folder_path.ends_with('/') || folder_path.ends_with('\\') {
        folder_path.to_string()
    } else if folder_path.contains('\\') {
        format!("{}\\", folder_path)
    } else {
        format!("{}/", folder_path)
    };
    let folder_photos: Vec<Photo> = all_photos
        .into_iter()
        .filter(|p| p.path.starts_with(&normalized_prefix) || p.path == folder_path)
        .collect();
    Ok(folder_photos)
}



pub fn refresh_folder<R: tauri::Runtime>(
    folder_path: &str,
    cache_dir: &Path,
    db_path: &Path,
    app: Option<&tauri::AppHandle<R>>,
) -> anyhow::Result<Vec<Photo>> {
    println!("Rust: Refreshing folder: {}", folder_path);
    
    // Clean up files in DB that no longer exist on disk
    let existing_photos = {
        let conn = Connection::open(db_path)?;
        let all_photos = photo_repo::get_all(&conn, None)?;
        let norm_folder = folder_path.replace('\\', "/").trim_end_matches('/').to_string();
        let prefix_slash = format!("{}/", norm_folder);
        
        let folder_photos: Vec<Photo> = all_photos
            .into_iter()
            .filter(|p| {
                let norm_p = p.path.replace('\\', "/");
                norm_p == norm_folder || norm_p.starts_with(&prefix_slash)
            })
            .collect();
            
        let mut deleted_count = 0;
        let mut active_photos = Vec::new();
        
        for photo in folder_photos {
            let path = Path::new(&photo.path);
            if !path.exists() {
                let _ = photo_repo::delete_by_id(&conn, &photo.id);
                let _ = std::fs::remove_file(&photo.thumb_path);
                deleted_count += 1;
            } else {
                active_photos.push(photo);
            }
        }
        
        if deleted_count > 0 {
            println!("Rust: Cleaned up {} deleted files from database", deleted_count);
        }
        active_photos
    };

    // Now, synchronize metadata for all existing photos that still exist on disk!
    if !existing_photos.is_empty() {
        println!("Rust: Synchronizing metadata for {} existing photos", existing_photos.len());
        
        let processor = get_processor();
        
        // Process them in parallel using Rayon!
        let updated_photos: Vec<(Photo, bool)> = existing_photos.into_par_iter().map(|mut photo| {
            let path = Path::new(&photo.path);
            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            
            let mut changed = false;
            let mut force_thumb_regen = false;
            
            if !is_video(&ext) && !is_markdown(&ext) {
                // Read fresh metadata from XMP in a single pass
                let xmp_doc = XmpDocument::load_for_media(path);
                let (r, t, ev) = if let Some(ref doc) = xmp_doc {
                    (doc.rating, doc.tags.join(","), doc.event.clone())
                } else {
                    (0, String::new(), None)
                };
                let mut rating = r;
                let mut tags = t;
                let mut event = ev;
                
                if rating == 0 || tags.is_empty() {
                    let (e_rating, e_tags) = get_embedded_metadata(path);
                    if rating == 0 { rating = e_rating; }
                    if tags.is_empty() { tags = e_tags; }
                }
                
                let extended = get_extended_metadata_with_xmp(path, xmp_doc.as_ref());
                if event.is_none() { event = extended.event; }
                
                // Compare with database record
                if photo.rating != rating {
                    photo.rating = rating;
                    changed = true;
                }
                if photo.tags != tags {
                    photo.tags = tags;
                    changed = true;
                }
                if photo.event != event {
                    photo.event = event;
                    changed = true;
                }
                if photo.crop_top != extended.crop_top 
                    || photo.crop_left != extended.crop_left
                    || photo.crop_bottom != extended.crop_bottom
                    || photo.crop_right != extended.crop_right
                    || photo.crop_angle != extended.crop_angle 
                {
                    photo.crop_top = extended.crop_top;
                    photo.crop_left = extended.crop_left;
                    photo.crop_bottom = extended.crop_bottom;
                    photo.crop_right = extended.crop_right;
                    photo.crop_angle = extended.crop_angle;
                    changed = true;
                    force_thumb_regen = true; // Crop settings changed, must regenerate thumbnail!
                }
                
                if photo.title != extended.title {
                    photo.title = extended.title;
                    changed = true;
                }
                if photo.description != extended.description {
                    photo.description = extended.description;
                    changed = true;
                }
                if photo.capture_time != extended.capture_time {
                    photo.capture_time = extended.capture_time;
                    changed = true;
                }
                if photo.city != extended.city || photo.state != extended.state || photo.country != extended.country || photo.location_name != extended.location_name {
                    photo.city = extended.city;
                    photo.state = extended.state;
                    photo.country = extended.country;
                    photo.location_name = extended.location_name;
                    changed = true;
                }
            } else if is_markdown(&ext) {
                let md_meta = parse_markdown_metadata(path);
                let extended = get_extended_metadata_with_xmp(path, None);
                let new_tags = if !md_meta.tags.is_empty() { md_meta.tags.join(",") } else { photo.tags.clone() };
                let new_event = if md_meta.event.is_some() { md_meta.event } else { extended.event };

                if photo.tags != new_tags {
                    photo.tags = new_tags;
                    changed = true;
                }
                if photo.title != extended.title {
                    photo.title = extended.title;
                    changed = true;
                }
                if photo.description != extended.description {
                    photo.description = extended.description;
                    changed = true;
                }
                if photo.event != new_event {
                    photo.event = new_event;
                    changed = true;
                }
                if photo.capture_time != extended.capture_time {
                    photo.capture_time = extended.capture_time;
                    changed = true;
                }
            }

            let expected_mime = get_mime_type(&ext);
            if photo.mime_type != expected_mime {
                photo.mime_type = expected_mime;
                changed = true;
            }

            let expected_thumb = get_thumbnail_path(path, cache_dir);
            let expected_thumb_str = expected_thumb.to_string_lossy().to_string();
            if photo.thumb_path != expected_thumb_str {
                photo.thumb_path = expected_thumb_str;
                changed = true;
                force_thumb_regen = true;
            }

            let (is_valid, issues) = crate::processing::audit::compute_validation_status(&photo);
            if photo.validation_is_valid != is_valid || photo.validation_issues != issues {
                photo.validation_is_valid = is_valid;
                photo.validation_issues = issues;
                changed = true;
            }
            
            // Check if thumbnail file is missing on disk, or if the photo has crop, rotation, or exposure
            // adjustments. Since older versions of the app might have cached these files as uncropped
            // or without adjustments, we force-regenerate them on folder refresh to ensure the backend-applied
            // crops/adjustments are correctly reflected in the cached files.
            let thumb_path = Path::new(&photo.thumb_path);
            let has_adjustments = photo.crop_top.is_some()
                || photo.crop_left.is_some()
                || photo.crop_bottom.is_some()
                || photo.crop_right.is_some()
                || photo.crop_angle.is_some()
                || photo.exposure != 0.0;
            if !thumb_path.exists() || has_adjustments {
                force_thumb_regen = true;
            }
            
            if force_thumb_regen {
                // Delete existing preview and thumbnail first (if any)
                let _ = crate::processing::storage::AssetStorage::cleanup_preview_cache(&photo.thumb_path, &photo.path);
                
                // Make sure the parent subdirectory exists before regenerating
                if let Some(parent) = thumb_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                
                // Regenerate thumbnail
                if is_markdown(&ext) {
                    let _ = generate_thumbnail_image(&photo, thumb_path);
                } else if !is_video(&ext) {
                    if let Err(e) = processor.generate_thumbnail(&photo, thumb_path) {
                        println!("Rust: Failed to regenerate thumbnail for {}: {}", photo.path, e);
                    }
                }
            }
            
            (photo, changed)
        }).collect();
        
        // Write updates to database
        if !updated_photos.is_empty() {
            if let Ok(conn) = Connection::open(db_path) {
                for (photo, changed) in updated_photos {
                    if changed {
                        let _ = photo_repo::update_full(&conn, &photo);
                    }
                }
            }
        }
    }

    import_folder(folder_path, cache_dir, db_path, app)
}

pub fn log_to_import_log(db_path: &Path, msg: &str) {
    let app_dir = db_path.parent().unwrap_or(Path::new("."));
    let log_path = app_dir.join("import.log");
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let formatted = format!("[{}] {}\n", timestamp, msg);
    print!("{}", formatted);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open(&log_path)
    {
        use std::io::Write;
        let _ = file.write_all(formatted.as_bytes());
    }
}
