pub mod traits;
pub mod rust_processor;
pub mod sips_processor;
#[cfg(test)]
mod tests;

use std::path::Path;
use std::fs;
use std::sync::Arc;
use image::DynamicImage;
use crate::models::Photo;
pub use traits::ImageProcessor;
pub use rust_processor::RustImageProcessor;
pub use sips_processor::SipsImageProcessor;

pub fn get_processor() -> Arc<dyn ImageProcessor> {
    // For now, default to RustImageProcessor as it's more complete (adjustments)
    // But we could easily switch to Sips for speed if needed.
    Arc::new(RustImageProcessor)
}

pub fn apply_orientation(img: DynamicImage, orientation: u8) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

pub fn get_thumbnail_path(photo_path: &Path, cache_dir: &Path) -> std::path::PathBuf {
    let ext = photo_path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let thumb_ext = if is_video(&ext) { "png" } else if is_markdown(&ext) { "svg" } else { "jpg" };
    let path_str = photo_path.to_string_lossy().to_string();
    let path_hash = blake3::hash(path_str.as_bytes()).to_string();
    let prefix = &path_hash[0..2];
    cache_dir.join("thumbnails").join(prefix).join(format!("{}.{}", path_hash, thumb_ext))
}

pub fn generate_thumbnail_image(photo: &Photo, output_path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let path = Path::new(&photo.path);
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();

    if is_markdown(&ext) {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><rect width="200" height="200" rx="16" fill="#1e293b"/><path d="M60 40h50l30 30v90a8 8 0 0 1-8 8H60a8 8 0 0 1-8-8V48a8 8 0 0 1 8-8z" fill="#334155"/><path d="M110 40v30h30" fill="#64748b"/><line x1="70" y1="95" x2="130" y2="95" stroke="#94a3b8" stroke-width="6" stroke-linecap="round"/><line x1="70" y1="115" x2="130" y2="115" stroke="#94a3b8" stroke-width="6" stroke-linecap="round"/><line x1="70" y1="135" x2="105" y2="135" stroke="#94a3b8" stroke-width="6" stroke-linecap="round"/></svg>"##;
        fs::write(output_path, svg.as_bytes())?;
        return Ok(());
    }

    if is_video(&ext) {
        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            let thumb_parent = output_path.parent().ok_or_else(|| anyhow::anyhow!("Invalid thumb output parent"))?;
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
                    let _ = fs::rename(generated_path, output_path);
                    return Ok(());
                }
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
                .arg(output_path);
            let status = crate::processing::run_command_with_timeout(
                &mut cmd,
                std::time::Duration::from_secs(10),
            );
            if status.as_ref().map(|o| o.status.success()).unwrap_or(false) && output_path.exists() {
                return Ok(());
            }
        }
        anyhow::bail!("Failed to generate video thumbnail for {}", path.display());
    }

    let processor = get_processor();
    processor.generate_thumbnail(photo, output_path)
}

pub fn get_preview_path(photo_path: &str, cache_dir: &Path, uncropped: bool) -> std::path::PathBuf {
    let path_hash = blake3::hash(photo_path.as_bytes()).to_string();
    let prefix = &path_hash[0..2];
    let suffix = if uncropped { "_uncropped" } else { "" };
    cache_dir.join("previews").join(prefix).join(format!("{}{}.jpg", path_hash, suffix))
}

pub fn get_preview_image(
    photo: &Photo,
    cache_dir: &Path,
    uncropped: bool,
) -> anyhow::Result<String> {
    let preview_path = get_preview_path(&photo.path, cache_dir, uncropped);
    let previews_dir = preview_path.parent().ok_or_else(|| anyhow::anyhow!("Invalid preview path parent"))?;
    fs::create_dir_all(previews_dir)?;

    if preview_path.exists() {
        // Update mtime to track usage for LRU-like cleanup
        let _ = filetime::set_file_mtime(&preview_path, filetime::FileTime::now());
        return Ok(preview_path.to_string_lossy().to_string());
    }

    let path = Path::new(&photo.path);
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();

    if is_markdown(&ext) {
        return Ok(photo.path.clone());
    }

    if is_video(&ext) {
        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            let mut cmd = Command::new("qlmanage");
            cmd.arg("-t")
                .arg("-s")
                .arg("2048")
                .arg("-o")
                .arg(previews_dir)
                .arg(path);
            let status = crate::processing::run_command_with_timeout(
                &mut cmd,
                std::time::Duration::from_secs(10),
            );
            if let Err(e) = &status {
                eprintln!("Warning: qlmanage preview command timed out/failed for {}: {}", path.display(), e);
            } else if let Ok(output) = &status {
                if !output.status.success() {
                    eprintln!(
                        "Warning: qlmanage preview command failed with status {} for {}. stdout: '{}', stderr: '{}'",
                        output.status,
                        path.display(),
                        String::from_utf8_lossy(&output.stdout),
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
            }
            
            let generated_name = format!("{}.png", path.file_name().unwrap().to_string_lossy());
            let generated_path = previews_dir.join(generated_name);
            if generated_path.exists() {
                let _ = fs::rename(generated_path, &preview_path);
                return Ok(preview_path.to_string_lossy().to_string());
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
                .arg(&preview_path);
            let status = crate::processing::run_command_with_timeout(
                &mut cmd,
                std::time::Duration::from_secs(10),
            );
            if status.as_ref().map(|o| o.status.success()).unwrap_or(false) && preview_path.exists() {
                return Ok(preview_path.to_string_lossy().to_string());
            }
        }
        return Ok(photo.thumb_path.clone());
    }

    let processor = get_processor();
    processor.generate_preview(photo, &preview_path, uncropped)?;

    // Cleanup old previews if count > 40 (aiming for ~10,000 total across 256 hash-based subdirectories)
    cleanup_previews(previews_dir, 40)?;

    Ok(preview_path.to_string_lossy().to_string())
}

pub fn cleanup_previews(dir: &Path, limit: usize) -> anyhow::Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .collect();

    if entries.len() <= limit {
        return Ok(());
    }

    entries.sort_by_key(|e| {
        e.metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });

    let to_delete = entries.len() - limit;
    for entry in entries.iter().take(to_delete) {
        let _ = fs::remove_file(entry.path());
    }

    Ok(())
}

pub fn is_video(ext: &str) -> bool {
    matches!(ext, "mp4" | "mov" | "m4v" | "mkv" | "avi" | "webm")
}

pub fn is_markdown(ext: &str) -> bool {
    matches!(ext, "md" | "markdown")
}

pub fn get_mime_type(ext: &str) -> String {
    match ext {
        "jpg" | "jpeg" => "image/jpeg".to_string(),
        "png" => "image/png".to_string(),
        "webp" => "image/webp".to_string(),
        "gif" => "image/gif".to_string(),
        "tiff" | "tif" => "image/tiff".to_string(),
        "heic" | "heif" => "image/heic".to_string(),
        "mp4" => "video/mp4".to_string(),
        "mov" => "video/quicktime".to_string(),
        "m4v" => "video/x-m4v".to_string(),
        "mkv" => "video/x-matroska".to_string(),
        "avi" => "video/x-msvideo".to_string(),
        "webm" => "video/webm".to_string(),
        "md" | "markdown" => "text/markdown".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}
