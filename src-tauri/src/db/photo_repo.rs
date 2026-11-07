use rusqlite::{params, Connection, OptionalExtension};
use crate::models::{Photo, Face, TagWithCount, PersonWithCount};
use crate::db::query_builder::build_where_clause;

const PHOTO_COLUMNS: &str = "id, path, thumb_path, exposure, rating, rejected, tags, orientation, mime_type, width, height, file_size, camera_make, camera_model, latitude, longitude, capture_time, city, state, country, location_name, title, description, crop_top, crop_left, crop_bottom, crop_right, crop_angle, perceptual_hash, event, source_id, validation_is_valid, validation_issues, in_quick_collection, portrait_blur, rank_score, match_count, suggested_rating";

fn get_db_path(conn: &Connection) -> Option<std::path::PathBuf> {
    let mut stmt = conn.prepare("PRAGMA database_list").ok()?;
    let mut rows = stmt.query([]).ok()?;
    if let Some(row) = rows.next().ok().flatten() {
        let file: String = row.get(2).ok()?;
        if !file.is_empty() {
            return Some(std::path::PathBuf::from(file));
        }
    }
    None
}

fn get_cache_dir(conn: &Connection) -> Option<std::path::PathBuf> {
    get_db_path(conn).and_then(|db_path| db_path.parent().map(|p| p.join("cache")))
}

fn get_sources_list(conn: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT id, path FROM sources")?;
    let iter = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut sources = Vec::new();
    for item in iter {
        if let Ok(src) = item {
            sources.push(src);
        }
    }
    Ok(sources)
}

fn to_relative_path(conn: &Connection, abs_path: &str) -> (String, Option<String>) {
    let sources = get_sources_list(conn).unwrap_or_default();
    let norm_abs = abs_path.replace('\\', "/");
    let mut matching_source: Option<(String, String)> = None;

    for (id, path) in &sources {
        let norm_src = path.replace('\\', "/");
        let is_match = if norm_abs == norm_src {
            true
        } else if norm_src.ends_with('/') {
            norm_abs.starts_with(&norm_src)
        } else {
            norm_abs.starts_with(&format!("{}/", norm_src))
        };

        if is_match {
            if let Some((_, ref max_path)) = matching_source {
                if path.len() > max_path.len() {
                    matching_source = Some((id.clone(), path.clone()));
                }
            } else {
                matching_source = Some((id.clone(), path.clone()));
            }
        }
    }

    if let Some((id, src_path)) = matching_source {
        let norm_src = src_path.replace('\\', "/");
        let rel_path = if norm_abs == norm_src {
            "".to_string()
        } else if norm_src.ends_with('/') {
            norm_abs[norm_src.len()..].to_string()
        } else {
            norm_abs[(norm_src.len() + 1)..].to_string()
        };
        (rel_path, Some(id))
    } else {
        (abs_path.to_string(), None)
    }
}

fn resolve_absolute_path(rel_path: &str, source_id: Option<&str>, sources: &[(String, String)]) -> String {
    let Some(src_id) = source_id else {
        return rel_path.to_string();
    };
    if src_id.is_empty() {
        return rel_path.to_string();
    }
    for (id, path) in sources {
        if id == src_id {
            let p = std::path::Path::new(path).join(rel_path);
            return p.to_string_lossy().to_string();
        }
    }
    rel_path.to_string()
}

fn to_relative_thumb(conn: &Connection, abs_thumb: &str) -> String {
    if let Some(cache_dir) = get_cache_dir(conn) {
        let norm_abs = abs_thumb.replace('\\', "/");
        let norm_cache = cache_dir.to_string_lossy().replace('\\', "/");
        let prefix = if norm_cache.ends_with('/') {
            norm_cache
        } else {
            format!("{}/", norm_cache)
        };
        
        if norm_abs.starts_with(&prefix) {
            return norm_abs[prefix.len()..].to_string();
        }
    }
    abs_thumb.to_string()
}

fn resolve_absolute_thumb(rel_thumb: &str, cache_dir: Option<&std::path::Path>) -> String {
    let is_absolute = rel_thumb.starts_with('/') || 
                      rel_thumb.starts_with('\\') || 
                      (rel_thumb.len() > 2 && rel_thumb.chars().nth(1) == Some(':'));
                      
    if is_absolute {
        return rel_thumb.to_string();
    }
    
    if let Some(cache_dir) = cache_dir {
        let p = cache_dir.join(rel_thumb);
        return p.to_string_lossy().to_string();
    }
    rel_thumb.to_string()
}

fn map_row_to_photo_fields(row: &rusqlite::Row, faces: Vec<Face>) -> rusqlite::Result<Photo> {
    Ok(Photo {
        id: row.get(0)?,
        path: row.get(1)?,
        thumb_path: row.get(2)?,
        exposure: row.get(3)?,
        rating: row.get(4)?,
        rejected: row.get::<_, i32>(5)? != 0,
        tags: row.get(6)?,
        orientation: row.get(7)?,
        mime_type: row.get(8)?,
        width: row.get(9)?,
        height: row.get(10)?,
        file_size: row.get(11)?,
        camera_make: row.get(12)?,
        camera_model: row.get(13)?,
        latitude: row.get(14)?,
        longitude: row.get(15)?,
        capture_time: row.get(16)?,
        city: row.get(17)?,
        state: row.get(18)?,
        country: row.get(19)?,
        location_name: row.get(20)?,
        title: row.get(21)?,
        description: row.get(22)?,
        faces,
        crop_top: row.get(23)?,
        crop_left: row.get(24)?,
        crop_bottom: row.get(25)?,
        crop_right: row.get(26)?,
        crop_angle: row.get(27)?,
        perceptual_hash: row.get(28)?,
        event: row.get(29)?,
        validation_is_valid: row.get::<_, i32>(31)? != 0,
        validation_issues: row.get(32)?,
        in_quick_collection: row.get::<_, i32>(33)? != 0,
        portrait_blur: row.get(34)?,
        rank_score: row.get::<_, Option<f64>>(35)?.unwrap_or(1500.0),
        match_count: row.get::<_, Option<u32>>(36)?.unwrap_or(0),
        suggested_rating: row.get::<_, Option<u8>>(37)?.unwrap_or(0),
    })
}

fn map_row_to_photo(row: &rusqlite::Row, conn: &Connection) -> rusqlite::Result<Photo> {
    let photo_id: String = row.get(0)?;
    let faces = get_faces(conn, &photo_id).unwrap_or_default();
    let mut photo = map_row_to_photo_fields(row, faces)?;
    
    let sources = get_sources_list(conn).unwrap_or_default();
    let cache_dir = get_cache_dir(conn);
    
    let rel_path = photo.path.clone();
    let source_id: Option<String> = row.get(30)?;
    photo.path = resolve_absolute_path(&rel_path, source_id.as_deref(), &sources);
    
    let rel_thumb = photo.thumb_path.clone();
    photo.thumb_path = resolve_absolute_thumb(&rel_thumb, cache_dir.as_deref());
    
    Ok(photo)
}

pub fn get_all(conn: &Connection, query: Option<&str>) -> anyhow::Result<Vec<Photo>> {
    let plan = build_where_clause(query);
    let sql = format!(
        "SELECT {} FROM photos {}",
        PHOTO_COLUMNS,
        plan.where_clause
    );

    // Pre-load all faces in a single query
    let mut faces_map = std::collections::HashMap::<String, Vec<Face>>::new();
    let mut faces_stmt = conn.prepare("
        SELECT f.photo_id, p.name, f.area_x, f.area_y, f.area_w, f.area_h 
        FROM photo_faces f 
        JOIN people p ON f.person_id = p.id
    ")?;
    let faces_iter = faces_stmt.query_map([], |row| {
        let photo_id: String = row.get(0)?;
        let face = Face {
            name: row.get(1)?,
            area_x: row.get(2)?,
            area_y: row.get(3)?,
            area_w: row.get(4)?,
            area_h: row.get(5)?,
        };
        Ok((photo_id, face))
    })?;

    for face_res in faces_iter {
        let (photo_id, face) = face_res?;
        faces_map.entry(photo_id).or_default().push(face);
    }

    let mut stmt = conn.prepare(&sql)?;
    
    // Convert Vec<String> to Vec<&dyn rusqlite::ToSql>
    let param_refs: Vec<&dyn rusqlite::ToSql> = plan.params.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

    let sources = get_sources_list(conn)?;
    let cache_dir = get_cache_dir(conn);

    let photo_iter = stmt.query_map(&*param_refs, |row| {
        let photo_id: String = row.get(0)?;
        let faces = faces_map.remove(&photo_id).unwrap_or_default();
        let mut photo = map_row_to_photo_fields(row, faces)?;
        
        let rel_path = photo.path.clone();
        let source_id: Option<String> = row.get(30)?;
        photo.path = resolve_absolute_path(&rel_path, source_id.as_deref(), &sources);
        
        let rel_thumb = photo.thumb_path.clone();
        photo.thumb_path = resolve_absolute_thumb(&rel_thumb, cache_dir.as_deref());
        
        Ok(photo)
    })?;

    let mut photos = Vec::new();
    for photo_res in photo_iter {
        let photo = photo_res?;
        
        // Post-filter for misplaced photos
        if let Some(misplaced_filter) = plan.post_filter_misplaced {
            let is_misplaced = !photo.validation_is_valid;
            if is_misplaced == misplaced_filter {
                photos.push(photo);
            }
        } else {
            photos.push(photo);
        }
    }
    Ok(photos)
}


pub fn get_all_tags(conn: &Connection) -> anyhow::Result<Vec<TagWithCount>> {
    let mut stmt = conn.prepare("SELECT tags FROM photos WHERE tags != ''")?;
    let tag_iter = stmt.query_map([], |row| {
        let tags: String = row.get(0)?;
        Ok(tags)
    })?;

    let mut tag_counts = std::collections::HashMap::new();
    for tags_result in tag_iter {
        let tags = tags_result?;
        for tag in tags.split(',') {
            let trimmed = tag.trim();
            if !trimmed.is_empty() {
                *tag_counts.entry(trimmed.to_string()).or_insert(0) += 1;
            }
        }
    }

    let mut sorted_tags: Vec<TagWithCount> = tag_counts
        .into_iter()
        .map(|(name, count)| TagWithCount { name, count })
        .collect();
    sorted_tags.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sorted_tags)
}

pub fn get_all_people(conn: &Connection) -> anyhow::Result<Vec<PersonWithCount>> {
    let mut stmt = conn.prepare("
        SELECT p.name, COUNT(pf.photo_id) 
        FROM people p 
        LEFT JOIN photo_faces pf ON p.id = pf.person_id 
        GROUP BY p.id 
        ORDER BY p.name
    ")?;
    let people_iter = stmt.query_map([], |row| {
        let name: String = row.get(0)?;
        let count: u32 = row.get(1)?;
        Ok(PersonWithCount { name, count })
    })?;

    let mut all_people = Vec::new();
    for person_result in people_iter {
        all_people.push(person_result?);
    }
    Ok(all_people)
}

fn get_faces(conn: &Connection, photo_id: &str) -> anyhow::Result<Vec<Face>> {
    let mut stmt = conn.prepare("
        SELECT p.name, f.area_x, f.area_y, f.area_w, f.area_h 
        FROM photo_faces f 
        JOIN people p ON f.person_id = p.id 
        WHERE f.photo_id = ?")?;
    
    let iter = stmt.query_map(params![photo_id], |row| {
        Ok(Face {
            name: row.get(0)?,
            area_x: row.get(1)?,
            area_y: row.get(2)?,
            area_w: row.get(3)?,
            area_h: row.get(4)?,
        })
    })?;

    let mut faces = Vec::new();
    for face in iter {
        faces.push(face?);
    }
    Ok(faces)
}

pub fn update_exposure(conn: &Connection, id: &str, exposure: f32) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE photos SET exposure = ? WHERE id = ?",
        params![exposure, id],
    )?;
    Ok(())
}

pub fn update_portrait_blur(conn: &Connection, id: &str, portrait_blur: f64) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE photos SET portrait_blur = ? WHERE id = ?",
        params![portrait_blur, id],
    )?;
    Ok(())
}

pub fn update_metadata(
    conn: &Connection,
    id: &str,
    rating: u8,
    tags: &str,
    title: &str,
    description: &str,
    rank_score: f64,
    suggested_rating: u8,
) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE photos SET rating = ?, tags = ?, title = ?, description = ?, rank_score = ?, suggested_rating = ? WHERE id = ?",
        params![rating, tags, title, description, rank_score, suggested_rating, id],
    )?;
    Ok(())
}

pub fn update_crop(
    conn: &Connection, 
    id: &str, 
    top: Option<f64>,
    left: Option<f64>,
    bottom: Option<f64>,
    right: Option<f64>,
    angle: Option<f64>,
) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE photos SET crop_top = ?, crop_left = ?, crop_bottom = ?, crop_right = ?, crop_angle = ? WHERE id = ?",
        params![top, left, bottom, right, angle, id],
    )?;
    Ok(())
}

pub fn update_capture_time(conn: &Connection, id: &str, capture_time: &str) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE photos SET capture_time = ? WHERE id = ?",
        params![capture_time, id],
    )?;
    Ok(())
}

pub fn update_path(conn: &Connection, id: &str, new_path: &str) -> anyhow::Result<()> {
    let (rel_path, source_id) = to_relative_path(conn, new_path);
    conn.execute(
        "UPDATE photos SET path = ?, source_id = ? WHERE id = ?",
        params![rel_path, source_id, id],
    )?;
    Ok(())
}

pub fn update_event(conn: &Connection, id: &str, event: Option<&str>) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE photos SET event = ? WHERE id = ?",
        params![event, id],
    )?;
    Ok(())
}

pub fn get_by_id(conn: &Connection, id: &str) -> anyhow::Result<Photo> {
    let sql = format!("SELECT {} FROM photos WHERE id = ?", PHOTO_COLUMNS);
    let mut stmt = conn.prepare(&sql)?;
    
    stmt.query_row(params![id], |row| {
        map_row_to_photo(row, conn)
    }).map_err(|e| e.into())
}

pub fn insert(conn: &Connection, photo: &Photo) -> anyhow::Result<()> {
    let (rel_path, source_id) = to_relative_path(conn, &photo.path);
    let rel_thumb = to_relative_thumb(conn, &photo.thumb_path);
    let initial_score = if photo.match_count == 0 && (photo.rank_score == 1500.0 || photo.rank_score == 0.0) && photo.rating != 0 && photo.rating != 3 {
        crate::processing::ranking::calculate_initial_score(photo.rating)
    } else {
        photo.rank_score
    };
    let initial_suggested = if photo.suggested_rating > 0 {
        photo.suggested_rating
    } else if photo.match_count == 0 && photo.rating > 0 {
        photo.rating
    } else {
        crate::processing::ranking::score_to_suggested_rating(initial_score)
    };

    conn.execute(
        "INSERT INTO photos (id, path, thumb_path, exposure, rating, tags, orientation, mime_type, width, height, file_size, camera_make, camera_model, latitude, longitude, capture_time, city, state, country, location_name, title, description, crop_top, crop_left, crop_bottom, crop_right, crop_angle, perceptual_hash, event, source_id, validation_is_valid, validation_issues, in_quick_collection, portrait_blur, rank_score, match_count, suggested_rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            photo.id,
            rel_path,
            rel_thumb,
            photo.exposure,
            photo.rating,
            photo.tags,
            photo.orientation,
            photo.mime_type,
            photo.width,
            photo.height,
            photo.file_size,
            photo.camera_make,
            photo.camera_model,
            photo.latitude,
            photo.longitude,
            photo.capture_time,
            photo.city,
            photo.state,
            photo.country,
            photo.location_name,
            photo.title,
            photo.description,
            photo.crop_top,
            photo.crop_left,
            photo.crop_bottom,
            photo.crop_right,
            photo.crop_angle,
            photo.perceptual_hash,
            photo.event,
            source_id,
            if photo.validation_is_valid { 1 } else { 0 },
            photo.validation_issues,
            if photo.in_quick_collection { 1 } else { 0 },
            photo.portrait_blur,
            initial_score,
            photo.match_count,
            initial_suggested,
        ],
    )?;

    for face in &photo.faces {
        let person_id = get_or_create_person(conn, &face.name)?;
        conn.execute(
            "INSERT INTO photo_faces (photo_id, person_id, area_x, area_y, area_w, area_h) VALUES (?, ?, ?, ?, ?, ?)",
            params![photo.id, person_id, face.area_x, face.area_y, face.area_w, face.area_h],
        )?;
    }

    Ok(())
}

fn get_or_create_person(conn: &Connection, name: &str) -> anyhow::Result<String> {
    let mut stmt = conn.prepare("SELECT id FROM people WHERE name = ?")?;
    let existing: Option<String> = stmt.query_row(params![name], |row| row.get(0)).optional()?;

    if let Some(id) = existing {
        Ok(id)
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute("INSERT INTO people (id, name) VALUES (?, ?)", params![id, name])?;
        Ok(id)
    }
}

fn build_prefix_query(conn: &Connection, prefix: &str) -> anyhow::Result<(String, Vec<rusqlite::types::Value>)> {
    let sources = get_sources_list(conn)?;
    let norm_prefix = prefix.replace('\\', "/");
    
    let mut conditions = Vec::new();
    let mut params = Vec::new();

    let mut matched_any = false;
    for (src_id, src_path) in &sources {
        let norm_src = src_path.replace('\\', "/");
        
        let is_subfolder = if norm_prefix == norm_src {
            true
        } else if norm_src.ends_with('/') {
            norm_prefix.starts_with(&norm_src)
        } else {
            norm_prefix.starts_with(&format!("{}/", norm_src))
        };

        if is_subfolder {
            matched_any = true;
            let rel_prefix = if norm_prefix == norm_src {
                "".to_string()
            } else if norm_src.ends_with('/') {
                norm_prefix[norm_src.len()..].to_string()
            } else {
                norm_prefix[(norm_src.len() + 1)..].to_string()
            };

            let pattern = if rel_prefix.is_empty() {
                "%".to_string()
            } else if rel_prefix.ends_with('/') {
                format!("{}%", rel_prefix)
            } else {
                format!("{}/%", rel_prefix)
            };

            conditions.push("(source_id = ? AND (path LIKE ? OR path = ?))".to_string());
            params.push(rusqlite::types::Value::Text(src_id.clone()));
            params.push(rusqlite::types::Value::Text(pattern));
            params.push(rusqlite::types::Value::Text(rel_prefix));
        } else {
            let is_parent = if norm_prefix.ends_with('/') {
                norm_src.starts_with(&norm_prefix)
            } else {
                norm_src.starts_with(&format!("{}/", norm_prefix))
            };

            if is_parent {
                matched_any = true;
                conditions.push("source_id = ?".to_string());
                params.push(rusqlite::types::Value::Text(src_id.clone()));
            }
        }
    }

    if !matched_any {
        let pattern = if prefix.ends_with('/') || prefix.ends_with('\\') {
            format!("{}%", prefix)
        } else {
            format!("{}/%", prefix)
        };
        conditions.push("((source_id IS NULL OR source_id = '') AND (path LIKE ? OR path = ?))".to_string());
        params.push(rusqlite::types::Value::Text(pattern));
        params.push(rusqlite::types::Value::Text(prefix.to_string()));
    }

    let where_clause = format!("WHERE {}", conditions.join(" OR "));
    Ok((where_clause, params))
}

pub fn get_photo_paths_by_prefix(conn: &Connection, prefix: &str) -> anyhow::Result<Vec<(String, String)>> {
    let (where_clause, params) = build_prefix_query(conn, prefix)?;
    let sql = format!("SELECT id, path, source_id FROM photos {}", where_clause);
    let mut stmt = conn.prepare(&sql)?;
    
    let sources = get_sources_list(conn)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
    
    let iter = stmt.query_map(&*param_refs, |row| {
        let id: String = row.get(0)?;
        let rel_path: String = row.get(1)?;
        let source_id: Option<String> = row.get(2)?;
        let abs_path = resolve_absolute_path(&rel_path, source_id.as_deref(), &sources);
        Ok((id, abs_path))
    })?;
    
    let mut results = Vec::new();
    for item in iter {
        results.push(item?);
    }
    Ok(results)
}

pub fn get_by_path_prefix(conn: &Connection, prefix: &str) -> anyhow::Result<Vec<(String, String)>> {
    let (where_clause, params) = build_prefix_query(conn, prefix)?;
    let sql = format!("SELECT id, thumb_path FROM photos {}", where_clause);
    let mut stmt = conn.prepare(&sql)?;
    
    let cache_dir = get_cache_dir(conn);
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();

    let iter = stmt.query_map(&*param_refs, |row| {
        let id: String = row.get(0)?;
        let rel_thumb: String = row.get(1)?;
        let abs_thumb = resolve_absolute_thumb(&rel_thumb, cache_dir.as_deref());
        Ok((id, abs_thumb))
    })?;

    let mut results = Vec::new();
    for item in iter {
        results.push(item?);
    }
    Ok(results)
}

pub fn update_rejected(conn: &Connection, id: &str, rejected: bool) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE photos SET rejected = ? WHERE id = ?",
        params![if rejected { 1 } else { 0 }, id],
    )?;
    Ok(())
}

pub fn toggle_quick_collection(conn: &Connection, ids: &[String]) -> anyhow::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
    let count_query = format!(
        "SELECT COUNT(*) FROM photos WHERE id IN ({}) AND in_quick_collection = 1",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&count_query)?;
    let params_iter = rusqlite::params_from_iter(ids.iter());
    let count: i64 = stmt.query_row(params_iter, |r| r.get(0))?;

    let new_val = if count as usize == ids.len() { 0 } else { 1 };
    let update_query = format!(
        "UPDATE photos SET in_quick_collection = {} WHERE id IN ({})",
        new_val,
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&update_query)?;
    let update_params_iter = rusqlite::params_from_iter(ids.iter());
    stmt.execute(update_params_iter)?;

    Ok(())
}

pub fn update_full(conn: &Connection, photo: &Photo) -> anyhow::Result<()> {
    let rel_thumb = to_relative_thumb(conn, &photo.thumb_path);
    conn.execute(
        "UPDATE photos SET 
            thumb_path = ?, exposure = ?, rating = ?, rejected = ?, tags = ?, orientation = ?, mime_type = ?, 
            width = ?, height = ?, file_size = ?, camera_make = ?, camera_model = ?, 
            latitude = ?, longitude = ?, capture_time = ?, city = ?, state = ?, country = ?, 
            location_name = ?, title = ?, description = ?, crop_top = ?, crop_left = ?, 
            crop_bottom = ?, crop_right = ?, crop_angle = ?, perceptual_hash = ?, event = ?,
            validation_is_valid = ?, validation_issues = ?
         WHERE id = ?",
        params![
            rel_thumb,
            photo.exposure,
            photo.rating,
            if photo.rejected { 1 } else { 0 },
            photo.tags,
            photo.orientation,
            photo.mime_type,
            photo.width,
            photo.height,
            photo.file_size,
            photo.camera_make,
            photo.camera_model,
            photo.latitude,
            photo.longitude,
            photo.capture_time,
            photo.city,
            photo.state,
            photo.country,
            photo.location_name,
            photo.title,
            photo.description,
            photo.crop_top,
            photo.crop_left,
            photo.crop_bottom,
            photo.crop_right,
            photo.crop_angle,
            photo.perceptual_hash,
            photo.event,
            if photo.validation_is_valid { 1 } else { 0 },
            photo.validation_issues,
            photo.id,
        ],
    )?;
    
    // Also sync faces: delete old faces and insert current ones
    conn.execute("DELETE FROM photo_faces WHERE photo_id = ?", params![photo.id])?;
    for face in &photo.faces {
        let person_id = get_or_create_person(conn, &face.name)?;
        conn.execute(
            "INSERT INTO photo_faces (photo_id, person_id, area_x, area_y, area_w, area_h) VALUES (?, ?, ?, ?, ?, ?)",
            params![photo.id, person_id, face.area_x, face.area_y, face.area_w, face.area_h],
        )?;
    }
    
    Ok(())
}

pub fn update_validation_status(
    conn: &Connection,
    id: &str,
    is_valid: bool,
    issues: &str,
) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE photos SET validation_is_valid = ?, validation_issues = ? WHERE id = ?",
        params![if is_valid { 1 } else { 0 }, issues, id],
    )?;
    Ok(())
}

pub fn get_rejected_by_path_prefix(conn: &Connection, prefix: &str) -> anyhow::Result<Vec<Photo>> {
    let (where_clause, params) = build_prefix_query(conn, prefix)?;
    let full_where_clause = if where_clause.is_empty() {
        "WHERE rejected = 1".to_string()
    } else {
        format!("{} AND rejected = 1", where_clause)
    };
    
    let sql = format!("SELECT {} FROM photos {}", PHOTO_COLUMNS, full_where_clause);
    let mut stmt = conn.prepare(&sql)?;
    
    let sources = get_sources_list(conn)?;
    let cache_dir = get_cache_dir(conn);
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();

    let photo_iter = stmt.query_map(&*param_refs, |row| {
        let photo_id: String = row.get(0)?;
        let faces = get_faces(conn, &photo_id).unwrap_or_default();
        let mut photo = map_row_to_photo_fields(row, faces)?;
        
        let rel_path = photo.path.clone();
        let source_id: Option<String> = row.get(30)?;
        photo.path = resolve_absolute_path(&rel_path, source_id.as_deref(), &sources);
        
        let rel_thumb = photo.thumb_path.clone();
        photo.thumb_path = resolve_absolute_thumb(&rel_thumb, cache_dir.as_deref());
        
        Ok(photo)
    })?;

    let mut photos = Vec::new();
    for photo in photo_iter {
        photos.push(photo?);
    }
    Ok(photos)
}

pub fn delete_by_id(conn: &Connection, id: &str) -> anyhow::Result<()> {
    conn.execute("DELETE FROM photo_faces WHERE photo_id = ?", params![id])?;
    conn.execute("DELETE FROM photos WHERE id = ?", params![id])?;
    Ok(())
}

pub fn delete_by_path(conn: &Connection, path: &str) -> anyhow::Result<()> {
    let (rel_path, source_id) = to_relative_path(conn, path);
    let norm_path = path.replace('\\', "/");
    let norm_rel = rel_path.replace('\\', "/");

    let ids: Vec<String> = if let Some(src_id) = source_id {
        let mut stmt = conn.prepare(
            "SELECT id FROM photos WHERE (source_id = ? AND (LOWER(path) = LOWER(?) OR LOWER(path) = LOWER(?))) OR LOWER(path) = LOWER(?) OR LOWER(path) = LOWER(?)"
        )?;
        let rows = stmt.query_map(params![src_id, rel_path, norm_rel, path, norm_path], |row| row.get(0))?;
        rows.filter_map(|r| r.ok()).collect()
    } else {
        let mut stmt = conn.prepare(
            "SELECT id FROM photos WHERE LOWER(path) = LOWER(?) OR LOWER(path) = LOWER(?) OR LOWER(path) = LOWER(?) OR LOWER(path) = LOWER(?)"
        )?;
        let rows = stmt.query_map(params![path, norm_path, rel_path, norm_rel], |row| row.get(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    for id in ids {
        delete_by_id(conn, &id)?;
    }
    Ok(())
}

pub fn get_by_path(conn: &Connection, path: &str) -> anyhow::Result<Option<Photo>> {
    let (rel_path, source_id) = to_relative_path(conn, path);
    let norm_path = path.replace('\\', "/");
    let norm_rel = rel_path.replace('\\', "/");

    let sql = format!(
        "SELECT {} FROM photos WHERE (source_id = ? AND (LOWER(path) = LOWER(?) OR LOWER(path) = LOWER(?))) OR LOWER(path) = LOWER(?) OR LOWER(path) = LOWER(?) LIMIT 1",
        PHOTO_COLUMNS
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![source_id.as_deref().unwrap_or(""), rel_path, norm_rel, path, norm_path])?;
    if let Some(row) = rows.next()? {
        Ok(Some(map_row_to_photo(row, conn)?))
    } else {
        Ok(None)
    }
}

pub fn find_photo(conn: &Connection, id_or_path: &str) -> anyhow::Result<Option<Photo>> {
    if let Ok(photo) = get_by_id(conn, id_or_path) {
        return Ok(Some(photo));
    }
    get_by_path(conn, id_or_path)
}

pub fn count_by_path_prefix(conn: &Connection, prefix: &str) -> anyhow::Result<usize> {
    let (where_clause, params) = build_prefix_query(conn, prefix)?;
    let sql = format!("SELECT COUNT(*) FROM photos {}", where_clause);
    let mut stmt = conn.prepare(&sql)?;
    
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
    let count: i64 = stmt.query_row(&*param_refs, |row| row.get(0))?;
    Ok(count as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_all_tags() -> anyhow::Result<()> {
        let conn = Connection::open_in_memory()?;
        conn.execute(
            "CREATE TABLE photos (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                thumb_path TEXT NOT NULL,
                tags TEXT DEFAULT ''
            )",
            [],
        )?;

        conn.execute(
            "INSERT INTO photos (id, path, thumb_path, tags) VALUES (?, ?, ?, ?)",
            params!["1", "path1", "thumb1", "tag1,tag2"],
        )?;
        conn.execute(
            "INSERT INTO photos (id, path, thumb_path, tags) VALUES (?, ?, ?, ?)",
            params!["2", "path2", "thumb2", "tag2, tag3"],
        )?;
        conn.execute(
            "INSERT INTO photos (id, path, thumb_path, tags) VALUES (?, ?, ?, ?)",
            params!["3", "path3", "thumb3", ""],
        )?;

        let tags = get_all_tags(&conn)?;
        assert_eq!(tags.len(), 3);
        assert_eq!(tags[0].name, "tag1");
        assert_eq!(tags[0].count, 1);
        assert_eq!(tags[1].name, "tag2");
        assert_eq!(tags[1].count, 2);
        assert_eq!(tags[2].name, "tag3");
        assert_eq!(tags[2].count, 1);
        Ok(())
    }

    #[test]
    fn test_people_and_person_filter() -> anyhow::Result<()> {
        let conn = Connection::open_in_memory()?;
        conn.execute(
            "CREATE TABLE photos (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                thumb_path TEXT NOT NULL,
                tags TEXT DEFAULT '',
                rating INTEGER DEFAULT 0,
                rejected INTEGER DEFAULT 0,
                mime_type TEXT DEFAULT 'image/jpeg',
                orientation INTEGER DEFAULT 1,
                exposure REAL DEFAULT 0.0
            )",
            [],
        )?;
        conn.execute(
            "CREATE TABLE people (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL
            )",
            [],
        )?;
        conn.execute(
            "CREATE TABLE photo_faces (
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

        conn.execute("INSERT INTO people (id, name) VALUES (?, ?)", params!["p1", "Charlie"])?;
        conn.execute("INSERT INTO people (id, name) VALUES (?, ?)", params!["p2", "Alice"])?;

        conn.execute(
            "INSERT INTO photos (id, path, thumb_path) VALUES (?, ?, ?)",
            params!["1", "path1", "thumb1"],
        )?;
        conn.execute(
            "INSERT INTO photos (id, path, thumb_path) VALUES (?, ?, ?)",
            params!["2", "path2", "thumb2"],
        )?;

        conn.execute(
            "INSERT INTO photo_faces (photo_id, person_id) VALUES (?, ?)",
            params!["1", "p1"],
        )?;
        conn.execute(
            "INSERT INTO photo_faces (photo_id, person_id) VALUES (?, ?)",
            params!["2", "p2"],
        )?;

        let people = get_all_people(&conn)?;
        assert_eq!(people.len(), 2);
        assert_eq!(people[0].name, "Alice");
        assert_eq!(people[0].count, 1);
        assert_eq!(people[1].name, "Charlie");
        assert_eq!(people[1].count, 1);

        let plan = build_where_clause(Some("person:Charlie"));
        assert!(plan.where_clause.contains("id IN (SELECT photo_id FROM photo_faces JOIN people ON photo_faces.person_id = people.id WHERE people.name LIKE ?)"));
        assert_eq!(plan.params, vec!["%Charlie%"]);

        Ok(())
    }

    #[test]
    fn test_toggle_quick_collection() -> anyhow::Result<()> {
        let dir = tempfile::tempdir()?;
        let conn = crate::db::init_db(dir.path())?;
        let photo1 = Photo { id: "1".to_string(), path: "p1".to_string(), thumb_path: "t1".to_string(), ..Photo::default_for_test() };
        let photo2 = Photo { id: "2".to_string(), path: "p2".to_string(), thumb_path: "t2".to_string(), ..Photo::default_for_test() };
        insert(&conn, &photo1)?;
        insert(&conn, &photo2)?;

        toggle_quick_collection(&conn, &["1".to_string()])?;
        let p1 = get_by_id(&conn, "1")?;
        assert!(p1.in_quick_collection);

        toggle_quick_collection(&conn, &["1".to_string(), "2".to_string()])?;
        let p1_updated = get_by_id(&conn, "1")?;
        let p2_updated = get_by_id(&conn, "2")?;
        assert!(p1_updated.in_quick_collection);
        assert!(p2_updated.in_quick_collection);

        toggle_quick_collection(&conn, &["1".to_string(), "2".to_string()])?;
        let p1_off = get_by_id(&conn, "1")?;
        let p2_off = get_by_id(&conn, "2")?;
        assert!(!p1_off.in_quick_collection);
        assert!(!p2_off.in_quick_collection);

        Ok(())
    }

    #[test]
    fn test_delete_by_path() -> anyhow::Result<()> {
        let dir = tempfile::tempdir()?;
        let conn = crate::db::init_db(dir.path())?;
        let photo = Photo { id: "p_del".to_string(), path: "/data/photos/Library/del.jpg".to_string(), thumb_path: "t1".to_string(), ..Photo::default_for_test() };
        insert(&conn, &photo)?;
        assert!(get_by_id(&conn, "p_del").is_ok());

        delete_by_path(&conn, "/data/photos/Library/del.jpg")?;
        assert!(get_by_id(&conn, "p_del").is_err());
        Ok(())
    }

    #[test]
    fn test_delete_by_path_with_source() -> anyhow::Result<()> {
        let dir = tempfile::tempdir()?;
        let conn = crate::db::init_db(dir.path())?;
        crate::db::source_repo::insert(&conn, &crate::models::Source {
            id: "src_1".to_string(),
            path: "/data/photos".to_string(),
            name: "Photos".to_string(),
            sync_mode: "none".to_string(),
            server_path: None,
            archive_prefix: None,
            rating_enabled: true,
        })?;

        let photo = Photo { id: "p_del2".to_string(), path: "/data/photos/Inbox/del.jpg".to_string(), thumb_path: "t1".to_string(), ..Photo::default_for_test() };
        insert(&conn, &photo)?;
        assert!(get_by_id(&conn, "p_del2").is_ok());

        // Test deleting with absolute path
        delete_by_path(&conn, "/data/photos/Inbox/del.jpg")?;
        assert!(get_by_id(&conn, "p_del2").is_err());

        // Re-insert and test deleting with relative path
        insert(&conn, &photo)?;
        assert!(get_by_id(&conn, "p_del2").is_ok());
        delete_by_path(&conn, "Inbox/del.jpg")?;
        assert!(get_by_id(&conn, "p_del2").is_err());
        Ok(())
    }
}
