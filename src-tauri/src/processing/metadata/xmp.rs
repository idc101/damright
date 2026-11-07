use std::path::Path;
use super::xmp_document::{CropMetadata, XmpDocument};

pub use super::xmp_document::{
    oriented_to_raw_crop, parse_xmp_date, raw_to_oriented_crop, extract_xml_attr, extract_xml_tag,
};

pub fn extract_crop_rotation(
    path: &Path,
    img_width: Option<u32>,
    img_height: Option<u32>,
    orientation: Option<u8>,
) -> (Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
    let orient = orientation.unwrap_or_else(|| get_photo_orientation(path));
    if let Some(doc) = XmpDocument::load_for_media_with_dimensions(path, img_width, img_height, Some(orient)) {
        (
            doc.crop.top,
            doc.crop.left,
            doc.crop.bottom,
            doc.crop.right,
            doc.crop.angle,
        )
    } else {
        (None, None, None, None, None)
    }
}

pub fn extract_location(path: &Path) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    if let Some(doc) = XmpDocument::load_for_media(path) {
        (
            doc.location.city,
            doc.location.state,
            doc.location.country,
            doc.location.location_name,
        )
    } else {
        (None, None, None, None)
    }
}

pub fn extract_title_description(path: &Path) -> (Option<String>, Option<String>) {
    if let Some(doc) = XmpDocument::load_for_media(path) {
        (doc.title, doc.description)
    } else {
        (None, None)
    }
}

pub fn get_xmp_metadata(path: &Path) -> (u8, String, Option<String>) {
    if let Some(doc) = XmpDocument::load_for_media(path) {
        (doc.rating, doc.tags.join(","), doc.event)
    } else {
        (0, String::new(), None)
    }
}

pub fn get_xmp_orientation(path: &Path) -> Option<u8> {
    XmpDocument::load_for_media(path).and_then(|doc| doc.orientation)
}

pub fn get_xmp_exposure(path: &Path) -> Option<f32> {
    XmpDocument::load_for_media(path).and_then(|doc| doc.exposure)
}

pub fn get_capture_time_xmp(path: &Path) -> Option<chrono::NaiveDateTime> {
    XmpDocument::load_for_media(path).and_then(|doc| doc.capture_time)
}

pub fn get_preserved_filename(path: &Path) -> Option<String> {
    XmpDocument::load_for_media(path).and_then(|doc| doc.preserved_filename)
}

pub fn write_xmp(
    photo_path: &str,
    exposure: f32,
    rating: u8,
    tags: &str,
    title: Option<&str>,
    description: Option<&str>,
    crop_top: Option<f64>,
    crop_left: Option<f64>,
    crop_bottom: Option<f64>,
    crop_right: Option<f64>,
    crop_angle: Option<f64>,
    capture_time: Option<String>,
    event: Option<String>,
    portrait_blur: Option<f64>,
) -> anyhow::Result<()> {
    let photo_p = Path::new(photo_path);
    let mut doc = XmpDocument::load_for_media(photo_p).unwrap_or_else(XmpDocument::new_empty);

    doc.set_exposure(if exposure != 0.0 { Some(exposure) } else { None });
    doc.set_rating(rating);
    let tag_vec: Vec<String> = tags
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    doc.set_tags(&tag_vec);
    doc.set_title(title.map(|s| s.to_string()));
    doc.set_description(description.map(|s| s.to_string()));

    let orient = get_photo_orientation(photo_p);
    doc.set_crop(
        CropMetadata {
            top: crop_top,
            left: crop_left,
            bottom: crop_bottom,
            right: crop_right,
            angle: crop_angle,
        },
        orient,
    );

    if let Some(ct) = capture_time {
        if let Some(dt) = parse_xmp_date(&ct) {
            doc.set_capture_time(dt);
        }
    }
    doc.set_event(event);
    doc.set_portrait_blur(portrait_blur);

    let xmp_path = photo_p.with_extension("xmp");
    doc.save_to_file(&xmp_path)
}

pub fn write_preserved_filename(photo_path: &str, original_filename: &str) -> anyhow::Result<()> {
    let photo_p = Path::new(photo_path);
    let mut doc = XmpDocument::load_for_media(photo_p).unwrap_or_else(XmpDocument::new_empty);
    if doc.preserved_filename.is_some() {
        return Ok(());
    }
    doc.set_preserved_filename(original_filename);
    let xmp_path = photo_p.with_extension("xmp");
    doc.save_to_file(&xmp_path)
}

pub fn get_photo_orientation(path: &Path) -> u8 {
    let mut orientation = 1;
    if let Some(orient) = super::get_exif_orientation(path) {
        orientation = orient;
    }
    if let Some(xmp_orient) = get_xmp_orientation(path) {
        orientation = xmp_orient;
    }
    orientation
}
