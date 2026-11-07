use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::State;
use crate::DbState;
use crate::models::Photo;
use crate::db::photo_repo;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ICloudPhoto {
    pub id: String,
    pub filename: String,
    pub date: Option<String>,
    pub size: Option<i64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub local_path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ICloudDiffResult {
    pub matched_keep: Vec<ICloudPhoto>,
    pub matched_rejected: Vec<ICloudPhoto>,
    pub orphaned: Vec<ICloudPhoto>,
}

#[tauri::command]
pub fn diff_icloud_photos(state: State<DbState>) -> Result<ICloudDiffResult, String> {
    #[cfg(target_os = "macos")]
    {
        // 1. Get Photos metadata via JXA
        let jxa_code = r#"
            var app = Application('Photos');
            var ids = app.mediaItems.id();
            var fnames = app.mediaItems.filename();
            var dates = app.mediaItems.date();
            var sizes = app.mediaItems.size();
            var widths = app.mediaItems.width();
            var heights = app.mediaItems.height();
            var res = [];
            for (var i = 0; i < ids.length; i++) {
                res.push({
                    id: ids[i],
                    filename: fnames[i],
                    date: dates[i] ? dates[i].toISOString() : null,
                    size: sizes[i],
                    width: widths[i],
                    height: heights[i]
                });
            }
            JSON.stringify(res);
        "#;

        let output = Command::new("osascript")
            .arg("-l")
            .arg("JavaScript")
            .arg("-e")
            .arg(jxa_code)
            .output()
            .map_err(|e| format!("Failed to execute osascript: {}", e))?;

        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("osascript execution failed: {}", err_msg));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let icloud_photos: Vec<ICloudPhoto> = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse Photos metadata JSON: {}", e))?;

        // 2. Fetch local photos from DB
        let conn = state.0.lock().unwrap();
        let local_photos = photo_repo::get_all(&conn, None)
            .map_err(|e| format!("Failed to fetch photos from local DB: {}", e))?;

        let mut matched_keep = Vec::new();
        let mut matched_rejected = Vec::new();
        let mut orphaned = Vec::new();

        // 3. Classify iCloud photos
        for ic_photo in icloud_photos {
            let mut found_match: Option<&Photo> = None;
            for loc_photo in &local_photos {
                if is_match(&ic_photo, loc_photo) {
                    found_match = Some(loc_photo);
                    break;
                }
            }

            let mut ic_photo = ic_photo;
            match found_match {
                Some(loc_photo) => {
                    ic_photo.local_path = Some(loc_photo.path.clone());
                    if loc_photo.rejected {
                        matched_rejected.push(ic_photo);
                    } else {
                        matched_keep.push(ic_photo);
                    }
                }
                None => {
                    orphaned.push(ic_photo);
                }
            }
        }

        Ok(ICloudDiffResult {
            matched_keep,
            matched_rejected,
            orphaned,
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _state = state;
        Err("iCloud Library Diff is only supported on macOS".to_string())
    }
}

#[tauri::command]
pub fn add_photos_to_icloud_album(state: State<DbState>, photo_ids: Vec<String>) -> Result<u32, String> {
    #[cfg(target_os = "macos")]
    {
        let _state = state;
        if photo_ids.is_empty() {
            return Ok(0);
        }

        // Parse array into JS
        let ids_json = serde_json::to_string(&photo_ids)
            .map_err(|e| format!("Failed to serialize photo IDs: {}", e))?;

        let jxa_code = format!(
            r#"
            function run() {{
                var ids = {};
                var app = Application('Photos');
                var album;
                if (!app.containers.byName('DamRight Rejected').exists()) {{
                    album = app.make({{new: 'album', named: 'DamRight Rejected'}});
                }} else {{
                    album = app.containers.byName('DamRight Rejected');
                }}
                
                var count = 0;
                var items = [];
                for (var i = 0; i < ids.length; i++) {{
                    try {{
                        var item = app.mediaItems.byId(ids[i]);
                        if (item.exists()) {{
                            items.push(item);
                            count++;
                        }}
                    }} catch(e) {{}}
                }}
                
                if (items.length > 0) {{
                    app.add(items, {{to: album}});
                }}
                return count;
            }}
            "#,
            ids_json
        );

        let output = Command::new("osascript")
            .arg("-l")
            .arg("JavaScript")
            .arg("-e")
            .arg(jxa_code)
            .output()
            .map_err(|e| format!("Failed to execute osascript: {}", e))?;

        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("osascript execution failed: {}", err_msg));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let added_count = stdout.parse::<u32>().unwrap_or(0);

        Ok(added_count)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _state = state;
        let _photo_ids = photo_ids;
        Err("iCloud Library Integration is only supported on macOS".to_string())
    }
}

fn parse_date(s: &str) -> Option<chrono::NaiveDateTime> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.naive_utc());
    }
    
    let formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S%.f",
    ];
    
    let clean = s.trim().replace('Z', "");
    for fmt in &formats {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&clean, fmt) {
            return Some(dt);
        }
    }
    None
}

fn is_match(icloud: &ICloudPhoto, local: &Photo) -> bool {
    let size_matches = match (icloud.size, local.file_size) {
        (Some(ic_size), Some(loc_size)) => {
            if ic_size == loc_size {
                true
            } else {
                // Allow metadata-only size differences (e.g., within 100KB and 0.5% difference)
                let diff = (ic_size - loc_size).abs();
                let percentage = (diff as f64) / (ic_size as f64);
                diff <= 100_000 && percentage <= 0.005
            }
        }
        _ => false,
    };

    let dim_matches = match (icloud.width, icloud.height, local.width, local.height) {
        (Some(ic_w), Some(ic_h), Some(loc_w), Some(loc_h)) => {
            (ic_w == loc_w && ic_h == loc_h) || (ic_w == loc_h && ic_h == loc_w) // allow rotation
        }
        _ => false,
    };

    let filename_matches = {
        let ic_path = std::path::Path::new(&icloud.filename);
        if let Some(ic_stem) = ic_path.file_stem().and_then(|s| s.to_str()) {
            let ic_stem_clean = if let Some(idx) = ic_stem.rfind('-') {
                &ic_stem[idx+1..]
            } else if let Some(idx) = ic_stem.rfind('_') {
                &ic_stem[idx+1..]
            } else {
                ic_stem
            };
            
            let local_path_str = local.path.to_lowercase();
            !ic_stem_clean.is_empty() && ic_stem_clean.len() >= 4 && local_path_str.contains(&ic_stem_clean.to_lowercase())
        } else {
            false
        }
    };

    let date_matches = match (&icloud.date, &local.capture_time) {
        (Some(ic_date), Some(loc_date)) => {
            if let (Some(ic_dt), Some(loc_dt)) = (parse_date(ic_date), parse_date(loc_date)) {
                let diff_secs = (ic_dt - loc_dt).num_seconds().abs();
                diff_secs % 900 == 0 && diff_secs <= 86400
            } else {
                false
            }
        }
        _ => false,
    };

    if date_matches && (size_matches || dim_matches || filename_matches) {
        return true;
    }

    if size_matches && filename_matches {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_match_exact() {
        let icloud = ICloudPhoto {
            id: "1".to_string(),
            filename: "IMG_1234.JPG".to_string(),
            date: Some("2026-07-12T16:00:00.000Z".to_string()),
            size: Some(1024),
            width: Some(800),
            height: Some(600),
            local_path: None,
        };

        let local = Photo {
            id: "loc-1".to_string(),
            path: "/path/to/20260712T160000-xyz.JPG".to_string(),
            capture_time: Some("2026-07-12 16:00:00".to_string()),
            file_size: Some(1024),
            width: Some(800),
            height: Some(600),
            ..Photo::default_for_test()
        };

        assert!(is_match(&icloud, &local));
    }

    #[test]
    fn test_is_match_renamed_stem() {
        let icloud = ICloudPhoto {
            id: "1".to_string(),
            filename: "20170104-IMG_4964.JPG".to_string(),
            date: Some("2017-01-04T04:57:42.000Z".to_string()),
            size: Some(2177351),
            width: Some(3264),
            height: Some(2448),
            local_path: None,
        };

        let local = Photo {
            id: "loc-1".to_string(),
            path: "/path/to/20170104T045742-abc.JPG".to_string(),
            capture_time: Some("2017-01-04 04:57:42".to_string()),
            file_size: Some(2177351),
            width: Some(3264),
            height: Some(2448),
            ..Photo::default_for_test()
        };

        assert!(is_match(&icloud, &local));
    }

    #[test]
    fn test_no_match() {
        let icloud = ICloudPhoto {
            id: "1".to_string(),
            filename: "IMG_1234.JPG".to_string(),
            date: Some("2026-07-12T16:00:00.000Z".to_string()),
            size: Some(1024),
            width: Some(800),
            height: Some(600),
            local_path: None,
        };

        let local = Photo {
            id: "loc-1".to_string(),
            path: "/path/to/20260712T170500-xyz.JPG".to_string(), // different time (non-timezone-aligned)
            capture_time: Some("2026-07-12 17:05:00".to_string()),
            file_size: Some(2048), // different size
            width: Some(800),
            height: Some(600),
            ..Photo::default_for_test()
        };

        assert!(!is_match(&icloud, &local));
    }

    #[test]
    fn test_is_match_timezone_shifted() {
        let icloud = ICloudPhoto {
            id: "1".to_string(),
            filename: "IMG_7713.HEIC".to_string(),
            date: Some("2023-06-24T12:00:28.000Z".to_string()),
            size: Some(1254113),
            width: Some(2316),
            height: Some(3088),
            local_path: None,
        };

        let local = Photo {
            id: "loc-1".to_string(),
            path: "/path/to/20230624T140028-376.heic".to_string(),
            capture_time: Some("2023-06-24 14:00:28".to_string()),
            file_size: Some(1254113),
            width: Some(2316),
            height: Some(3088),
            ..Photo::default_for_test()
        };

        assert!(is_match(&icloud, &local));
    }

    #[test]
    fn test_is_match_approx_size() {
        let icloud = ICloudPhoto {
            id: "1".to_string(),
            filename: "20170112-DSC_0405_v1.jpg".to_string(),
            date: Some("2017-01-12T03:53:39.000Z".to_string()),
            size: Some(8722160),
            width: Some(3696),
            height: Some(2448),
            local_path: None,
        };

        let local = Photo {
            id: "loc-1".to_string(),
            path: "/path/to/20170112T145339-a05.jpg".to_string(),
            capture_time: Some("2017-01-12 14:53:39".to_string()),
            file_size: Some(8723194),
            width: Some(3696),
            height: Some(2448),
            ..Photo::default_for_test()
        };

        assert!(is_match(&icloud, &local));
    }
}
