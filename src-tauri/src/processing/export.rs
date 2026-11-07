use std::path::{Path, PathBuf};
use serde::Deserialize;
use rusqlite::Connection;
use image::codecs::jpeg::JpegEncoder;
use image::GenericImageView;
use crate::models::Photo;
use crate::processing::image::RustImageProcessor;

#[derive(Deserialize, Debug, Clone)]
pub struct ExportConfig {
    pub photo_ids: Vec<String>,
    pub destination_dir: String,
    pub format_mode: String, // "original" | "jpeg"
    pub jpeg_quality: Option<u8>, // 1..=100
    pub max_dimension: Option<u32>,
    pub preserve_folder_structure: bool,
    pub include_xmp: bool,
}

pub fn export_photos(
    conn: &Connection, 
    config: ExportConfig,
    progress_cb: Option<Box<dyn Fn(crate::processing::ProgressPayload) + Send + Sync>>,
) -> anyhow::Result<usize> {
    if config.photo_ids.is_empty() {
        return Ok(0);
    }

    let dest_base = Path::new(&config.destination_dir);
    std::fs::create_dir_all(dest_base)?;

    let total = config.photo_ids.len();
    let mut exported_count = 0;
    let processor = RustImageProcessor;

    for (index, id) in config.photo_ids.iter().enumerate() {
        let photo = match crate::db::photo_repo::get_by_id(conn, id) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let src_path = Path::new(&photo.path);
        if !src_path.exists() {
            eprintln!("Export warning: source file not found: {}", photo.path);
            continue;
        }

        let filename = src_path.file_name().and_then(|s| s.to_str()).unwrap_or("file");
        if let Some(ref cb) = progress_cb {
            cb(crate::processing::ProgressPayload {
                message: format!("Exporting {}", filename),
                current: index + 1,
                total,
            });
        }

        let target_file_path = compute_export_target_path(conn, dest_base, &photo, &config)?;

        if let Some(parent) = target_file_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        if config.format_mode == "original" {
            std::fs::copy(src_path, &target_file_path)?;

            if config.include_xmp {
                let sidecars = crate::processing::storage::AssetStorage::find_sidecars(src_path);
                let src_filename = src_path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                let target_ext = target_file_path.extension().and_then(|e| e.to_str()).unwrap_or("");

                for xmp_path in sidecars {
                    let sidecar_name = xmp_path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    let is_compound = sidecar_name.ends_with(".xmp") && sidecar_name.starts_with(src_filename);
                    let xmp_target = if is_compound {
                        target_file_path.with_extension(format!("{}.xmp", target_ext))
                    } else {
                        target_file_path.with_extension("xmp")
                    };
                    let _ = std::fs::copy(xmp_path, xmp_target);
                }
            }
            exported_count += 1;
        } else if config.format_mode == "jpeg" {
            if let Err(e) = export_as_jpeg(&processor, &photo, &target_file_path, config.jpeg_quality, config.max_dimension) {
                eprintln!("Failed to export photo {} as JPEG: {}", id, e);
                continue;
            }
            exported_count += 1;
        }
    }

    if let Some(ref cb) = progress_cb {
        cb(crate::processing::ProgressPayload {
            message: "Export complete".to_string(),
            current: total,
            total,
        });
    }

    Ok(exported_count)
}

fn is_video_file(photo: &Photo) -> bool {
    let src_path = Path::new(&photo.path);
    let ext = src_path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    photo.mime_type.starts_with("video/") || ext == "mp4" || ext == "mov" || ext == "m4v" || ext == "avi" || ext == "mkv"
}

fn is_markdown_file(photo: &Photo) -> bool {
    let src_path = Path::new(&photo.path);
    let ext = src_path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    photo.mime_type == "text/markdown" || ext == "md" || ext == "markdown"
}

fn compute_export_target_path(
    conn: &Connection,
    dest_base: &Path,
    photo: &Photo,
    config: &ExportConfig,
) -> anyhow::Result<PathBuf> {
    let src_path = Path::new(&photo.path);
    let original_filename = src_path.file_name().ok_or_else(|| anyhow::anyhow!("Invalid filename"))?;

    let mut target_dir = dest_base.to_path_buf();

    if config.preserve_folder_structure {
        if let Ok(mut stmt) = conn.prepare("SELECT path FROM sources") {
            if let Ok(source_paths) = stmt.query_map([], |r| r.get::<_, String>(0)) {
                for src_root_str in source_paths.flatten() {
                    let norm_src_root = Path::new(&src_root_str);
                    if let Ok(rel) = src_path.strip_prefix(norm_src_root) {
                        if let Some(rel_parent) = rel.parent() {
                            target_dir = dest_base.join(rel_parent);
                            break;
                        }
                    }
                }
            }
        }
    }

    let is_passthrough = is_video_file(photo) || is_markdown_file(photo);
    let final_filename = if config.format_mode == "jpeg" && !is_passthrough {
        let stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("export");
        format!("{}.jpg", stem)
    } else {
        original_filename.to_string_lossy().to_string()
    };

    let mut target_path = target_dir.join(&final_filename);

    if target_path.exists() {
        let stem = Path::new(&final_filename).file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = Path::new(&final_filename).extension().and_then(|s| s.to_str()).unwrap_or("jpg");
        let mut counter = 1;
        while target_path.exists() {
            let candidate_name = format!("{}-{}.{}", stem, counter, ext);
            target_path = target_dir.join(candidate_name);
            counter += 1;
        }
    }

    Ok(target_path)
}

fn export_as_jpeg(
    processor: &RustImageProcessor,
    photo: &Photo,
    output_path: &Path,
    quality: Option<u8>,
    max_dimension: Option<u32>,
) -> anyhow::Result<()> {
    let src_path = Path::new(&photo.path);

    // If file is a video or markdown, copy original file as-is
    if is_video_file(photo) || is_markdown_file(photo) {
        std::fs::copy(src_path, output_path)?;
        return Ok(());
    }

    let mut img = processor.load_image(src_path)?;
    img = processor.apply_adjustments(img, photo, true);

    if let Some(max_dim) = max_dimension {
        if max_dim > 0 {
            let (w, h) = img.dimensions();
            if w > max_dim || h > max_dim {
                let (nw, nh) = if w >= h {
                    (max_dim, ((max_dim * h) / w).max(1))
                } else {
                    (((max_dim * w) / h).max(1), max_dim)
                };
                img = img.resize_exact(nw, nh, image::imageops::FilterType::Lanczos3);
            }
        }
    }

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let file = std::fs::File::create(output_path)?;
    let mut writer = std::io::BufWriter::new(file);
    let q = quality.unwrap_or(85).clamp(1, 100);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, q);
    encoder.encode_image(&img)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use crate::db::init_db;
    use crate::db::photo_repo::insert;

    #[test]
    fn test_export_photos_original() -> anyhow::Result<()> {
        let dir = tempdir()?;
        let conn = init_db(dir.path())?;

        let src_dir = dir.path().join("src");
        let dest_dir = dir.path().join("export");
        std::fs::create_dir_all(&src_dir)?;

        let img_path = src_dir.join("test.jpg");
        std::fs::write(&img_path, b"mock image data")?;

        let photo = Photo {
            id: "p1".to_string(),
            path: img_path.to_string_lossy().to_string(),
            thumb_path: "t1".to_string(),
            ..Photo::default_for_test()
        };
        insert(&conn, &photo)?;

        let config = ExportConfig {
            photo_ids: vec!["p1".to_string()],
            destination_dir: dest_dir.to_string_lossy().to_string(),
            format_mode: "original".to_string(),
            jpeg_quality: None,
            max_dimension: None,
            preserve_folder_structure: false,
            include_xmp: true,
        };

        let count = export_photos(&conn, config, None)?;
        assert_eq!(count, 1);
        assert!(dest_dir.join("test.jpg").exists());
        Ok(())
    }

    #[test]
    fn test_export_video_fallback() -> anyhow::Result<()> {
        let dir = tempdir()?;
        let conn = init_db(dir.path())?;

        let src_dir = dir.path().join("src");
        let dest_dir = dir.path().join("export");
        std::fs::create_dir_all(&src_dir)?;

        let video_path = src_dir.join("test.mp4");
        std::fs::write(&video_path, b"mock video data")?;

        let photo = Photo {
            id: "p_video".to_string(),
            path: video_path.to_string_lossy().to_string(),
            thumb_path: "tv".to_string(),
            mime_type: "video/mp4".to_string(),
            ..Photo::default_for_test()
        };
        insert(&conn, &photo)?;

        let config = ExportConfig {
            photo_ids: vec!["p_video".to_string()],
            destination_dir: dest_dir.to_string_lossy().to_string(),
            format_mode: "jpeg".to_string(),
            jpeg_quality: Some(85),
            max_dimension: None,
            preserve_folder_structure: false,
            include_xmp: false,
        };

        let count = export_photos(&conn, config, None)?;
        assert_eq!(count, 1);
        assert!(dest_dir.join("test.mp4").exists());
        Ok(())
    }
}
