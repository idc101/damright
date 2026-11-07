use serde::{Deserialize, Serialize};
use rusqlite::{params, Connection, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SyncStateRecord {
    pub relative_path: String,
    pub file_size: i64,
    pub mtime: i64,
    pub hash: Option<String>,
    pub last_synced_at: String,
    pub status: String,
}

pub fn get_sync_state(conn: &Connection, relative_path: &str) -> Result<Option<SyncStateRecord>> {
    let mut stmt = conn.prepare(
        "SELECT relative_path, file_size, mtime, hash, last_synced_at, status FROM sync_state WHERE LOWER(relative_path) = LOWER(?)"
    )?;
    let mut rows = stmt.query(params![relative_path])?;
    if let Some(row) = rows.next()? {
        Ok(Some(SyncStateRecord {
            relative_path: row.get(0)?,
            file_size: row.get(1)?,
            mtime: row.get(2)?,
            hash: row.get(3)?,
            last_synced_at: row.get(4)?,
            status: row.get(5)?,
        }))
    } else {
        Ok(None)
    }
}

pub fn get_all_sync_states(conn: &Connection) -> Result<Vec<SyncStateRecord>> {
    let mut stmt = conn.prepare(
        "SELECT relative_path, file_size, mtime, hash, last_synced_at, status FROM sync_state"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SyncStateRecord {
            relative_path: row.get(0)?,
            file_size: row.get(1)?,
            mtime: row.get(2)?,
            hash: row.get(3)?,
            last_synced_at: row.get(4)?,
            status: row.get(5)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub fn set_sync_state(conn: &Connection, record: &SyncStateRecord) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_state (relative_path, file_size, mtime, hash, last_synced_at, status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(relative_path) DO UPDATE SET
             file_size = excluded.file_size,
             mtime = excluded.mtime,
             hash = excluded.hash,
             last_synced_at = excluded.last_synced_at,
             status = excluded.status",
        params![
            record.relative_path,
            record.file_size,
            record.mtime,
            record.hash,
            record.last_synced_at,
            record.status,
        ],
    )?;
    Ok(())
}

pub fn set_sync_states_batch(conn: &Connection, records: &[SyncStateRecord]) -> Result<()> {
    if records.is_empty() {
        return Ok(());
    }
    conn.execute_batch("BEGIN TRANSACTION;")?;
    {
        let mut stmt = conn.prepare(
            "INSERT INTO sync_state (relative_path, file_size, mtime, hash, last_synced_at, status)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(relative_path) DO UPDATE SET
                 file_size = excluded.file_size,
                 mtime = excluded.mtime,
                 hash = excluded.hash,
                 last_synced_at = excluded.last_synced_at,
                 status = excluded.status",
        )?;
        for record in records {
            stmt.execute(params![
                record.relative_path,
                record.file_size,
                record.mtime,
                record.hash,
                record.last_synced_at,
                record.status,
            ])?;
        }
    }
    conn.execute_batch("COMMIT;")?;
    Ok(())
}

pub fn remove_sync_state(conn: &Connection, relative_path: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM sync_state WHERE LOWER(relative_path) = LOWER(?)",
        params![relative_path],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use crate::db::init_db;

    #[test]
    fn test_sync_state_crud() {
        let dir = tempdir().unwrap();
        let conn = init_db(dir.path()).unwrap();

        let rec = SyncStateRecord {
            relative_path: "2026/08-04/test.jpg".to_string(),
            file_size: 1024,
            mtime: 1700000000,
            hash: Some("abc123hash".to_string()),
            last_synced_at: "2026-08-04T19:30:00Z".to_string(),
            status: "synced".to_string(),
        };

        set_sync_state(&conn, &rec).unwrap();

        let fetched = get_sync_state(&conn, "2026/08-04/test.jpg").unwrap();
        assert_eq!(fetched, Some(rec.clone()));

        let all = get_all_sync_states(&conn).unwrap();
        assert_eq!(all.len(), 1);

        remove_sync_state(&conn, "2026/08-04/test.jpg").unwrap();
        let fetched_after = get_sync_state(&conn, "2026/08-04/test.jpg").unwrap();
        assert_eq!(fetched_after, None);
    }

    #[test]
    fn test_sync_state_batch() {
        let dir = tempdir().unwrap();
        let conn = init_db(dir.path()).unwrap();

        let records = vec![
            SyncStateRecord {
                relative_path: "p1.jpg".to_string(),
                file_size: 100,
                mtime: 1000,
                hash: None,
                last_synced_at: "2026-08-01T00:00:00Z".to_string(),
                status: "synced".to_string(),
            },
            SyncStateRecord {
                relative_path: "p2.jpg".to_string(),
                file_size: 200,
                mtime: 2000,
                hash: None,
                last_synced_at: "2026-08-01T00:00:00Z".to_string(),
                status: "synced".to_string(),
            },
        ];

        set_sync_states_batch(&conn, &records).unwrap();
        let all = get_all_sync_states(&conn).unwrap();
        assert_eq!(all.len(), 2);
    }
}
