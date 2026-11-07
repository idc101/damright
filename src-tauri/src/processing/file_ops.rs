use std::path::Path;
use rusqlite::Connection;
use uuid::Uuid;
use crate::models::{Source, DirEntry};
use crate::db::{photo_repo, source_repo};

pub fn add_source(path: &str, conn: &Connection) -> anyhow::Result<Source> {
    let id = Uuid::new_v4().to_string();
    let name = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string();

    let is_inbox = name.to_lowercase().contains("inbox") || path.to_lowercase().contains("inbox");
    let source = Source {
        id: id.clone(),
        path: path.to_string(),
        name,
        sync_mode: "none".to_string(),
        server_path: None,
        archive_prefix: None,
        rating_enabled: !is_inbox,
    };

    source_repo::insert(conn, &source)?;
    Ok(source)
}

pub fn cleanup_database(conn: &Connection) -> anyhow::Result<usize> {
    let sources = source_repo::get_all(conn)?;
    let photos = photo_repo::get_all(conn, None)?;
    
    let mut to_delete = Vec::new();
    for photo in photos {
        let norm_photo = photo.path.replace('\\', "/");
        let mut has_source = false;
        for source in &sources {
            let norm_src = source.path.replace('\\', "/");
            if norm_photo.starts_with(&norm_src) {
                has_source = true;
                break;
            }
        }
        if !has_source {
            to_delete.push(photo.id);
        }
    }

    let count = to_delete.len();
    for id in to_delete {
        photo_repo::delete_by_id(conn, &id)?;
    }

    Ok(count)
}

pub fn get_dir_tree(conn: &Connection, path: &str) -> anyhow::Result<DirEntry> {
    struct DirNode {
        name: String,
        path: String,
        direct_photo_count: usize,
        children: std::collections::BTreeMap<String, DirNode>,
    }

    impl DirNode {
        fn into_dir_entry(self) -> DirEntry {
            let mut total_count = self.direct_photo_count;
            let mut children = Vec::with_capacity(self.children.len());

            for (_, child_node) in self.children {
                let child_entry = child_node.into_dir_entry();
                total_count += child_entry.photo_count;
                children.push(child_entry);
            }

            // Sort descending by name (newest years/dates first)
            children.sort_by(|a, b| b.name.cmp(&a.name));

            DirEntry {
                name: self.name,
                path: self.path,
                children,
                photo_count: total_count,
            }
        }
    }

    let root_path_obj = Path::new(path);
    let root_name = root_path_obj
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string();

    let mut root_node = DirNode {
        name: root_name,
        path: path.to_string(),
        direct_photo_count: 0,
        children: std::collections::BTreeMap::new(),
    };

    let photos = photo_repo::get_photo_paths_by_prefix(conn, path)?;

    let norm_root = path.replace('\\', "/");
    let norm_root_trimmed = norm_root.trim_end_matches('/');

    for (_id, photo_path) in photos {
        let norm_photo = photo_path.replace('\\', "/");

        let parent_folder = match norm_photo.rfind('/') {
            Some(idx) => &norm_photo[..idx],
            None => "",
        };

        if parent_folder == norm_root_trimmed || (norm_root_trimmed.is_empty() && parent_folder.is_empty()) {
            root_node.direct_photo_count += 1;
        } else if parent_folder.starts_with(norm_root_trimmed) {
            let rel_str = if norm_root_trimmed.is_empty() {
                parent_folder.trim_start_matches('/')
            } else if parent_folder.len() > norm_root_trimmed.len() && parent_folder.as_bytes()[norm_root_trimmed.len()] == b'/' {
                &parent_folder[norm_root_trimmed.len() + 1..]
            } else {
                continue;
            };

            let segments: Vec<&str> = rel_str.split('/').filter(|s| !s.is_empty()).collect();
            if segments.is_empty() {
                root_node.direct_photo_count += 1;
                continue;
            }

            let mut curr = &mut root_node;
            let mut curr_path = Path::new(path).to_path_buf();
            for seg in segments {
                curr_path.push(seg);
                let curr_path_str = curr_path.to_string_lossy().to_string();
                curr = curr.children.entry(seg.to_string()).or_insert_with(|| DirNode {
                    name: seg.to_string(),
                    path: curr_path_str,
                    direct_photo_count: 0,
                    children: std::collections::BTreeMap::new(),
                });
            }
            curr.direct_photo_count += 1;
        }
    }

    Ok(root_node.into_dir_entry())
}

pub fn auto_rename_folder(
    folder_path: &str,
    conn: &Connection,
) -> anyhow::Result<usize> {
    crate::processing::storage::AssetStorage::auto_rename_folder(conn, folder_path)
}

pub fn auto_rename_photo(
    id: &str,
    _current_path: &str,
    conn: &Connection,
) -> anyhow::Result<String> {
    crate::processing::storage::AssetStorage::auto_rename_photo(conn, id)
}

pub use crate::processing::storage::mark_inbox_tombstone_if_needed;

pub fn delete_rejected_in_folder(
    folder_path: &str,
    conn: &Connection,
) -> anyhow::Result<usize> {
    crate::processing::storage::AssetStorage::delete_rejected_in_folder(conn, folder_path)
}

pub fn move_photos(
    ids: Vec<String>,
    dest_folder: &str,
    conn: &Connection,
) -> anyhow::Result<usize> {
    crate::processing::storage::AssetStorage::move_photos(conn, &ids, dest_folder)
}

pub fn delete_photo_by_id(
    id: &str,
    conn: &Connection,
) -> anyhow::Result<()> {
    crate::processing::storage::AssetStorage::delete_photo(conn, id)
}

pub fn move_folder(
    src_path: &str,
    dest_path: &str,
    conn: &Connection,
) -> anyhow::Result<usize> {
    crate::processing::storage::AssetStorage::move_folder(conn, src_path, dest_path)
}



