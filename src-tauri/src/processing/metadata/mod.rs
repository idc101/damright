pub mod xmp;
pub mod xmp_document;
pub mod faces;

pub use xmp_document::XmpDocument;
pub use xmp::{get_xmp_orientation, get_xmp_metadata, write_xmp, extract_crop_rotation, extract_location, extract_title_description};
pub use faces::extract_faces;

use std::path::Path;
use std::fs;
use crate::db::photo_repo;
use rusqlite::Connection;
use crate::models::Face;
use crate::processing::image::{is_video, is_markdown};
use nom_exif::{MediaParser, MediaSource, TrackInfoTag};

#[derive(Default, Debug, Clone)]
pub struct MarkdownMetadata {
    pub title: Option<String>,
    pub capture_time: Option<chrono::NaiveDateTime>,
    pub event: Option<String>,
    pub tags: Vec<String>,
    pub description: Option<String>,
}

pub fn parse_markdown_metadata(path: &Path) -> MarkdownMetadata {
    let mut meta = MarkdownMetadata::default();
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return meta,
    };

    let mut body_lines = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    let mut frontmatter_lines = Vec::new();
    let mut idx = 0;

    if let Some(first_line) = lines.first() {
        if first_line.trim() == "---" {
            idx = 1;
            while idx < lines.len() {
                let line = lines[idx];
                if line.trim() == "---" {
                    idx += 1;
                    break;
                }
                frontmatter_lines.push(line);
                idx += 1;
            }
        }
    }

    // Parse frontmatter key-values
    for line in frontmatter_lines {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, val)) = trimmed.split_once(':') {
            let key = key.trim().to_lowercase();
            let val = val.trim().trim_matches(|c| c == '"' || c == '\'').trim();

            match key.as_str() {
                "title" => {
                    if !val.is_empty() {
                        meta.title = Some(val.to_string());
                    }
                }
                "date" | "capture_time" => {
                    if !val.is_empty() {
                        if let Some(dt) = parse_markdown_date(val) {
                            meta.capture_time = Some(dt);
                        }
                    }
                }
                "event" => {
                    if !val.is_empty() {
                        meta.event = Some(val.to_string());
                    }
                }
                "tags" => {
                    if !val.is_empty() {
                        let clean = val.trim_start_matches('[').trim_end_matches(']');
                        let tags: Vec<String> = clean
                            .split(',')
                            .map(|s| s.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
                            .filter(|s| !s.is_empty())
                            .collect();
                        meta.tags = tags;
                    }
                }
                "description" | "summary" => {
                    if !val.is_empty() {
                        meta.description = Some(val.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    // Process remaining lines for title and description fallbacks
    while idx < lines.len() {
        body_lines.push(lines[idx]);
        idx += 1;
    }

    // If title not found in frontmatter, find first # Heading
    if meta.title.is_none() {
        for line in &body_lines {
            let trimmed = line.trim();
            if let Some(heading) = trimmed.strip_prefix("# ") {
                let h = heading.trim();
                if !h.is_empty() {
                    meta.title = Some(h.to_string());
                    break;
                }
            } else if let Some(heading) = trimmed.strip_prefix("## ") {
                let h = heading.trim();
                if !h.is_empty() {
                    meta.title = Some(h.to_string());
                    break;
                }
            }
        }
    }

    // If still no title, use filename without extension
    if meta.title.is_none() {
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            meta.title = Some(stem.replace('-', " ").replace('_', " ").trim().to_string());
        }
    }

    // If description not found in frontmatter, find first non-empty non-heading paragraph line
    if meta.description.is_none() {
        for line in &body_lines {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !trimmed.starts_with('#') && !trimmed.starts_with("```") && !trimmed.starts_with("---") {
                let snippet = if trimmed.len() > 300 {
                    let mut end = 300;
                    while !trimmed.is_char_boundary(end) && end > 0 {
                        end -= 1;
                    }
                    format!("{}...", &trimmed[..end])
                } else {
                    trimmed.to_string()
                };
                meta.description = Some(snippet);
                break;
            }
        }
    }

    meta
}

fn parse_markdown_date(s: &str) -> Option<chrono::NaiveDateTime> {
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
        return Some(dt);
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Some(dt);
    }
    if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return d.and_hms_opt(0, 0, 0);
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(dt.naive_local());
    }
    None
}

pub fn parse_iso6709(s: &str) -> Option<(f64, f64)> {
    // Format: +40.7128-074.0060+000.000/
    let re = regex::Regex::new(r"([+-]\d+\.?\d*)([+-]\d+\.?\d*)").ok()?;
    let caps = re.captures(s)?;
    let lat = caps.get(1)?.as_str().parse::<f64>().ok()?;
    let lon = caps.get(2)?.as_str().parse::<f64>().ok()?;
    Some((lat, lon))
}

#[derive(Default)]
pub struct ExtendedMetadata {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: Option<i64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub capture_time: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
    pub location_name: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub event: Option<String>,
    pub faces: Vec<Face>,
    pub crop_top: Option<f64>,
    pub crop_left: Option<f64>,
    pub crop_bottom: Option<f64>,
    pub crop_right: Option<f64>,
    pub crop_angle: Option<f64>,
}

pub fn get_extended_metadata(path: &Path) -> ExtendedMetadata {
    let xmp_doc = XmpDocument::load_for_media(path);
    get_extended_metadata_with_xmp(path, xmp_doc.as_ref())
}

pub fn get_extended_metadata_with_xmp(path: &Path, xmp_doc: Option<&XmpDocument>) -> ExtendedMetadata {
    let mut meta = ExtendedMetadata::default();

    // 1. File size
    if let Ok(m) = fs::metadata(path) {
        meta.file_size = Some(m.len() as i64);
    }

    // 2. Dimensions (using image::image_dimensions for speed on supported formats)
    if let Ok((w, h)) = image::image_dimensions(path) {
        meta.width = Some(w);
        meta.height = Some(h);
    }

    // 3. Capture Time
    if let Some(dt) = get_capture_time_with_xmp(path, xmp_doc) {
        meta.capture_time = Some(dt.format("%Y-%m-%d %H:%M:%S").to_string());
    }

    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    
    // Video Metadata using nom-exif
    if is_video(&ext) {
        let mut parser = MediaParser::new();
        if let Ok(ms) = MediaSource::open(path) {
            if let Ok(track_info) = parser.parse_track(ms) {
                if meta.width.is_none() || meta.height.is_none() {
                    meta.width = track_info.get(TrackInfoTag::Width).and_then(|v| v.as_u32());
                    meta.height = track_info.get(TrackInfoTag::Height).and_then(|v| v.as_u32());
                }
                if meta.camera_make.is_none() {
                    meta.camera_make = track_info.get(TrackInfoTag::Make).and_then(|v| v.as_str().map(|s| s.to_string()));
                }
                if meta.camera_model.is_none() {
                    meta.camera_model = track_info.get(TrackInfoTag::Model).and_then(|v| v.as_str().map(|s| s.to_string()));
                }
                
                if let Some(gps) = track_info.gps_info() {
                    meta.latitude = gps.latitude_decimal();
                    meta.longitude = gps.longitude_decimal();
                } else if let Some(loc_str) = track_info.get(TrackInfoTag::GpsIso6709).and_then(|v| v.as_str()) {
                    if let Some((lat, lon)) = parse_iso6709(loc_str) {
                        meta.latitude = Some(lat);
                        meta.longitude = Some(lon);
                    }
                }
            }
        }
    } else if is_markdown(&ext) {
        let md_meta = parse_markdown_metadata(path);
        if meta.title.is_none() {
            meta.title = md_meta.title;
        }
        if meta.description.is_none() {
            meta.description = md_meta.description;
        }
        if meta.event.is_none() {
            meta.event = md_meta.event;
        }
    }

    // 4. EXIF data (Make, Model, GPS, HierarchicalSubject fallback, Orientation)
    let mut orientation = 1;
    if let Ok(file) = fs::File::open(path) {
        let mut bufreader = std::io::BufReader::new(file);
        let exifreader = exif::Reader::new();
        if let Ok(exif) = exifreader.read_from_container(&mut bufreader) {
            // Orientation
            if let Some(field) = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
                if let Some(val) = field.value.get_uint(0) {
                    orientation = val as u8;
                }
            }

            // Make & Model
            meta.camera_make = exif.get_field(exif::Tag::Make, exif::In::PRIMARY)
                .map(|f| f.display_value().to_string().replace('"', ""));
            meta.camera_model = exif.get_field(exif::Tag::Model, exif::In::PRIMARY)
                .map(|f| f.display_value().to_string().replace('"', ""));

            // Description fallback from EXIF
            meta.description = exif.get_field(exif::Tag::ImageDescription, exif::In::PRIMARY)
                .map(|f| f.display_value().to_string().replace('"', ""));

            // GPS
            if let Some(lat_field) = exif.get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY) {
                if let Some(lat_ref_field) = exif.get_field(exif::Tag::GPSLatitudeRef, exif::In::PRIMARY) {
                    let lat_ref = lat_ref_field.display_value().to_string();
                    if let Some(lat) = parse_gps_coord(&lat_field.value, &lat_ref) {
                        meta.latitude = Some(lat);
                    }
                }
            }
            if let Some(long_field) = exif.get_field(exif::Tag::GPSLongitude, exif::In::PRIMARY) {
                if let Some(long_ref_field) = exif.get_field(exif::Tag::GPSLongitudeRef, exif::In::PRIMARY) {
                    let long_ref = long_ref_field.display_value().to_string();
                    if let Some(long) = parse_gps_coord(&long_field.value, &long_ref) {
                        meta.longitude = Some(long);
                    }
                }
            }

            // If dimensions weren't caught by image crate (e.g. HEIC), try EXIF
            if meta.width.is_none() {
                meta.width = exif.get_field(exif::Tag::PixelXDimension, exif::In::PRIMARY)
                    .and_then(|f| f.value.get_uint(0));
            }
            if meta.height.is_none() {
                meta.height = exif.get_field(exif::Tag::PixelYDimension, exif::In::PRIMARY)
                    .and_then(|f| f.value.get_uint(0));
            }
        }
    }

    // If dimensions are still missing for HEIC/HEIF, use heic crate ImageInfo
    if (ext == "heic" || ext == "heif") && (meta.width.is_none() || meta.height.is_none()) {
        if let Ok(data) = fs::read(path) {
            if let Ok(info) = heic::ImageInfo::from_bytes(&data) {
                meta.width = Some(info.width);
                meta.height = Some(info.height);
            }
        }
    }

    // Check XMP orientation as well (it overrides EXIF if present)
    if let Some(doc) = xmp_doc {
        if let Some(xmp_orient) = doc.orientation {
            orientation = xmp_orient;
        }
    } else if let Some(xmp_orient) = xmp::get_xmp_orientation(path) {
        orientation = xmp_orient;
    }

    // 5. Adjust dimensions based on orientation
    let already_rotated = ext == "heic" || ext == "heif";

    if !already_rotated && orientation >= 5 && orientation <= 8 {
        if let (Some(w), Some(h)) = (meta.width, meta.height) {
            meta.width = Some(h);
            meta.height = Some(w);
        }
    }

    // 6. XMP Data (Faces, Regions, HierarchicalSubject, Location, Title/Desc, Event, Crop)
    meta.faces = faces::extract_faces_with_xmp(path, xmp_doc);

    if let Some(doc) = xmp_doc {
        meta.city = doc.location.city.clone();
        meta.state = doc.location.state.clone();
        meta.country = doc.location.country.clone();
        meta.location_name = doc.location.location_name.clone();

        meta.title = doc.title.clone();
        meta.description = doc.description.clone();
        if doc.event.is_some() {
            meta.event = doc.event.clone();
        }

        meta.crop_top = doc.crop.top;
        meta.crop_left = doc.crop.left;
        meta.crop_bottom = doc.crop.bottom;
        meta.crop_right = doc.crop.right;
        meta.crop_angle = doc.crop.angle;
    } else {
        let (city, state, country, location_name) = xmp::extract_location(path);
        meta.city = city;
        meta.state = state;
        meta.country = country;
        meta.location_name = location_name;

        let (title, description) = xmp::extract_title_description(path);
        if title.is_some() { meta.title = title; }
        if description.is_some() { meta.description = description; }

        let (_, _, event) = xmp::get_xmp_metadata(path);
        if event.is_some() { meta.event = event; }

        let (ct, cl, cb, cr, ca) = xmp::extract_crop_rotation(path, meta.width, meta.height, Some(orientation));
        meta.crop_top = ct;
        meta.crop_left = cl;
        meta.crop_bottom = cb;
        meta.crop_right = cr;
        meta.crop_angle = ca;
    }

    meta
}

pub fn parse_gps_coord(value: &exif::Value, ref_val: &str) -> Option<f64> {
    if let exif::Value::Rational(rationals) = value {
        if rationals.len() >= 3 {
            let d = rationals[0].to_f64();
            let m = rationals[1].to_f64();
            let s = rationals[2].to_f64();
            
            let mut res = d + (m / 60.0) + (s / 3600.0);
            if ref_val.contains('S') || ref_val.contains('W') {
                res = -res;
            }
            return Some(res);
        }
    }
    None
}

pub fn get_embedded_metadata(path: &Path) -> (u8, String) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (0, String::new()),
    };
    let mut bufreader = std::io::BufReader::new(file);
    let exifreader = exif::Reader::new();
    let exif = match exifreader.read_from_container(&mut bufreader) {
        Ok(e) => e,
        Err(_) => return (0, String::new()),
    };

    let mut rating = 0;
    // Rating tag (0x4746)
    if let Some(field) = exif.get_field(exif::Tag(exif::Context::Exif, 0x4746), exif::In::PRIMARY) {
        if let Some(val) = field.value.get_uint(0) {
            rating = val as u8;
        }
    }

    let mut tags = String::new();
    // XPKeywords (0x9c9e) - UCS-2 encoded
    if let Some(field) = exif.get_field(exif::Tag(exif::Context::Exif, 0x9c9e), exif::In::PRIMARY) {
        if let exif::Value::Byte(bytes) = &field.value {
            // XPKeywords is UTF-16LE / UCS-2 with null terminators
            let words: Vec<u16> = bytes.chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .filter(|&w| w != 0)
                .collect();
            if let Ok(s) = String::from_utf16(&words) {
                tags = s.replace(';', ",");
            }
        }
    }

    (rating, tags)
}

pub fn get_exif_orientation(path: &Path) -> Option<u8> {
    let file = std::fs::File::open(path).ok()?;
    let mut bufreader = std::io::BufReader::new(file);
    let exifreader = exif::Reader::new();
    let exif = exifreader.read_from_container(&mut bufreader).ok()?;
    exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .map(|v| v as u8)
}

#[cfg(target_os = "macos")]
pub fn get_sips_orientation(path: &Path) -> Option<u8> {
    use std::process::Command;
    let mut cmd = Command::new("sips");
    cmd.arg("-g")
        .arg("orientation")
        .arg(path);
    let output = match crate::processing::run_command_with_timeout(
        &mut cmd,
        std::time::Duration::from_secs(5),
    ) {
        Ok(out) => out,
        Err(e) => {
            eprintln!("Warning: sips orientation command timed out/failed for {}: {}", path.display(), e);
            return None;
        }
    };

    if !output.status.success() {
        eprintln!(
            "Warning: sips orientation command failed with status {} for {}. stdout: '{}', stderr: '{}'",
            output.status,
            path.display(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return None;
    }
    
    let s = String::from_utf8_lossy(&output.stdout);
    // sips output looks like: "  orientation: top-left" or "  orientation: right-top"
    if let Some(line) = s.lines().find(|l| l.contains("orientation:")) {
        let val = line.split(':').last()?.trim();
        return match val {
            "top-left" => Some(1),
            "top-right" => Some(2),
            "bottom-right" => Some(3),
            "bottom-left" => Some(4),
            "left-top" => Some(5),
            "right-top" => Some(6),
            "right-bottom" => Some(7),
            "left-bottom" => Some(8),
            _ => None,
        };
    }
    None
}

pub fn get_capture_time(path: &Path) -> Option<chrono::NaiveDateTime> {
    get_capture_time_with_xmp(path, XmpDocument::load_for_media(path).as_ref())
}

pub fn get_capture_time_with_xmp(path: &Path, xmp_doc: Option<&XmpDocument>) -> Option<chrono::NaiveDateTime> {
    // 1. Try XMP first
    if let Some(doc) = xmp_doc {
        if let Some(dt) = doc.capture_time {
            return Some(dt);
        }
    } else if let Some(dt) = xmp::get_capture_time_xmp(path) {
        return Some(dt);
    }

    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    
    // 2. Try Markdown frontmatter date
    if is_markdown(&ext) {
        let md_meta = parse_markdown_metadata(path);
        if let Some(dt) = md_meta.capture_time {
            return Some(dt);
        }
    }

    // 3. Try nom-exif for video
    if is_video(&ext) {
        let mut parser = MediaParser::new();
        if let Ok(ms) = MediaSource::open(path) {
            if let Ok(track_info) = parser.parse_track(ms) {
                if let Some(dt) = track_info.get(TrackInfoTag::CreateDate).and_then(|v| v.as_datetime()) {
                    return Some(dt.into_naive());
                }
            }
        }
    }

    // 4. Try EXIF
    if let Ok(file) = fs::File::open(path) {
        let mut bufreader = std::io::BufReader::new(file);
        let exifreader = exif::Reader::new();
        if let Ok(exif) = exifreader.read_from_container(&mut bufreader) {
            if let Some(field) = exif.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY) {
                if let exif::Value::Ascii(ref v) = field.value {
                    if let Some(s) = v.get(0).and_then(|b| std::str::from_utf8(b).ok()) {
                        // EXIF date format: "YYYY:MM:DD HH:MM:SS"
                        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y:%m:%d %H:%M:%S") {
                            return Some(dt);
                        }
                    }
                }
            }
        }
    }

    // 5. Try parsing date/time from the filename
    if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
        if let Some(dt) = parse_date_from_filename(filename) {
            return Some(dt);
        }
    }

    // 6. For markdown, fallback to file modified timestamp if available
    if is_markdown(&ext) {
        if let Ok(m) = fs::metadata(path) {
            if let Ok(mod_time) = m.modified() {
                let dt: chrono::DateTime<chrono::Utc> = mod_time.into();
                return Some(dt.naive_utc());
            }
        }
    }

    None
}

fn parse_date_from_filename(filename: &str) -> Option<chrono::NaiveDateTime> {
    use std::sync::OnceLock;
    use chrono::{NaiveDate, NaiveTime, NaiveDateTime};

    static DATETIME_SEC_SEP: OnceLock<regex::Regex> = OnceLock::new();
    static DATETIME_SEC_NOSEP: OnceLock<regex::Regex> = OnceLock::new();
    static DATETIME_MIN_SEP: OnceLock<regex::Regex> = OnceLock::new();
    static DATE_ONLY: OnceLock<regex::Regex> = OnceLock::new();

    let re_dt_sec_sep = DATETIME_SEC_SEP.get_or_init(|| {
        regex::Regex::new(r"(?:^|[^\d])(19\d{2}|20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])[T\s_-]([01]\d|2[0-3])[-_.:]?([0-5]\d)[-_.:]?([0-5]\d)(?:$|[^\d])").unwrap()
    });
    let re_dt_sec_nosep = DATETIME_SEC_NOSEP.get_or_init(|| {
        regex::Regex::new(r"(?:^|[^\d])(19\d{2}|20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([01]\d|2[0-3])([0-5]\d)([0-5]\d)(?:$|[^\d])").unwrap()
    });
    let re_dt_min_sep = DATETIME_MIN_SEP.get_or_init(|| {
        regex::Regex::new(r"(?:^|[^\d])(19\d{2}|20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])[T\s_-]([01]\d|2[0-3])[-_.:]?([0-5]\d)(?:$|[^\d])").unwrap()
    });
    let re_date_only = DATE_ONLY.get_or_init(|| {
        regex::Regex::new(r"(?:^|[^\d])(19\d{2}|20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])(?:$|[^\d])").unwrap()
    });

    // Try matches in order of specificity
    if let Some(caps) = re_dt_sec_sep.captures(filename) {
        let year: i32 = caps[1].parse().ok()?;
        let month: u32 = caps[2].parse().ok()?;
        let day: u32 = caps[3].parse().ok()?;
        let hour: u32 = caps[4].parse().ok()?;
        let minute: u32 = caps[5].parse().ok()?;
        let second: u32 = caps[6].parse().ok()?;
        let date = NaiveDate::from_ymd_opt(year, month, day)?;
        let time = NaiveTime::from_hms_opt(hour, minute, second)?;
        return Some(NaiveDateTime::new(date, time));
    }

    if let Some(caps) = re_dt_sec_nosep.captures(filename) {
        let year: i32 = caps[1].parse().ok()?;
        let month: u32 = caps[2].parse().ok()?;
        let day: u32 = caps[3].parse().ok()?;
        let hour: u32 = caps[4].parse().ok()?;
        let minute: u32 = caps[5].parse().ok()?;
        let second: u32 = caps[6].parse().ok()?;
        let date = NaiveDate::from_ymd_opt(year, month, day)?;
        let time = NaiveTime::from_hms_opt(hour, minute, second)?;
        return Some(NaiveDateTime::new(date, time));
    }

    if let Some(caps) = re_dt_min_sep.captures(filename) {
        let year: i32 = caps[1].parse().ok()?;
        let month: u32 = caps[2].parse().ok()?;
        let day: u32 = caps[3].parse().ok()?;
        let hour: u32 = caps[4].parse().ok()?;
        let minute: u32 = caps[5].parse().ok()?;
        let date = NaiveDate::from_ymd_opt(year, month, day)?;
        let time = NaiveTime::from_hms_opt(hour, minute, 0)?;
        return Some(NaiveDateTime::new(date, time));
    }

    if let Some(caps) = re_date_only.captures(filename) {
        let year: i32 = caps[1].parse().ok()?;
        let month: u32 = caps[2].parse().ok()?;
        let day: u32 = caps[3].parse().ok()?;
        let date = NaiveDate::from_ymd_opt(year, month, day)?;
        let time = NaiveTime::from_hms_opt(12, 0, 0)?; // noon default
        return Some(NaiveDateTime::new(date, time));
    }

    None
}

pub fn invalidate_cache(photo: &crate::models::Photo) {
    let _ = crate::processing::storage::AssetStorage::cleanup_preview_cache(&photo.thumb_path, &photo.path);

    // Eagerly regenerate the thumbnail so it displays with the new crop/exposure
    let processor = crate::processing::image::get_processor();
    if let Err(e) = processor.generate_thumbnail(photo, &Path::new(&photo.thumb_path)) {
        eprintln!("Failed to regenerate thumbnail for photo {}: {:?}", photo.id, e);
    }
}

pub fn update_exposure(
    id: &str,
    exposure: f32,
    conn: &Connection,
) -> anyhow::Result<()> {
    photo_repo::update_exposure(conn, id, exposure)?;
    let photo = photo_repo::get_by_id(conn, id)?;
    xmp::write_xmp(
        &photo.path, 
        exposure, 
        photo.rating, 
        &photo.tags,
        photo.title.as_deref(),
        photo.description.as_deref(),
        photo.crop_top,
        photo.crop_left,
        photo.crop_bottom,
        photo.crop_right,
        photo.crop_angle,
        photo.capture_time.clone(),
        photo.event.clone(),
        photo.portrait_blur,
    )?;
    invalidate_cache(&photo);
    Ok(())
}

pub fn update_portrait_blur(
    id: &str,
    portrait_blur: f64,
    conn: &Connection,
) -> anyhow::Result<()> {
    photo_repo::update_portrait_blur(conn, id, portrait_blur)?;
    let photo = photo_repo::get_by_id(conn, id)?;
    xmp::write_xmp(
        &photo.path,
        photo.exposure,
        photo.rating,
        &photo.tags,
        photo.title.as_deref(),
        photo.description.as_deref(),
        photo.crop_top,
        photo.crop_left,
        photo.crop_bottom,
        photo.crop_right,
        photo.crop_angle,
        photo.capture_time.clone(),
        photo.event.clone(),
        Some(portrait_blur),
    )?;
    invalidate_cache(&photo);
    Ok(())
}

pub fn update_metadata(
    id: &str,
    rating: u8,
    tags: &str,
    title: &str,
    description: &str,
    conn: &Connection,
) -> anyhow::Result<()> {
    let photo = photo_repo::get_by_id(conn, id)?;
    let (rank_score, suggested_rating) = if photo.rating != rating {
        crate::processing::ranking::adjust_score_for_rating_change(
            photo.rank_score,
            photo.rating,
            rating,
            photo.match_count,
        )
    } else {
        (photo.rank_score, photo.suggested_rating)
    };

    photo_repo::update_metadata(
        conn,
        id,
        rating,
        tags,
        title,
        description,
        rank_score,
        suggested_rating,
    )?;
    xmp::write_xmp(
        &photo.path,
        photo.exposure,
        rating,
        tags,
        Some(title),
        Some(description),
        photo.crop_top,
        photo.crop_left,
        photo.crop_bottom,
        photo.crop_right,
        photo.crop_angle,
        photo.capture_time,
        photo.event,
        photo.portrait_blur,
    )?;
    Ok(())
}

pub fn update_crop(
    id: &str,
    top: Option<f64>,
    left: Option<f64>,
    bottom: Option<f64>,
    right: Option<f64>,
    angle: Option<f64>,
    conn: &Connection,
) -> anyhow::Result<()> {
    photo_repo::update_crop(conn, id, top, left, bottom, right, angle)?;
    let photo = photo_repo::get_by_id(conn, id)?;
    xmp::write_xmp(
        &photo.path,
        photo.exposure,
        photo.rating,
        &photo.tags,
        photo.title.as_deref(),
        photo.description.as_deref(),
        photo.crop_top,
        photo.crop_left,
        photo.crop_bottom,
        photo.crop_right,
        photo.crop_angle,
        photo.capture_time.clone(),
        photo.event.clone(),
        photo.portrait_blur,
    )?;
    invalidate_cache(&photo);
    Ok(())
}

pub fn update_capture_time(
    id: &str,
    capture_time: &str,
    conn: &Connection,
) -> anyhow::Result<()> {
    let photo = photo_repo::get_by_id(conn, id)?;
    photo_repo::update_capture_time(conn, id, capture_time)?;
    xmp::write_xmp(
        &photo.path,
        photo.exposure,
        photo.rating,
        &photo.tags,
        photo.title.as_deref(),
        photo.description.as_deref(),
        photo.crop_top,
        photo.crop_left,
        photo.crop_bottom,
        photo.crop_right,
        photo.crop_angle,
        Some(capture_time.to_string()),
        photo.event,
        photo.portrait_blur,
    )?;
    crate::processing::audit::update_photo_validation(conn, id)?;
    Ok(())
}

pub fn update_event(
    id: &str,
    event: Option<String>,
    conn: &Connection,
) -> anyhow::Result<()> {
    let photo = photo_repo::get_by_id(conn, id)?;
    photo_repo::update_event(conn, id, event.as_deref())?;
    xmp::write_xmp(
        &photo.path,
        photo.exposure,
        photo.rating,
        &photo.tags,
        photo.title.as_deref(),
        photo.description.as_deref(),
        photo.crop_top,
        photo.crop_left,
        photo.crop_bottom,
        photo.crop_right,
        photo.crop_angle,
        photo.capture_time,
        event,
        photo.portrait_blur,
    )?;
    crate::processing::audit::update_photo_validation(conn, id)?;
    Ok(())
}
