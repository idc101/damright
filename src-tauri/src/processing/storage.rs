use std::fs;
use std::path::{Path, PathBuf};
use rusqlite::Connection;
use crate::db::{photo_repo, source_repo};
use crate::processing::image::get_preview_path;
use crate::processing::metadata::get_capture_time;

pub struct AssetStorage;

impl AssetStorage {
    /// Delete a single photo and all associated assets (raw media, all XMP sidecars,
    /// thumbnail, cropped/uncropped cached previews, and DB record).
    /// Automatically records an inbox tombstone if the file is within a pull sync source.
    pub fn delete_photo(conn: &Connection, id: &str) -> anyhow::Result<()> {
        let photo = photo_repo::get_by_id(conn, id)?;
        let media_path = Path::new(&photo.path);

        // 0. Register inbox sync tombstone if needed
        mark_inbox_tombstone_if_needed(conn, &photo.path, "deleted");

        // 1. Delete physical media file
        if media_path.exists() {
            let _ = fs::remove_file(media_path);
        }

        // 2. Discover and delete all associated XMP sidecars
        for sidecar in Self::find_sidecars(media_path) {
            let _ = fs::remove_file(sidecar);
        }

        // 3. Clean up cached thumbnail and previews (cropped + uncropped)
        Self::cleanup_preview_cache(&photo.thumb_path, &photo.path)?;

        // 4. Delete record from database
        photo_repo::delete_by_id(conn, id)?;

        Ok(())
    }

    /// Delete all rejected photos under a specific folder path prefix.
    /// Returns the number of photos deleted.
    pub fn delete_rejected_in_folder(conn: &Connection, folder_path: &str) -> anyhow::Result<usize> {
        let photos_to_delete = photo_repo::get_rejected_by_path_prefix(conn, folder_path)?;
        let count = photos_to_delete.len();

        for photo in photos_to_delete {
            Self::delete_photo(conn, &photo.id)?;
        }

        Ok(count)
    }

    /// Move a batch of photos by ID to a destination folder.
    /// Handles collision detection, companion XMP sidecar moves/renames,
    /// sync tombstones, DB path updates, and audit re-validation.
    /// Returns the number of successfully moved photos.
    pub fn move_photos(conn: &Connection, ids: &[String], dest_folder: &str) -> anyhow::Result<usize> {
        let mut count = 0;

        // Ensure destination folder exists
        fs::create_dir_all(dest_folder)?;

        for id in ids {
            let photo = match photo_repo::get_by_id(conn, id) {
                Ok(p) => p,
                Err(_) => continue,
            };

            let current_path = Path::new(&photo.path);
            let current_path_str = &photo.path;

            if !current_path.exists() {
                println!("Rust: Move failed, file not found: {}", current_path_str);
                continue;
            }

            mark_inbox_tombstone_if_needed(conn, current_path_str, "sorted");

            let filename = match current_path.file_name() {
                Some(f) => f,
                None => continue,
            };
            let new_path = Path::new(dest_folder).join(filename);
            let new_path_str = new_path.to_string_lossy().to_string();

            if new_path_str == *current_path_str {
                continue;
            }

            // Handle collisions: if file exists at destination, add a numeric suffix
            let mut final_new_path = new_path.clone();
            if final_new_path.exists() {
                let stem = current_path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
                let ext = current_path.extension().and_then(|s| s.to_str()).unwrap_or("");
                let mut i = 1;
                while final_new_path.exists() {
                    let new_filename = if ext.is_empty() {
                        format!("{}_{}", stem, i)
                    } else {
                        format!("{}_{}.{}", stem, i, ext)
                    };
                    final_new_path = Path::new(dest_folder).join(new_filename);
                    i += 1;
                }
            }

            let final_new_path_str = final_new_path.to_string_lossy().to_string();
            println!("Rust: Moving {} to {}", current_path_str, final_new_path_str);

            // Discover sidecars before moving primary media file
            let sidecars = Self::find_sidecars(current_path);

            // 1. Move media file
            fs::rename(current_path, &final_new_path)?;

            // 2. Move & rename companion XMP sidecar(s)
            let old_filename = current_path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let final_new_ext = final_new_path.extension().and_then(|s| s.to_str()).unwrap_or("");
            let is_renamed = final_new_path != new_path;

            for old_xmp in sidecars {
                let sidecar_name = old_xmp.file_name().and_then(|s| s.to_str()).unwrap_or("");
                let is_compound = sidecar_name.ends_with(".xmp") && sidecar_name.starts_with(old_filename);

                let final_new_xmp = if is_renamed {
                    if is_compound {
                        final_new_path.with_extension(format!("{}.xmp", final_new_ext))
                    } else {
                        final_new_path.with_extension("xmp")
                    }
                } else if is_compound {
                    Path::new(dest_folder).join(format!("{}.xmp", final_new_path.file_name().and_then(|s| s.to_str()).unwrap_or("")))
                } else {
                    Path::new(dest_folder).join(sidecar_name)
                };

                let _ = fs::rename(old_xmp, final_new_xmp);
            }

            // 3. Update database
            photo_repo::update_path(conn, id, &final_new_path_str)?;
            crate::processing::audit::update_photo_validation(conn, id)?;
            count += 1;
        }

        Ok(count)
    }

    /// Move or rename an entire folder.
    /// Handles physical directory rename on disk (with cross-device fallback),
    /// records inbox tombstones for sync if moved from an Inbox/pull source,
    /// and recursively updates all child photo paths in the database and audit status.
    pub fn move_folder(
        conn: &Connection,
        src_path_str: &str,
        dest_path_str: &str,
    ) -> anyhow::Result<usize> {
        let src_path = Path::new(src_path_str);
        let dest_path = Path::new(dest_path_str);

        if !src_path.exists() || !src_path.is_dir() {
            return Err(anyhow::anyhow!("Source path is not an existing directory: {}", src_path_str));
        }

        let norm_src = src_path_str.replace('\\', "/").trim_end_matches('/').to_string();
        let norm_dest = dest_path_str.replace('\\', "/").trim_end_matches('/').to_string();

        if norm_src == norm_dest {
            return Ok(0);
        }

        // Check if destination is a subfolder of source (cycle detection)
        if norm_dest.starts_with(&format!("{}/", norm_src)) {
            return Err(anyhow::anyhow!("Cannot move a directory into its own subdirectory"));
        }

        if dest_path.exists() {
            return Err(anyhow::anyhow!("Destination folder already exists: {}", dest_path_str));
        }

        // Prevent moving/renaming configured source roots
        if let Ok(sources) = source_repo::get_all(conn) {
            for s in &sources {
                let norm_s = s.path.replace('\\', "/").trim_end_matches('/').to_string();
                if norm_s == norm_src {
                    return Err(anyhow::anyhow!("Root source directories cannot be moved or renamed"));
                }
            }
        }

        // Ensure parent directory of destination exists
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // 1. Discover all photos within src_path before moving
        let photos_with_paths = photo_repo::get_photo_paths_by_prefix(conn, src_path_str)?;

        // 2. Mark tombstones for any photos that are in an inbox/pull sync source
        for (_id, photo_path) in &photos_with_paths {
            mark_inbox_tombstone_if_needed(conn, photo_path, "sorted");
        }

        // 3. Move directory on disk
        if let Err(e) = fs::rename(src_path, dest_path) {
            if e.raw_os_error() == Some(18) || e.kind() == std::io::ErrorKind::CrossesDevices {
                copy_dir_all(src_path, dest_path)?;
                fs::remove_dir_all(src_path)?;
            } else {
                return Err(anyhow::anyhow!("Failed to move directory on disk: {}", e));
            }
        }

        // 4. Update photo paths and re-validate in database
        let mut count = 0;
        let prefix_slash = format!("{}/", norm_src);
        for (id, old_photo_path) in photos_with_paths {
            let norm_old = old_photo_path.replace('\\', "/");
            let new_photo_path = if norm_old == norm_src {
                norm_dest.clone()
            } else if norm_old.starts_with(&prefix_slash) {
                format!("{}{}", norm_dest, &norm_old[norm_src.len()..])
            } else {
                continue;
            };

            photo_repo::update_path(conn, &id, &new_photo_path)?;
            let _ = crate::processing::audit::update_photo_validation(conn, &id);
            count += 1;
        }

        Ok(count)
    }

    /// Rename a single photo to a specific new filename.
    /// Moves and updates the primary media file, preserves original filename in XMP,
    /// renames companion sidecars, updates DB path, and triggers re-validation.
    pub fn rename_photo(conn: &Connection, id: &str, new_filename: &str) -> anyhow::Result<String> {
        let photo = photo_repo::get_by_id(conn, id)?;
        let current_path = Path::new(&photo.path);

        if !current_path.exists() {
            return Err(anyhow::anyhow!("File not found: {}", photo.path));
        }

        let parent = current_path.parent().ok_or_else(|| anyhow::anyhow!("No parent directory"))?;
        let new_path = parent.join(new_filename);
        let new_path_str = new_path.to_string_lossy().to_string();

        if new_path_str == photo.path {
            return Ok(new_path_str);
        }

        if new_path.exists() {
            return Err(anyhow::anyhow!("Target file already exists: {}", new_path_str));
        }

        mark_inbox_tombstone_if_needed(conn, &photo.path, "sorted");

        // Retain original filename in the XMP sidecar before renaming
        if let Some(filename_str) = current_path.file_name().and_then(|s| s.to_str()) {
            let _ = crate::processing::metadata::xmp::write_preserved_filename(&photo.path, filename_str);
        }

        // Discover sidecars before renaming media file
        let sidecars = Self::find_sidecars(current_path);

        // 1. Rename media file
        fs::rename(current_path, &new_path)?;

        // 2. Rename companion XMP sidecar(s)
        let old_filename = current_path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let new_ext = new_path.extension().and_then(|s| s.to_str()).unwrap_or("");

        for old_xmp in sidecars {
            let sidecar_name = old_xmp.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let is_compound = sidecar_name.ends_with(".xmp") && sidecar_name.starts_with(old_filename);

            let new_xmp = if is_compound {
                new_path.with_extension(format!("{}.xmp", new_ext))
            } else {
                new_path.with_extension("xmp")
            };

            let _ = fs::rename(old_xmp, new_xmp);
        }

        // 3. Update database
        photo_repo::update_path(conn, id, &new_path_str)?;
        crate::processing::audit::update_photo_validation(conn, id)?;

        Ok(new_path_str)
    }

    /// Auto-rename a photo according to the deterministic convention:
    /// `YYYYMMDDTHHMMSS-{3-char-hash}.ext` based on DateTimeOriginal and content hash.
    pub fn auto_rename_photo(conn: &Connection, id: &str) -> anyhow::Result<String> {
        let photo = photo_repo::get_by_id(conn, id)?;
        let path = Path::new(&photo.path);

        if !path.exists() {
            return Err(anyhow::anyhow!("File not found: {}", photo.path));
        }

        let timestamp = get_capture_time(path).ok_or_else(|| {
            anyhow::anyhow!(
                "No capture date (DateTimeOriginal) found in metadata for {}. Renaming requires a capture date.",
                photo.path
            )
        })?;

        let hash_prefix = get_file_hash_prefix(path)?;
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("jpg");

        let new_filename = format!("{}-{}.{}", timestamp.format("%Y%m%dT%H%M%S"), hash_prefix, ext);

        Self::rename_photo(conn, id, &new_filename)
    }

    /// Auto-rename all photos under a specific directory prefix.
    pub fn auto_rename_folder(conn: &Connection, folder_path: &str) -> anyhow::Result<usize> {
        let photos = photo_repo::get_photo_paths_by_prefix(conn, folder_path)?;

        let mut count = 0;
        for (id, path) in photos {
            if let Ok(new_path) = Self::auto_rename_photo(conn, &id) {
                if new_path != path {
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    /// Discover all existing XMP sidecars associated with a media file.
    /// Checks both standard `{file}.xmp` and Adobe-style `{file}.{ext}.xmp`.
    pub fn find_sidecars(media_path: &Path) -> Vec<PathBuf> {
        let mut sidecars = Vec::new();

        if let Some(ext) = media_path.extension().and_then(|s| s.to_str()) {
            let compound = media_path.with_extension(format!("{}.xmp", ext));
            if compound.exists() && compound != media_path {
                sidecars.push(compound);
            }
        }

        let standard = media_path.with_extension("xmp");
        if standard.exists() && standard != media_path && !sidecars.contains(&standard) {
            sidecars.push(standard);
        }

        sidecars
    }

    /// Clean up cached thumbnails and previews (both cropped and uncropped) for a given photo.
    pub fn cleanup_preview_cache(thumb_path_str: &str, raw_path_str: &str) -> anyhow::Result<()> {
        let thumb_path = Path::new(thumb_path_str);
        if thumb_path.exists() {
            let _ = fs::remove_file(thumb_path);
        }

        let cache_dir = if thumb_path_str.contains("thumbnails") {
            thumb_path.parent().and_then(|p| p.parent()).and_then(|p| p.parent())
        } else {
            thumb_path.parent()
        };

        if let Some(cache_dir) = cache_dir {
            let preview_path = get_preview_path(raw_path_str, cache_dir, false);
            let _ = fs::remove_file(preview_path);
            let uncropped_preview_path = get_preview_path(raw_path_str, cache_dir, true);
            let _ = fs::remove_file(uncropped_preview_path);
        }

        Ok(())
    }
}

pub fn get_file_hash_prefix(path: &Path) -> anyhow::Result<String> {
    let data = fs::read(path)?;
    let hash = blake3::hash(&data);
    let hex = hash.to_hex();
    Ok(hex.as_str()[..3].to_string())
}

pub fn mark_inbox_tombstone_if_needed(conn: &Connection, photo_path: &str, status: &str) {
    use crate::db::sync_state_repo::{set_sync_state, SyncStateRecord};

    let norm_photo = photo_path.replace('\\', "/");
    let lower_photo = norm_photo.to_lowercase();

    let mut server_key: Option<String> = None;

    if let Ok(sources) = source_repo::get_all(conn) {
        for src in &sources {
            if src.sync_mode != "pull" {
                continue;
            }

            let norm_src = src.path.replace('\\', "/").trim_end_matches('/').to_string();
            let lower_src = norm_src.to_lowercase();
            let server_folder = src.server_path.as_deref().unwrap_or(src.name.as_str()).trim_matches('/');

            let prefix_with_slash = format!("{}/", lower_src);
            if lower_photo.starts_with(&prefix_with_slash) {
                let rel_str = &norm_photo[norm_src.len() + 1..];
                server_key = Some(format!("{}/{}", server_folder, rel_str));
                break;
            } else if lower_photo == lower_src {
                server_key = Some(server_folder.to_string());
                break;
            }

            // Check if photo_path was already a relative path within this pull source
            let server_prefix_lower = format!("{}/", server_folder.to_lowercase());
            if lower_photo.starts_with(&server_prefix_lower) {
                let rel_str = &norm_photo[server_folder.len() + 1..];
                server_key = Some(format!("{}/{}", server_folder, rel_str));
                break;
            }
            let src_name_lower = format!("{}/", src.name.to_lowercase());
            if lower_photo.starts_with(&src_name_lower) {
                let rel_str = &norm_photo[src.name.len() + 1..];
                server_key = Some(format!("{}/{}", server_folder, rel_str));
                break;
            }

            // Check if photo_path was a relative path within this pull source (e.g. no leading slash or drive letter)
            if !norm_photo.starts_with('/') && !norm_photo.contains(':') {
                if !lower_photo.starts_with(&server_prefix_lower) && !lower_photo.starts_with(&src_name_lower) {
                    server_key = Some(format!("{}/{}", server_folder, norm_photo));
                    break;
                }
            }
        }
    }

    if let Some(key) = server_key {
        println!("Rust: Inbox tombstone marked for key: '{}' with status '{}'", key, status);
        let record = SyncStateRecord {
            relative_path: key,
            file_size: 0,
            mtime: chrono::Utc::now().timestamp(),
            hash: None,
            last_synced_at: chrono::Utc::now().to_rfc3339(),
            status: status.to_string(),
        };
        let _ = set_sync_state(conn, &record);
    }
}

pub fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let dest_child = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &dest_child)?;
        } else {
            fs::copy(&entry.path(), &dest_child)?;
        }
    }
    Ok(())
}

