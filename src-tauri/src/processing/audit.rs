use std::path::Path;
use crate::models::Photo;
use regex::Regex;
use std::sync::OnceLock;

static RE_DATE_YYYY_MM_DD: OnceLock<Regex> = OnceLock::new();
static RE_DATE_YYYY_MM: OnceLock<Regex> = OnceLock::new();
static RE_DATE_YYYY: OnceLock<Regex> = OnceLock::new();
static RE_NAMING_CONVENTION: OnceLock<Regex> = OnceLock::new();

pub fn is_photo_misplaced(photo: &Photo) -> bool {
    if photo.event.as_deref().unwrap_or("").is_empty() {
        return true;
    }
    if photo.capture_time.as_deref().unwrap_or("").is_empty() {
        return true;
    }
    if is_name_misplaced(photo) {
        return true;
    }
    if is_folder_misplaced(photo) {
        return true;
    }
    false
}

pub fn compute_validation_status(photo: &Photo) -> (bool, String) {
    let mut issues = Vec::new();
    if photo.event.as_deref().unwrap_or("").is_empty() {
        issues.push("missing_event");
    }
    if photo.capture_time.as_deref().unwrap_or("").is_empty() {
        issues.push("missing_capture_time");
    }
    if is_name_misplaced(photo) {
        issues.push("bad_name");
    }
    if is_folder_misplaced(photo) {
        issues.push("bad_folder");
    }
    (issues.is_empty(), issues.join(","))
}

pub fn update_photo_validation(conn: &rusqlite::Connection, id: &str) -> anyhow::Result<()> {
    let photo = crate::db::photo_repo::get_by_id(conn, id)?;
    let (is_valid, issues) = compute_validation_status(&photo);
    crate::db::photo_repo::update_validation_status(conn, id, is_valid, &issues)?;
    Ok(())
}

pub fn format_event_name(name: &str) -> String {
    let spaced = name.replace('_', " ").replace('-', " ");
    spaced.split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

pub fn fix_validation_issues(conn: &rusqlite::Connection, ids: Option<Vec<String>>) -> anyhow::Result<usize> {
    let photos = if let Some(target_ids) = ids {
        let mut loaded = Vec::new();
        for id in target_ids {
            if let Ok(photo) = crate::db::photo_repo::get_by_id(conn, &id) {
                loaded.push(photo);
            }
        }
        loaded
    } else {
        crate::db::photo_repo::get_all(conn, None)?
    };
    let mut fixed_count = 0;

    let re_yyyy_mm_dd = Regex::new(r"^(\d{4})-(\d{2})-(\d{2})$").unwrap();
    let re_yyyy_mm = Regex::new(r"^(\d{4})-(\d{2})$").unwrap();
    let re_yyyy = Regex::new(r"^(\d{4})$").unwrap();

    for photo in photos {
        let photo_id = photo.id.clone();
        let current_event = photo.event.clone();
        let mut current_photo = photo;
        let mut was_fixed = false;

        // 0. Recover missing capture time from file if empty in DB
        if current_photo.capture_time.as_deref().unwrap_or("").is_empty() {
            if let Some(dt) = crate::processing::metadata::get_capture_time(Path::new(&current_photo.path)) {
                let ct_str = dt.format("%Y-%m-%d %H:%M:%S").to_string();
                if crate::db::photo_repo::update_capture_time(conn, &photo_id, &ct_str).is_ok() {
                    let _ = update_photo_validation(conn, &photo_id);
                    if let Ok(updated) = crate::db::photo_repo::get_by_id(conn, &photo_id) {
                        current_photo = updated;
                        was_fixed = true;
                    }
                }
            } else {
                // Last resort: Fall back to file modification date
                if let Ok(metadata) = std::fs::metadata(Path::new(&current_photo.path)) {
                    if let Ok(modified) = metadata.modified() {
                        let dt: chrono::DateTime<chrono::Local> = modified.into();
                        let ct_str = dt.format("%Y-%m-%d %H:%M:%S").to_string();
                        if crate::db::photo_repo::update_capture_time(conn, &photo_id, &ct_str).is_ok() {
                            let _ = update_photo_validation(conn, &photo_id);
                            if let Ok(updated) = crate::db::photo_repo::get_by_id(conn, &photo_id) {
                                current_photo = updated;
                                was_fixed = true;
                            }
                        }
                    }
                }
            }
        }

        // 1. Missing Event
        if current_event.as_deref().unwrap_or("").is_empty() {
            let path_obj = Path::new(&current_photo.path);
            let mut current = path_obj.parent();
            let mut suggested_event = None;

            while let Some(p) = current {
                if let Some(folder_name) = p.file_name().and_then(|s| s.to_str()) {
                    let is_date = re_yyyy_mm_dd.is_match(folder_name) ||
                                  re_yyyy_mm.is_match(folder_name) ||
                                  (re_yyyy.is_match(folder_name) && folder_name.parse::<i32>().map(|y| y >= 1800 && y <= 2100).unwrap_or(false));
                    
                    if !is_date && !folder_name.is_empty() {
                        suggested_event = Some(format_event_name(folder_name));
                        break;
                    }
                }
                current = p.parent();
            }

            let event_to_set = suggested_event.unwrap_or_else(|| "Uncategorized".to_string());
            crate::processing::metadata::update_event(&photo_id, Some(event_to_set), conn)?;
            
            if let Ok(updated) = crate::db::photo_repo::get_by_id(conn, &photo_id) {
                current_photo = updated;
            }
            was_fixed = true;
        }

        // 2. Incorrect Folder / Location
        if is_folder_misplaced(&current_photo) {
            if let Some(capture_time) = &current_photo.capture_time {
                if capture_time.len() >= 10 {
                    let ct_year = &capture_time[0..4];
                    let ct_month = &capture_time[5..7];
                    let ct_day = &capture_time[8..10];

                    let path_obj = Path::new(&current_photo.path);
                    if let Some(parent) = path_obj.parent() {
                        if path_obj.file_name().is_some() {
                            let mut new_parent = std::path::PathBuf::new();
                            let mut changed = false;

                            for component in parent.components() {
                                let folder_name = component.as_os_str().to_str().unwrap_or("");
                                if re_yyyy_mm_dd.is_match(folder_name) {
                                    let expected = format!("{}-{}-{}", ct_year, ct_month, ct_day);
                                    if folder_name != expected {
                                        new_parent.push(expected);
                                        changed = true;
                                    } else {
                                        new_parent.push(component);
                                    }
                                } else if re_yyyy_mm.is_match(folder_name) {
                                    let expected = format!("{}-{}", ct_year, ct_month);
                                    if folder_name != expected {
                                        new_parent.push(expected);
                                        changed = true;
                                    } else {
                                        new_parent.push(component);
                                    }
                                } else if re_yyyy.is_match(folder_name) {
                                    if let Ok(year_num) = folder_name.parse::<i32>() {
                                        if year_num >= 1800 && year_num <= 2100 {
                                            if folder_name != ct_year {
                                                new_parent.push(ct_year);
                                                changed = true;
                                            } else {
                                                new_parent.push(component);
                                            }
                                        } else {
                                            new_parent.push(component);
                                        }
                                    } else {
                                        new_parent.push(component);
                                    }
                                } else {
                                    new_parent.push(component);
                                }
                            }

                            if changed {
                                let dest_folder = new_parent.to_string_lossy().to_string();
                                if let Ok(_) = crate::processing::storage::AssetStorage::move_photos(conn, &[photo_id.clone()], &dest_folder) {
                                    if let Ok(updated) = crate::db::photo_repo::get_by_id(conn, &photo_id) {
                                        current_photo = updated;
                                    }
                                    was_fixed = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        // 3. Incorrect Name
        if is_name_misplaced(&current_photo) {
            if current_photo.capture_time.is_some() {
                if crate::processing::storage::AssetStorage::auto_rename_photo(conn, &photo_id).is_ok() {
                    was_fixed = true;
                }
            }
        }

        if was_fixed {
            fixed_count += 1;
        }
    }

    Ok(fixed_count)
}

fn is_name_misplaced(photo: &Photo) -> bool {
    let path = Path::new(&photo.path);
    let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("");

    // 1. Check if it matches the general pattern
    let re_naming = RE_NAMING_CONVENTION.get_or_init(|| Regex::new(r"^\d{8}T\d{6}-[a-f0-9]{3}\.").unwrap());
    if !re_naming.is_match(filename) {
        return true;
    }

    // 2. Check if the timestamp in the name matches the capture_time
    let capture_time = match &photo.capture_time {
        Some(ct) if !ct.trim().is_empty() => ct,
        _ => return false, // Skip checks if no capture time exists (missing_capture_time validation rule handles it)
    };

    // capture_time: "YYYY-MM-DD HH:MM:SS"
    // filename starts with: "YYYYMMDDTHHMMSS"
    let expected_prefix = capture_time.replace("-", "").replace(" ", "T").replace(":", "");
    if !filename.starts_with(&expected_prefix) {
        return true;
    }

    false
}

fn is_folder_misplaced(photo: &Photo) -> bool {
    let path = Path::new(&photo.path);
    let capture_time = match &photo.capture_time {
        Some(ct) => ct,
        None => return false, // Can't check folder if no capture date
    };

    // Extract year, month, day from capture_time "YYYY-MM-DD HH:MM:SS"
    let ct_year = &capture_time[0..4];
    let ct_month = &capture_time[5..7];
    let ct_day = &capture_time[8..10];

    let parent = match path.parent() {
        Some(p) => p,
        None => return false,
    };

    let re_yyyy_mm_dd = RE_DATE_YYYY_MM_DD.get_or_init(|| Regex::new(r"(\d{4})-(\d{2})-(\d{2})").unwrap());
    let re_yyyy_mm = RE_DATE_YYYY_MM.get_or_init(|| Regex::new(r"(\d{4})-(\d{2})").unwrap());
    let re_yyyy = RE_DATE_YYYY.get_or_init(|| Regex::new(r"(\d{4})").unwrap());

    // Check each component of the path
    for component in parent.components() {
        if let Some(folder_name) = component.as_os_str().to_str() {
            // Check YYYY-MM-DD
            if let Some(caps) = re_yyyy_mm_dd.captures(folder_name) {
                let y = caps.get(1).unwrap().as_str();
                let m = caps.get(2).unwrap().as_str();
                let d = caps.get(3).unwrap().as_str();
                if y != ct_year || m != ct_month || d != ct_day {
                    return true;
                }
                continue; // Found a match, assume this is the date folder
            }

            // Check YYYY-MM
            if let Some(caps) = re_yyyy_mm.captures(folder_name) {
                let y = caps.get(1).unwrap().as_str();
                let m = caps.get(2).unwrap().as_str();
                if y != ct_year || m != ct_month {
                    return true;
                }
                continue;
            }

            // Check YYYY
            if let Some(caps) = re_yyyy.captures(folder_name) {
                // To avoid matching random 4-digit numbers as years, 
                // we only check if it looks like a year (1900-2100)
                let y = caps.get(1).unwrap().as_str();
                if let Ok(year_num) = y.parse::<i32>() {
                    if year_num >= 1800 && year_num <= 2100 {
                        if y != ct_year {
                            return true;
                        }
                    }
                }
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Photo;

    fn create_test_photo(path: &str, capture_time: &str) -> Photo {
        Photo {
            id: "test".to_string(),
            path: path.to_string(),
            capture_time: Some(capture_time.to_string()),
            event: Some("Test Event".to_string()),
            ..Photo::default_for_test()
        }
    }

    #[test]
    fn test_event_missing() {
        let mut photo = create_test_photo("/2023/20230513T123045-abc.jpg", "2023-05-13 12:30:45");
        assert!(!is_photo_misplaced(&photo));
        
        photo.event = None;
        assert!(is_photo_misplaced(&photo));
        
        photo.event = Some("".to_string());
        assert!(is_photo_misplaced(&photo));
    }

    #[test]
    fn test_name_naming_convention() {
        // Correct naming: YYYYMMDDTHHMMSS-hash.ext
        let photo = create_test_photo("/2023/20230513T123045-abc.jpg", "2023-05-13 12:30:45");
        assert!(!is_photo_misplaced(&photo));

        // Incorrect name
        let photo = create_test_photo("/2023/IMG_1234.JPG", "2023-05-13 12:30:45");
        assert!(is_photo_misplaced(&photo));

        // Correct format but mismatched timestamp
        let photo = create_test_photo("/2023/20230513T123045-abc.jpg", "2023-05-14 12:30:45");
        assert!(is_photo_misplaced(&photo));
    }

    #[test]
    fn test_folder_matching() {
        // Correct folder YYYY
        let photo = create_test_photo("/2023/20230513T123045-abc.jpg", "2023-05-13 12:30:45");
        assert!(!is_photo_misplaced(&photo));

        // Mismatched folder YYYY
        let photo = create_test_photo("/2022/20230513T123045-abc.jpg", "2023-05-13 12:30:45");
        assert!(is_photo_misplaced(&photo));

        // Correct folder YYYY-MM
        let photo = create_test_photo("/2023-05/20230513T123045-abc.jpg", "2023-05-13 12:30:45");
        assert!(!is_photo_misplaced(&photo));

        // Mismatched folder YYYY-MM
        let photo = create_test_photo("/2023-06/20230513T123045-abc.jpg", "2023-05-13 12:30:45");
        assert!(is_photo_misplaced(&photo));

        // Correct folder YYYY-MM-DD
        let photo = create_test_photo("/2023-05-13/20230513T123045-abc.jpg", "2023-05-13 12:30:45");
        assert!(!is_photo_misplaced(&photo));

        // Mismatched folder YYYY-MM-DD
        let photo = create_test_photo("/2023-05-14/20230513T123045-abc.jpg", "2023-05-13 12:30:45");
        assert!(is_photo_misplaced(&photo));
    }
}
