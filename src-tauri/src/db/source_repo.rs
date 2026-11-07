use rusqlite::{params, Connection};
use crate::models::Source;

pub fn get_all(conn: &Connection) -> anyhow::Result<Vec<Source>> {
    let mut stmt = conn.prepare("SELECT id, path, name, sync_mode, server_path, archive_prefix, rating_enabled FROM sources")?;
    let source_iter = stmt.query_map([], |row| {
        let sync_mode_res: Option<String> = row.get(3).ok();
        let rating_enabled_res: Option<i64> = row.get(6).ok();
        Ok(Source {
            id: row.get(0)?,
            path: row.get(1)?,
            name: row.get(2)?,
            sync_mode: sync_mode_res.unwrap_or_else(|| "none".to_string()),
            server_path: row.get(4).ok(),
            archive_prefix: row.get(5).ok(),
            rating_enabled: rating_enabled_res.map(|v| v != 0).unwrap_or(true),
        })
    })?;

    let mut sources = Vec::new();
    for source in source_iter {
        sources.push(source?);
    }
    Ok(sources)
}

pub fn insert(conn: &Connection, source: &Source) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO sources (id, path, name, sync_mode, server_path, archive_prefix, rating_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![
            source.id,
            source.path,
            source.name,
            source.sync_mode,
            source.server_path,
            source.archive_prefix,
            if source.rating_enabled { 1 } else { 0 }
        ],
    )?;
    Ok(())
}

pub fn update_sync_settings(
    conn: &Connection,
    id: &str,
    sync_mode: &str,
    server_path: Option<&str>,
    archive_prefix: Option<&str>,
    rating_enabled: Option<bool>,
) -> anyhow::Result<()> {
    let rating_int = rating_enabled.map(|b| if b { 1 } else { 0 });
    conn.execute(
        "UPDATE sources SET sync_mode = ?, server_path = ?, archive_prefix = ?, rating_enabled = COALESCE(?, rating_enabled) WHERE id = ?",
        params![sync_mode, server_path, archive_prefix, rating_int, id],
    )?;
    Ok(())
}

pub fn delete_source(conn: &Connection, id: &str) -> anyhow::Result<()> {
    conn.execute("DELETE FROM sources WHERE id = ?", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_source_repo_crud() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE sources (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                sync_mode TEXT NOT NULL DEFAULT 'none',
                server_path TEXT,
                archive_prefix TEXT,
                rating_enabled INTEGER NOT NULL DEFAULT 1
            )",
            [],
        ).unwrap();

        let s1 = Source {
            id: "src1".to_string(),
            path: "/tmp/pics".to_string(),
            name: "Pictures".to_string(),
            sync_mode: "push".to_string(),
            server_path: Some("Pictures".to_string()),
            archive_prefix: None,
            rating_enabled: false,
        };

        insert(&conn, &s1).unwrap();

        let all = get_all(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].sync_mode, "push");
        assert_eq!(all[0].server_path.as_deref(), Some("Pictures"));
        assert_eq!(all[0].rating_enabled, false);

        update_sync_settings(&conn, "src1", "pull", Some("PicturesRemote"), Some("archive"), Some(true)).unwrap();
        let updated = get_all(&conn).unwrap();
        assert_eq!(updated[0].sync_mode, "pull");
        assert_eq!(updated[0].server_path.as_deref(), Some("PicturesRemote"));
        assert_eq!(updated[0].archive_prefix.as_deref(), Some("archive"));
        assert_eq!(updated[0].rating_enabled, true);

        delete_source(&conn, "src1").unwrap();
        let empty = get_all(&conn).unwrap();
        assert_eq!(empty.len(), 0);
    }
}
