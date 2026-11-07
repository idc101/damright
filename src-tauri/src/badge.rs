use std::path::{Path, PathBuf};
use rusqlite::Connection;

#[cfg(target_os = "macos")]
pub fn set_dock_badge(count: usize) {
    use std::ffi::CString;
    use std::os::raw::c_char;

    extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut std::ffi::c_void;
        fn sel_registerName(name: *const c_char) -> *mut std::ffi::c_void;
        fn objc_msgSend(
            target: *mut std::ffi::c_void,
            sel: *mut std::ffi::c_void,
            ...
        ) -> *mut std::ffi::c_void;
    }

    unsafe {
        let ns_app_cls = objc_getClass(CString::new("NSApplication").unwrap().as_ptr());
        if ns_app_cls.is_null() {
            return;
        }
        let sel_shared_app = sel_registerName(CString::new("sharedApplication").unwrap().as_ptr());
        let app = objc_msgSend(ns_app_cls, sel_shared_app);
        if app.is_null() {
            return;
        }
        let sel_dock_tile = sel_registerName(CString::new("dockTile").unwrap().as_ptr());
        let dock_tile = objc_msgSend(app, sel_dock_tile);
        if dock_tile.is_null() {
            return;
        }
        let sel_set_badge = sel_registerName(CString::new("setBadgeLabel:").unwrap().as_ptr());

        if count > 0 {
            let label_str = CString::new(count.to_string()).unwrap();
            let ns_string_cls = objc_getClass(CString::new("NSString").unwrap().as_ptr());
            let sel_utf8 = sel_registerName(CString::new("stringWithUTF8String:").unwrap().as_ptr());
            let ns_str = objc_msgSend(ns_string_cls, sel_utf8, label_str.as_ptr());
            objc_msgSend(dock_tile, sel_set_badge, ns_str);
        } else {
            objc_msgSend(dock_tile, sel_set_badge, std::ptr::null_mut::<std::ffi::c_void>());
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_dock_badge(_count: usize) {
    // No-op on non-macOS platforms
}

pub fn get_inbox_count(conn: &Connection) -> anyhow::Result<usize> {
    let sql = "
        SELECT COUNT(*) 
        FROM photos 
        LEFT JOIN sources ON photos.source_id = sources.id 
        WHERE photos.rejected = 0 AND (
            sources.sync_mode = 'pull' 
            OR LOWER(sources.name) = 'inbox' 
            OR LOWER(sources.path) LIKE '%/inbox'
            OR LOWER(sources.path) LIKE '%/inbox/'
            OR LOWER(photos.path) LIKE '%inbox/%' 
            OR LOWER(photos.path) LIKE 'inbox/%' 
            OR LOWER(photos.path) = 'inbox'
        )
    ";
    let db_count: i64 = conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0);
    let db_count = db_count as usize;
    let disk_count = get_inbox_disk_count(conn);

    Ok(std::cmp::max(db_count, disk_count))
}

fn get_inbox_disk_count(conn: &Connection) -> usize {
    let mut inbox_path: Option<PathBuf> = None;
    if let Ok(mut stmt) = conn.prepare("SELECT path FROM sources WHERE sync_mode = 'pull' OR LOWER(name) = 'inbox' OR LOWER(path) LIKE '%/inbox'") {
        if let Ok(mut rows) = stmt.query([]) {
            if let Ok(Some(row)) = rows.next() {
                if let Ok(p) = row.get::<_, String>(0) {
                    inbox_path = Some(PathBuf::from(p));
                }
            }
        }
    }

    let total_sources: i64 = conn.query_row("SELECT COUNT(*) FROM sources", [], |r| r.get(0)).unwrap_or(0);
    if inbox_path.is_none() && total_sources == 0 && !cfg!(test) {
        if let Some(pic_dir) = dirs::picture_dir() {
            let p = pic_dir.join("Inbox");
            if p.exists() {
                inbox_path = Some(p);
            }
        }
    }

    let Some(path) = inbox_path else {
        return 0;
    };

    if !path.is_dir() {
        return 0;
    }

    count_media_files_in_dir(&path)
}

fn count_media_files_in_dir(dir: &Path) -> usize {
    let mut count = 0;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };

    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            let filename = p.file_name().and_then(|f| f.to_str()).unwrap_or("");
            if filename.starts_with('.') {
                continue;
            }
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if is_media_extension(&ext) {
                count += 1;
            }
        } else if p.is_dir() {
            let dirname = p.file_name().and_then(|f| f.to_str()).unwrap_or("");
            if !dirname.starts_with('.') && dirname.to_lowercase() != "archive" {
                count += count_media_files_in_dir(&p);
            }
        }
    }

    count
}

fn is_media_extension(ext: &str) -> bool {
    matches!(
        ext,
        "jpg" | "jpeg" | "png" | "heic" | "heif" | "webp" | "tiff" | "tif" |
        "cr2" | "cr3" | "nef" | "arw" | "dng" | "orf" | "rw2" | "pef" | "raf" |
        "mp4" | "mov" | "m4v" | "avi" | "mkv"
    )
}

pub fn update_inbox_badge(conn: &Connection) -> anyhow::Result<usize> {
    let count = get_inbox_count(conn)?;
    set_dock_badge(count);
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;
    use std::fs::File;

    #[test]
    fn test_set_dock_badge() {
        set_dock_badge(0);
        set_dock_badge(5);
        set_dock_badge(0);
    }

    #[test]
    fn test_get_inbox_count_empty() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_db(tempdir().unwrap().path()).unwrap();
        let count = get_inbox_count(&conn).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_get_inbox_count_db_and_disk() {
        let dir = tempdir().unwrap();
        let conn = crate::db::init_db(dir.path()).unwrap();

        // Create an Inbox source
        let inbox_dir = dir.path().join("Inbox");
        std::fs::create_dir_all(&inbox_dir).unwrap();
        
        conn.execute(
            "INSERT INTO sources (id, path, name, sync_mode) VALUES ('src_inbox', ?, 'Inbox', 'pull')",
            [inbox_dir.to_string_lossy().to_string()],
        ).unwrap();

        // Create 2 dummy media files on disk in Inbox
        File::create(inbox_dir.join("photo1.jpg")).unwrap();
        File::create(inbox_dir.join("photo2.png")).unwrap();
        File::create(inbox_dir.join("ignore.txt")).unwrap();

        let count = get_inbox_count(&conn).unwrap();
        assert_eq!(count, 2);

        // Add 1 photo record to DB in inbox source
        conn.execute(
            "INSERT INTO photos (id, path, thumb_path, source_id, rejected) VALUES ('p1', 'photo1.jpg', 'thumb1.jpg', 'src_inbox', 0)",
            [],
        ).unwrap();

        let count2 = get_inbox_count(&conn).unwrap();
        assert_eq!(count2, 2);

        // Reject p1
        conn.execute("UPDATE photos SET rejected = 1 WHERE id = 'p1'", []).unwrap();
        // Since 2 physical media files exist on disk, max(1 db active, 2 disk) is 2
        let count3 = get_inbox_count(&conn).unwrap();
        assert_eq!(count3, 2);

        // Delete files from disk, now DB has 0 active photos
        std::fs::remove_file(inbox_dir.join("photo1.jpg")).unwrap();
        std::fs::remove_file(inbox_dir.join("photo2.png")).unwrap();

        let count4 = get_inbox_count(&conn).unwrap();
        assert_eq!(count4, 0);

        let updated = update_inbox_badge(&conn).unwrap();
        assert_eq!(updated, 0);
    }
}
