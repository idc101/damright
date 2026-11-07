pub mod photo_repo;
pub mod source_repo;
pub mod query_builder;
pub mod sync_state_repo;

use std::path::Path;
use rusqlite::{params, Connection};

pub fn init_db(app_dir: &Path) -> anyhow::Result<Connection> {
    let db_path = app_dir.join("damright.db");
    let conn = Connection::open(db_path)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS photos (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            thumb_path TEXT NOT NULL,
            exposure REAL DEFAULT 0.0
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS sources (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            name TEXT NOT NULL,
            sync_mode TEXT NOT NULL DEFAULT 'none',
            server_path TEXT,
            archive_prefix TEXT,
            rating_enabled INTEGER NOT NULL DEFAULT 1
        )",
        [],
    )?;

    // Migrations for prototype
    let _ = conn.execute("ALTER TABLE sources ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'none'", []);
    let _ = conn.execute("ALTER TABLE sources ADD COLUMN server_path TEXT", []);
    let _ = conn.execute("ALTER TABLE sources ADD COLUMN archive_prefix TEXT", []);
    let _ = conn.execute("ALTER TABLE sources ADD COLUMN rating_enabled INTEGER NOT NULL DEFAULT 1", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN rating INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN tags TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN orientation INTEGER DEFAULT 1", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN mime_type TEXT DEFAULT 'image/jpeg'", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN rejected INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN width INTEGER", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN height INTEGER", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN file_size INTEGER", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN camera_make TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN camera_model TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN latitude REAL", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN longitude REAL", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN capture_time TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN city TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN state TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN country TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN location_name TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN title TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN description TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN crop_top REAL", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN crop_left REAL", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN crop_bottom REAL", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN crop_right REAL", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN crop_angle REAL", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN perceptual_hash TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN event TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN source_id TEXT", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN validation_is_valid INTEGER DEFAULT 1", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN validation_issues TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN in_quick_collection INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN portrait_blur REAL DEFAULT 0.0", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN rank_score REAL DEFAULT 1500.0", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN match_count INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN suggested_rating INTEGER DEFAULT 0", []);

    if let Err(e) = migrate_elo_scores_for_manual_ratings(&conn) {
        eprintln!("Failed to migrate Elo scores for manual ratings: {}", e);
    }

    if let Err(e) = migrate_to_relative_paths(&conn, app_dir) {
        eprintln!("Failed to migrate to relative paths: {}", e);
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS people (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS photo_faces (
            photo_id TEXT NOT NULL,
            person_id TEXT NOT NULL,
            area_x REAL,
            area_y REAL,
            area_w REAL,
            area_h REAL,
            FOREIGN KEY(photo_id) REFERENCES photos(id),
            FOREIGN KEY(person_id) REFERENCES people(id)
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS sync_state (
            relative_path TEXT PRIMARY KEY,
            file_size INTEGER NOT NULL,
            mtime INTEGER NOT NULL,
            hash TEXT,
            last_synced_at TEXT NOT NULL,
            status TEXT NOT NULL
        )",
        [],
    )?;

    Ok(conn)
}

fn migrate_to_relative_paths(conn: &Connection, app_dir: &Path) -> anyhow::Result<()> {
    let mut stmt = conn.prepare("SELECT id, path FROM sources")?;
    let sources: Vec<(String, String)> = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?.filter_map(|r| r.ok()).collect();

    let mut stmt = conn.prepare("SELECT id, path, thumb_path, source_id FROM photos")?;
    let photos: Vec<(String, String, String, Option<String>)> = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?.filter_map(|r| r.ok()).collect();

    let cache_dir = app_dir.join("cache");
    let norm_cache = cache_dir.to_string_lossy().replace('\\', "/");
    let cache_prefix = if norm_cache.ends_with('/') {
        norm_cache
    } else {
        format!("{}/", norm_cache)
    };

    for (id, path, thumb_path, source_id) in photos {
        let mut updated_path = path.clone();
        let mut updated_source_id = source_id.clone();
        let mut updated_thumb_path = thumb_path.clone();
        let mut dirty = false;

        let is_path_absolute = path.starts_with('/') || 
                               path.starts_with('\\') || 
                               (path.len() > 2 && path.chars().nth(1) == Some(':'));

        if is_path_absolute && source_id.is_none() {
            let norm_abs = path.replace('\\', "/");
            let mut matching_source: Option<(String, String)> = None;

            for (src_id, src_path) in &sources {
                let norm_src = src_path.replace('\\', "/");
                let is_match = if norm_abs == norm_src {
                    true
                } else if norm_src.ends_with('/') {
                    norm_abs.starts_with(&norm_src)
                } else {
                    norm_abs.starts_with(&format!("{}/", norm_src))
                };

                if is_match {
                    if let Some((_, ref max_path)) = matching_source {
                        if src_path.len() > max_path.len() {
                            matching_source = Some((src_id.clone(), src_path.clone()));
                        }
                    } else {
                        matching_source = Some((src_id.clone(), src_path.clone()));
                    }
                }
            }

            if let Some((src_id, src_path)) = matching_source {
                let norm_src = src_path.replace('\\', "/");
                let rel_path = if norm_abs == norm_src {
                    "".to_string()
                } else if norm_src.ends_with('/') {
                    norm_abs[norm_src.len()..].to_string()
                } else {
                    norm_abs[(norm_src.len() + 1)..].to_string()
                };
                updated_path = rel_path;
                updated_source_id = Some(src_id);
                dirty = true;
            }
        }

        let is_thumb_absolute = thumb_path.starts_with('/') || 
                                thumb_path.starts_with('\\') || 
                                (thumb_path.len() > 2 && thumb_path.chars().nth(1) == Some(':'));

        if is_thumb_absolute {
            let norm_thumb = thumb_path.replace('\\', "/");
            if norm_thumb.starts_with(&cache_prefix) {
                updated_thumb_path = norm_thumb[cache_prefix.len()..].to_string();
                dirty = true;
            }
        }

        if dirty {
            conn.execute(
                "UPDATE photos SET path = ?, thumb_path = ?, source_id = ? WHERE id = ?",
                rusqlite::params![updated_path, updated_thumb_path, updated_source_id, id],
            )?;
        }
    }

    Ok(())
}

fn migrate_elo_scores_for_manual_ratings(conn: &Connection) -> anyhow::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )",
        [],
    )?;

    let mut stmt = conn.prepare("SELECT COUNT(*) FROM schema_migrations WHERE version = ?")?;
    let count: i64 = stmt.query_row(params!["elo_manual_ratings_aligned_v1"], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    // 1. Photos with match_count = 0 and manual rating set
    conn.execute(
        "UPDATE photos SET 
            rank_score = CASE rating 
                WHEN 1 THEN 1200.0 
                WHEN 2 THEN 1350.0 
                WHEN 3 THEN 1500.0 
                WHEN 4 THEN 1650.0 
                WHEN 5 THEN 1800.0 
                ELSE 1500.0 
            END,
            suggested_rating = CASE rating
                WHEN 0 THEN 3
                ELSE rating
            END
        WHERE match_count = 0 AND rating != 0 AND rating != 3",
        [],
    )?;

    // 2. Photos with match_count > 0 and manual rating set (1, 2, 4, 5)
    // Shift rank_score by initial baseline difference, and recalculate suggested_rating
    let mut stmt = conn.prepare("SELECT id, rating, rank_score FROM photos WHERE match_count > 0 AND rating IN (1, 2, 4, 5)")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, u8>(1)?,
            row.get::<_, f64>(2)?,
        ))
    })?;

    let mut updates = Vec::new();
    for row in rows.flatten() {
        let (id, rating, current_score) = row;
        let baseline = crate::processing::ranking::calculate_initial_score(rating);
        let delta = current_score - 1500.0;
        let new_score = ((baseline + delta) * 10.0).round() / 10.0;
        let new_suggested = crate::processing::ranking::score_to_suggested_rating(new_score);
        updates.push((id, new_score, new_suggested));
    }

    for (id, new_score, new_suggested) in updates {
        conn.execute(
            "UPDATE photos SET rank_score = ?, suggested_rating = ? WHERE id = ?",
            params![new_score, new_suggested, id],
        )?;
    }

    conn.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))",
        params!["elo_manual_ratings_aligned_v1"],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_db_columns() {
        let dir = tempdir().unwrap();
        let conn = init_db(dir.path()).unwrap();
        let mut stmt = conn.prepare("PRAGMA table_info(photos)").unwrap();
        let cols: Vec<String> = stmt.query_map([], |row| {
            Ok(row.get::<_, String>(1)?)
        }).unwrap().map(|r| r.unwrap()).collect();
        println!("COLUMNS IN DB: {:?}", cols);
        assert!(cols.contains(&"validation_is_valid".to_string()));
        assert!(cols.contains(&"rank_score".to_string()));
        assert!(cols.contains(&"match_count".to_string()));
        assert!(cols.contains(&"suggested_rating".to_string()));
    }

    #[test]
    fn test_elo_manual_ratings_migration() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("damright.db");
        let conn = Connection::open(&db_path).unwrap();

        // Create initial photos table with old unmigrated state
        conn.execute(
            "CREATE TABLE photos (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                thumb_path TEXT NOT NULL,
                rating INTEGER DEFAULT 0,
                rank_score REAL DEFAULT 1500.0,
                match_count INTEGER DEFAULT 0,
                suggested_rating INTEGER DEFAULT 0
            )",
            [],
        ).unwrap();

        // Photo 1: 5-star manual rating, 0 matches, default 1500.0 rank_score
        conn.execute(
            "INSERT INTO photos (id, path, thumb_path, rating, rank_score, match_count, suggested_rating) VALUES ('p1', 'p1.jpg', 't1.jpg', 5, 1500.0, 0, 0)",
            [],
        ).unwrap();

        // Photo 2: 5-star manual rating, 3 matches (started at 1500, gained +42 to 1542.0)
        conn.execute(
            "INSERT INTO photos (id, path, thumb_path, rating, rank_score, match_count, suggested_rating) VALUES ('p2', 'p2.jpg', 't2.jpg', 5, 1542.0, 3, 3)",
            [],
        ).unwrap();

        // Photo 3: 2-star manual rating, 2 matches (started at 1500, lost -30 to 1470.0)
        conn.execute(
            "INSERT INTO photos (id, path, thumb_path, rating, rank_score, match_count, suggested_rating) VALUES ('p3', 'p3.jpg', 't3.jpg', 2, 1470.0, 2, 3)",
            [],
        ).unwrap();

        // Run migration
        migrate_elo_scores_for_manual_ratings(&conn).unwrap();

        // Check p1: should be seeded to 1800.0 and suggested 5
        let (score1, sugg1): (f64, u8) = conn.query_row("SELECT rank_score, suggested_rating FROM photos WHERE id = 'p1'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(score1, 1800.0);
        assert_eq!(sugg1, 5);

        // Check p2: 1800 + 42 = 1842.0 and suggested 5
        let (score2, sugg2): (f64, u8) = conn.query_row("SELECT rank_score, suggested_rating FROM photos WHERE id = 'p2'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(score2, 1842.0);
        assert_eq!(sugg2, 5);

        // Check p3: 1350 - 30 = 1320.0 and suggested 2
        let (score3, sugg3): (f64, u8) = conn.query_row("SELECT rank_score, suggested_rating FROM photos WHERE id = 'p3'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(score3, 1320.0);
        assert_eq!(sugg3, 2);

        // Verify running migration again is idempotent (doesn't apply delta a second time)
        migrate_elo_scores_for_manual_ratings(&conn).unwrap();
        let (score2_second, _): (f64, u8) = conn.query_row("SELECT rank_score, suggested_rating FROM photos WHERE id = 'p2'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(score2_second, 1842.0);
    }
}
