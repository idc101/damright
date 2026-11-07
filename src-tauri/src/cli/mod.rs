use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use crate::models::Photo;
use crate::db::photo_repo;
use crate::processing::metadata::update_metadata;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct TagItem {
    pub name: String,
    pub count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PhotoSummary {
    pub id: String,
    pub path: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub rating: u8,
    pub capture_time: Option<String>,
    pub event: Option<String>,
}

impl From<&Photo> for PhotoSummary {
    fn from(p: &Photo) -> Self {
        let tag_list: Vec<String> = p
            .tags
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        Self {
            id: p.id.clone(),
            path: p.path.clone(),
            title: p.title.clone().filter(|s| !s.trim().is_empty()),
            description: p.description.clone().filter(|s| !s.trim().is_empty()),
            tags: tag_list,
            camera_make: p.camera_make.clone().filter(|s| !s.trim().is_empty()),
            camera_model: p.camera_model.clone().filter(|s| !s.trim().is_empty()),
            rating: p.rating,
            capture_time: p.capture_time.clone(),
            event: p.event.clone().filter(|s| !s.trim().is_empty()),
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct EditOptions {
    pub set_title: Option<String>,
    pub clear_title: bool,
    pub set_description: Option<String>,
    pub clear_description: bool,
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
    pub set_tags: Option<Vec<String>>,
    pub clear_tags: bool,
    pub set_rating: Option<u8>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EditResultItem {
    pub id: String,
    pub path: String,
    pub old_title: Option<String>,
    pub new_title: Option<String>,
    pub old_description: Option<String>,
    pub new_description: Option<String>,
    pub old_tags: Vec<String>,
    pub new_tags: Vec<String>,
    pub old_rating: u8,
    pub new_rating: u8,
    pub changed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EditOutput {
    pub dry_run: bool,
    pub total_matched: usize,
    pub total_updated: usize,
    pub changes: Vec<EditResultItem>,
}

/// Check if a photo's title is automatically set to the camera make/model.
pub fn is_camera_title(photo: &Photo) -> bool {
    let Some(title) = photo.title.as_deref() else {
        return false;
    };
    let title = title.trim();
    if title.is_empty() {
        return false;
    }
    let title_lower = title.to_lowercase();

    if let Some(model) = photo.camera_model.as_deref() {
        let model = model.trim().to_lowercase();
        if !model.is_empty() && title_lower == model {
            return true;
        }
    }
    if let Some(make) = photo.camera_make.as_deref() {
        let make = make.trim().to_lowercase();
        if !make.is_empty() && title_lower == make {
            return true;
        }
    }
    if let (Some(make), Some(model)) = (photo.camera_make.as_deref(), photo.camera_model.as_deref()) {
        let make = make.trim().to_lowercase();
        let model = model.trim().to_lowercase();
        if !make.is_empty() && !model.is_empty() {
            if title_lower == format!("{} {}", make, model)
                || title_lower == format!("{} {}", model, make)
            {
                return true;
            }
        }
    }
    false
}

/// Apply additions, removals, full replacement or clearing to an existing comma-separated tag string.
pub fn apply_tag_changes(
    existing: &str,
    add_tags: &[String],
    remove_tags: &[String],
    set_tags: Option<&[String]>,
    clear_tags: bool,
) -> String {
    let mut current_tags: Vec<String> = if clear_tags {
        Vec::new()
    } else if let Some(st) = set_tags {
        let mut list = Vec::new();
        let mut seen = HashSet::new();
        for t in st {
            for sub in t.split(',') {
                let clean = sub.trim();
                if !clean.is_empty() && seen.insert(clean.to_lowercase()) {
                    list.push(clean.to_string());
                }
            }
        }
        list
    } else {
        let mut list = Vec::new();
        let mut seen = HashSet::new();
        for t in existing.split(',') {
            let clean = t.trim();
            if !clean.is_empty() && seen.insert(clean.to_lowercase()) {
                list.push(clean.to_string());
            }
        }
        list
    };

    // Add tags
    for tag in add_tags {
        for sub in tag.split(',') {
            let clean = sub.trim();
            if clean.is_empty() {
                continue;
            }
            let lower = clean.to_lowercase();
            if !current_tags.iter().any(|existing_tag| existing_tag.to_lowercase() == lower) {
                current_tags.push(clean.to_string());
            }
        }
    }

    // Remove tags
    let to_remove: HashSet<String> = remove_tags
        .iter()
        .flat_map(|s| s.split(','))
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();

    if !to_remove.is_empty() {
        current_tags.retain(|tag| !to_remove.contains(&tag.to_lowercase()));
    }

    current_tags.join(", ")
}

/// List all tags from the database with photo counts.
pub fn list_tags(
    conn: &Connection,
    sort_by_name: bool,
    min_count: u32,
) -> anyhow::Result<Vec<TagItem>> {
    let raw = photo_repo::get_all_tags(conn)?;
    let mut items: Vec<TagItem> = raw
        .into_iter()
        .filter(|t| t.count >= min_count)
        .map(|t| TagItem {
            name: t.name,
            count: t.count,
        })
        .collect();

    if sort_by_name {
        items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    } else {
        items.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    }

    Ok(items)
}

/// Search and filter photos.
pub fn search_photos(
    conn: &Connection,
    query: Option<&str>,
    camera_title_only: bool,
    limit: Option<usize>,
) -> anyhow::Result<Vec<PhotoSummary>> {
    let photos = photo_repo::get_all(conn, query)?;
    let mut filtered: Vec<PhotoSummary> = photos
        .into_iter()
        .filter(|p| !camera_title_only || is_camera_title(p))
        .map(|p| PhotoSummary::from(&p))
        .collect();

    if let Some(lim) = limit {
        if lim > 0 && filtered.len() > lim {
            filtered.truncate(lim);
        }
    }

    Ok(filtered)
}

/// Find target photos for editing given multiple selection criteria.
pub fn find_target_photos(
    conn: &Connection,
    ids: &[String],
    paths: &[String],
    query: Option<&str>,
    camera_title_only: bool,
    all: bool,
) -> anyhow::Result<Vec<Photo>> {
    let mut targets = Vec::new();
    let mut seen_ids = HashSet::new();

    // 1. By ID
    for id in ids {
        for single_id in id.split(',') {
            let clean_id = single_id.trim();
            if clean_id.is_empty() {
                continue;
            }
            if let Ok(photo) = photo_repo::get_by_id(conn, clean_id) {
                if seen_ids.insert(photo.id.clone()) {
                    targets.push(photo);
                }
            } else if let Ok(Some(photo)) = photo_repo::get_by_path(conn, clean_id) {
                if seen_ids.insert(photo.id.clone()) {
                    targets.push(photo);
                }
            }
        }
    }

    // 2. By Path
    for path in paths {
        let clean_path = path.trim();
        if clean_path.is_empty() {
            continue;
        }
        if let Ok(Some(photo)) = photo_repo::get_by_path(conn, clean_path) {
            if seen_ids.insert(photo.id.clone()) {
                targets.push(photo);
            }
        } else if let Ok(photo) = photo_repo::get_by_id(conn, clean_path) {
            if seen_ids.insert(photo.id.clone()) {
                targets.push(photo);
            }
        }
    }

    // 3. By Query or Camera Title or All
    if all || query.is_some() || (camera_title_only && targets.is_empty()) {
        let photos = photo_repo::get_all(conn, query)?;
        for photo in photos {
            if camera_title_only && !is_camera_title(&photo) {
                continue;
            }
            if seen_ids.insert(photo.id.clone()) {
                targets.push(photo);
            }
        }
    } else if camera_title_only {
        targets.retain(is_camera_title);
    }

    Ok(targets)
}

/// Execute metadata edit on a list of photos, either in dry-run mode or live with DB & XMP updates.
pub fn edit_photos(
    conn: &Connection,
    targets: &[Photo],
    opts: &EditOptions,
    dry_run: bool,
) -> anyhow::Result<EditOutput> {
    let mut changes = Vec::new();
    let mut updated_count = 0;

    for photo in targets {
        let old_title = photo.title.clone().filter(|s| !s.trim().is_empty());
        let new_title = if opts.clear_title {
            None
        } else if let Some(ref t) = opts.set_title {
            let clean = t.trim().to_string();
            if clean.is_empty() {
                None
            } else {
                Some(clean)
            }
        } else {
            old_title.clone()
        };

        let old_description = photo.description.clone().filter(|s| !s.trim().is_empty());
        let new_description = if opts.clear_description {
            None
        } else if let Some(ref d) = opts.set_description {
            let clean = d.trim().to_string();
            if clean.is_empty() {
                None
            } else {
                Some(clean)
            }
        } else {
            old_description.clone()
        };

        let old_tags_vec: Vec<String> = photo
            .tags
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let new_tags_str = apply_tag_changes(
            &photo.tags,
            &opts.add_tags,
            &opts.remove_tags,
            opts.set_tags.as_deref(),
            opts.clear_tags,
        );

        let new_tags_vec: Vec<String> = new_tags_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let old_rating = photo.rating;
        let new_rating = opts.set_rating.unwrap_or(photo.rating);

        let changed = old_title != new_title
            || old_description != new_description
            || old_tags_vec != new_tags_vec
            || old_rating != new_rating;

        if changed {
            updated_count += 1;
            if !dry_run {
                update_metadata(
                    &photo.id,
                    new_rating,
                    &new_tags_str,
                    new_title.as_deref().unwrap_or(""),
                    new_description.as_deref().unwrap_or(""),
                    conn,
                )?;
            }
        }

        changes.push(EditResultItem {
            id: photo.id.clone(),
            path: photo.path.clone(),
            old_title,
            new_title,
            old_description,
            new_description,
            old_tags: old_tags_vec,
            new_tags: new_tags_vec,
            old_rating,
            new_rating,
            changed,
        });
    }

    Ok(EditOutput {
        dry_run,
        total_matched: targets.len(),
        total_updated: updated_count,
        changes,
    })
}

// ---------------------------------------------------------------------------
// Human-readable formatters
// ---------------------------------------------------------------------------

pub fn format_tags_table(tags: &[TagItem]) -> String {
    if tags.is_empty() {
        return "No tags found.".to_string();
    }
    let mut out = format!("=== Tags ({}) ===\n", tags.len());
    let max_len = tags.iter().map(|t| t.name.len()).max().unwrap_or(10).max(8);
    for t in tags {
        out.push_str(&format!("  {:<width$}  ({} photos)\n", t.name, t.count, width = max_len));
    }
    out
}

pub fn format_photo_summary(p: &PhotoSummary) -> String {
    let mut out = format!("[{}] {}\n", p.id, p.path);
    if let Some(ref t) = p.title {
        out.push_str(&format!("  Title:       {}\n", t));
    } else {
        out.push_str("  Title:       (none)\n");
    }
    if let Some(ref d) = p.description {
        out.push_str(&format!("  Description: {}\n", d));
    } else {
        out.push_str("  Description: (none)\n");
    }
    if !p.tags.is_empty() {
        out.push_str(&format!("  Tags:        {}\n", p.tags.join(", ")));
    } else {
        out.push_str("  Tags:        (none)\n");
    }
    if let (Some(ref make), Some(ref model)) = (&p.camera_make, &p.camera_model) {
        out.push_str(&format!("  Camera:      {} {}\n", make, model));
    } else if let Some(ref model) = p.camera_model {
        out.push_str(&format!("  Camera:      {}\n", model));
    } else if let Some(ref make) = p.camera_make {
        out.push_str(&format!("  Camera:      {}\n", make));
    }
    if let Some(ref dt) = p.capture_time {
        out.push_str(&format!("  Date:        {}\n", dt));
    }
    if p.rating > 0 {
        out.push_str(&format!("  Rating:      {}\n", p.rating));
    }
    if let Some(ref ev) = p.event {
        out.push_str(&format!("  Event:       {}\n", ev));
    }
    out
}

pub fn format_photos_list(photos: &[PhotoSummary]) -> String {
    if photos.is_empty() {
        return "No photos found matching criteria.".to_string();
    }
    let mut out = format!("Found {} photo(s):\n\n", photos.len());
    for p in photos {
        out.push_str(&format_photo_summary(p));
        out.push('\n');
    }
    out
}

pub fn format_edit_output(output: &EditOutput) -> String {
    let mut out = String::new();
    if output.dry_run {
        out.push_str("=== DamRight Metadata Edit (Dry Run) ===\n");
    } else {
        out.push_str("=== DamRight Metadata Edit Completed ===\n");
    }
    out.push_str(&format!(
        "Matched: {} | Updated: {}\n\n",
        output.total_matched, output.total_updated
    ));

    for c in &output.changes {
        if !c.changed {
            continue;
        }
        out.push_str(&format!("[{}] {}\n", c.id, c.path));
        if c.old_title != c.new_title {
            out.push_str(&format!(
                "  Title:       '{}' -> '{}'\n",
                c.old_title.as_deref().unwrap_or(""),
                c.new_title.as_deref().unwrap_or("")
            ));
        }
        if c.old_description != c.new_description {
            out.push_str(&format!(
                "  Description: '{}' -> '{}'\n",
                c.old_description.as_deref().unwrap_or(""),
                c.new_description.as_deref().unwrap_or("")
            ));
        }
        if c.old_tags != c.new_tags {
            out.push_str(&format!(
                "  Tags:        [{}] -> [{}]\n",
                c.old_tags.join(", "),
                c.new_tags.join(", ")
            ));
        }
        if c.old_rating != c.new_rating {
            out.push_str(&format!("  Rating:      {} -> {}\n", c.old_rating, c.new_rating));
        }
        out.push('\n');
    }

    if output.dry_run {
        out.push_str("Dry run complete. No database records or XMP sidecars were modified.\n");
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use crate::db::init_db;

    #[test]
    fn test_apply_tag_changes() {
        // Base case: existing tags
        let existing = "nature, landscape, mountain";

        // Add tag
        let res = apply_tag_changes(existing, &["sunset".to_string()], &[], None, false);
        assert_eq!(res, "nature, landscape, mountain, sunset");

        // Add duplicate tag (case-insensitive)
        let res = apply_tag_changes(existing, &["Nature".to_string(), "hiking".to_string()], &[], None, false);
        assert_eq!(res, "nature, landscape, mountain, hiking");

        // Remove tag
        let res = apply_tag_changes(existing, &[], &["landscape".to_string()], None, false);
        assert_eq!(res, "nature, mountain");

        // Set tags overrides existing
        let res = apply_tag_changes(
            existing,
            &[],
            &[],
            Some(&["travel".to_string(), "vacation".to_string()]),
            false,
        );
        assert_eq!(res, "travel, vacation");

        // Clear tags
        let res = apply_tag_changes(existing, &[], &[], None, true);
        assert_eq!(res, "");
    }

    #[test]
    fn test_is_camera_title() {
        let mut photo = Photo::default_for_test();
        photo.camera_make = Some("Sony".to_string());
        photo.camera_model = Some("ILCE-7M3".to_string());

        // Model matches title
        photo.title = Some("ILCE-7M3".to_string());
        assert!(is_camera_title(&photo));

        // Model matches title lowercase
        photo.title = Some("ilce-7m3".to_string());
        assert!(is_camera_title(&photo));

        // Make matches title
        photo.title = Some("Sony".to_string());
        assert!(is_camera_title(&photo));

        // Make + Model matches title
        photo.title = Some("Sony ILCE-7M3".to_string());
        assert!(is_camera_title(&photo));

        // Custom descriptive title should NOT match
        photo.title = Some("Sunset at Malibu Beach".to_string());
        assert!(!is_camera_title(&photo));

        // Empty title
        photo.title = None;
        assert!(!is_camera_title(&photo));
    }

    #[test]
    fn test_cli_tags_listing() -> anyhow::Result<()> {
        let dir = tempdir()?;
        let conn = init_db(dir.path())?;

        let mut p1 = Photo::default_for_test();
        p1.id = "p1".to_string();
        p1.path = dir.path().join("p1.jpg").to_string_lossy().to_string();
        p1.thumb_path = dir.path().join("thumb1.jpg").to_string_lossy().to_string();
        p1.tags = "nature, ocean".to_string();
        photo_repo::insert(&conn, &p1)?;

        let mut p2 = Photo::default_for_test();
        p2.id = "p2".to_string();
        p2.path = dir.path().join("p2.jpg").to_string_lossy().to_string();
        p2.thumb_path = dir.path().join("thumb2.jpg").to_string_lossy().to_string();
        p2.tags = "nature, mountain".to_string();
        photo_repo::insert(&conn, &p2)?;

        let tags = list_tags(&conn, false, 1)?;
        assert_eq!(tags.len(), 3);
        assert_eq!(tags[0].name, "nature");
        assert_eq!(tags[0].count, 2);

        let tags_sorted = list_tags(&conn, true, 1)?;
        assert_eq!(tags_sorted[0].name, "mountain");
        assert_eq!(tags_sorted[1].name, "nature");
        assert_eq!(tags_sorted[2].name, "ocean");

        let tags_min2 = list_tags(&conn, false, 2)?;
        assert_eq!(tags_min2.len(), 1);
        assert_eq!(tags_min2[0].name, "nature");

        Ok(())
    }

    #[test]
    fn test_cli_edit_title_and_description() -> anyhow::Result<()> {
        let dir = tempdir()?;
        let conn = init_db(dir.path())?;

        let photo_file = dir.path().join("photo1.jpg");
        std::fs::write(&photo_file, b"fake image bytes")?;

        let mut p = Photo::default_for_test();
        p.id = "photo-1".to_string();
        p.path = photo_file.to_string_lossy().to_string();
        p.thumb_path = dir.path().join("thumb1.jpg").to_string_lossy().to_string();
        p.camera_make = Some("Canon".to_string());
        p.camera_model = Some("EOS 5D".to_string());
        p.title = Some("EOS 5D".to_string());
        p.tags = "summer".to_string();
        photo_repo::insert(&conn, &p)?;

        // 1. Dry run test
        let opts = EditOptions {
            clear_title: true,
            set_description: Some("New Description".to_string()),
            add_tags: vec!["vacation".to_string()],
            ..Default::default()
        };

        let dry_res = edit_photos(&conn, &[p.clone()], &opts, true)?;
        assert!(dry_res.dry_run);
        assert_eq!(dry_res.total_updated, 1);
        assert_eq!(dry_res.changes[0].new_title, None);
        assert_eq!(dry_res.changes[0].new_description, Some("New Description".to_string()));
        assert_eq!(dry_res.changes[0].new_tags, vec!["summer", "vacation"]);

        // Verify DB not changed after dry run
        let p_after_dry = photo_repo::get_by_id(&conn, "photo-1")?;
        assert_eq!(p_after_dry.title.as_deref(), Some("EOS 5D"));

        // 2. Live edit
        let live_res = edit_photos(&conn, &[p.clone()], &opts, false)?;
        assert!(!live_res.dry_run);
        assert_eq!(live_res.total_updated, 1);

        // Verify DB updated
        let p_after_live = photo_repo::get_by_id(&conn, "photo-1")?;
        assert_eq!(p_after_live.title.as_deref(), Some(""));
        assert_eq!(p_after_live.description.as_deref(), Some("New Description"));
        assert!(p_after_live.tags.contains("summer"));
        assert!(p_after_live.tags.contains("vacation"));

        // Verify XMP sidecar was written
        let xmp_path = photo_file.with_extension("xmp");
        assert!(xmp_path.exists());
        let xmp_content = std::fs::read_to_string(xmp_path)?;
        assert!(xmp_content.contains("New Description"));
        assert!(xmp_content.contains("vacation"));

        Ok(())
    }

    #[test]
    fn test_batch_clear_camera_titles() -> anyhow::Result<()> {
        let dir = tempdir()?;
        let conn = init_db(dir.path())?;

        // Photo 1: Title is camera model (should match)
        let f1 = dir.path().join("c1.jpg");
        std::fs::write(&f1, b"bytes")?;
        let mut p1 = Photo::default_for_test();
        p1.id = "c1".to_string();
        p1.path = f1.to_string_lossy().to_string();
        p1.camera_make = Some("Sony".to_string());
        p1.camera_model = Some("ILCE-7M3".to_string());
        p1.title = Some("ILCE-7M3".to_string());
        photo_repo::insert(&conn, &p1)?;

        // Photo 2: Title is custom (should NOT match)
        let f2 = dir.path().join("c2.jpg");
        std::fs::write(&f2, b"bytes")?;
        let mut p2 = Photo::default_for_test();
        p2.id = "c2".to_string();
        p2.path = f2.to_string_lossy().to_string();
        p2.camera_make = Some("Sony".to_string());
        p2.camera_model = Some("ILCE-7M3".to_string());
        p2.title = Some("Family Portrait".to_string());
        photo_repo::insert(&conn, &p2)?;

        // Search photos with camera title
        let matching = search_photos(&conn, None, true, None)?;
        assert_eq!(matching.len(), 1);
        assert_eq!(matching[0].id, "c1");

        // Clear camera title
        let targets = find_target_photos(&conn, &[], &[], None, true, false)?;
        assert_eq!(targets.len(), 1);

        let opts = EditOptions {
            clear_title: true,
            ..Default::default()
        };
        edit_photos(&conn, &targets, &opts, false)?;

        let updated_p1 = photo_repo::get_by_id(&conn, "c1")?;
        assert_eq!(updated_p1.title.as_deref(), Some(""));

        let untouched_p2 = photo_repo::get_by_id(&conn, "c2")?;
        assert_eq!(untouched_p2.title.as_deref(), Some("Family Portrait"));

        Ok(())
    }

    #[test]
    fn test_xmp_title_cleared_from_existing_sidecar() -> anyhow::Result<()> {
        let dir = tempdir()?;
        let conn = init_db(dir.path())?;

        let photo_file = dir.path().join("sidecar_test.jpg");
        std::fs::write(&photo_file, b"fake image bytes")?;

        let xmp_file = photo_file.with_extension("xmp");
        let initial_xmp = r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">ILCE-7M3</rdf:li>
    </rdf:Alt>
   </dc:title>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#;
        std::fs::write(&xmp_file, initial_xmp)?;

        let mut p = Photo::default_for_test();
        p.id = "sidecar-1".to_string();
        p.path = photo_file.to_string_lossy().to_string();
        p.thumb_path = dir.path().join("thumb_s.jpg").to_string_lossy().to_string();
        p.camera_make = Some("Sony".to_string());
        p.camera_model = Some("ILCE-7M3".to_string());
        p.title = Some("ILCE-7M3".to_string());
        photo_repo::insert(&conn, &p)?;

        let opts = EditOptions {
            clear_title: true,
            ..Default::default()
        };
        edit_photos(&conn, &[p], &opts, false)?;

        let updated_xmp = std::fs::read_to_string(&xmp_file)?;
        assert!(!updated_xmp.contains("ILCE-7M3"));
        assert!(!updated_xmp.contains("<dc:title>"));

        Ok(())
    }
}
