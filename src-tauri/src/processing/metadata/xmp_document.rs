use std::fs;
use std::path::{Path, PathBuf};
use chrono::NaiveDateTime;
use regex::Regex;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LocationMetadata {
    pub city: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
    pub location_name: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CropMetadata {
    pub top: Option<f64>,
    pub left: Option<f64>,
    pub bottom: Option<f64>,
    pub right: Option<f64>,
    pub angle: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct XmpDocument {
    raw_content: String,
    sidecar_path: Option<PathBuf>,
    raw_crop: CropMetadata,
    crop_orientation: u8,

    // Extracted Domain Properties (Cached in Memory)
    pub rating: u8,
    pub tags: Vec<String>,
    pub event: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub capture_time: Option<NaiveDateTime>,
    pub orientation: Option<u8>,
    pub exposure: Option<f32>,
    pub portrait_blur: Option<f64>,
    pub crop: CropMetadata,
    pub location: LocationMetadata,
    pub preserved_filename: Option<String>,
}

impl XmpDocument {
    /// Load and parse the associated XMP sidecar for a given media file path.
    /// Returns None if no sidecar exists on disk or if parsing fails.
    pub fn load_for_media(media_path: &Path) -> Option<Self> {
        Self::load_for_media_with_dimensions(media_path, None, None, None)
    }

    /// Load and parse with known image dimensions and orientation fallback for Mylio crop aspect calculations.
    pub fn load_for_media_with_dimensions(
        media_path: &Path,
        img_width: Option<u32>,
        img_height: Option<u32>,
        orientation_override: Option<u8>,
    ) -> Option<Self> {
        let xmp_paths = crate::processing::storage::AssetStorage::find_sidecars(media_path);
        for xmp_path in xmp_paths {
            if let Ok(content) = fs::read_to_string(&xmp_path) {
                if let Ok(mut doc) = Self::from_str_with_dimensions(
                    &content,
                    img_width,
                    img_height,
                    orientation_override,
                ) {
                    doc.sidecar_path = Some(xmp_path);
                    return Some(doc);
                }
            }
        }
        None
    }

    /// Parse an XMP document from an in-memory XML string.
    pub fn from_str(xml: &str) -> anyhow::Result<Self> {
        Self::from_str_with_dimensions(xml, None, None, None)
    }

    /// Parse an XMP document from an in-memory XML string with optional dimensions and orientation hints.
    pub fn from_str_with_dimensions(
        xml: &str,
        img_width: Option<u32>,
        img_height: Option<u32>,
        orientation_override: Option<u8>,
    ) -> anyhow::Result<Self> {
        let mut rating = 0;
        let mut tags = Vec::new();
        let mut event = None;
        let mut capture_time = None;
        let mut orientation = None;
        let mut exposure = None;
        let mut portrait_blur = None;
        let mut raw_crop = CropMetadata::default();
        let mut location = LocationMetadata::default();

        // 1. Rating (xmp:Rating)
        if let Some(r_str) = extract_attr_or_tag(xml, "xmp:Rating") {
            if let Ok(r) = r_str.trim().parse::<u8>() {
                rating = r.min(5);
            }
        }

        // 2. Tags (dc:subject)
        if let Some(subject_block) = extract_tag_block(xml, "dc:subject") {
            let mut current = 0;
            while let Some(li_start) = subject_block[current..].find("<rdf:li") {
                let abs_start = current + li_start;
                if let Some(tag_end) = subject_block[abs_start..].find('>') {
                    let content_start = abs_start + tag_end + 1;
                    if let Some(li_end) = subject_block[content_start..].find("</rdf:li>") {
                        let tag_text = unescape_xml(subject_block[content_start..content_start + li_end].trim());
                        if !tag_text.is_empty() && !tags.contains(&tag_text) {
                            tags.push(tag_text);
                        }
                        current = content_start + li_end + "</rdf:li>".len();
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
        }

        // 3. Event (Iptc4xmpExt:Event)
        if let Some(ev) = extract_attr_or_tag(xml, "Iptc4xmpExt:Event") {
            let trimmed = unescape_xml(ev.trim());
            if !trimmed.is_empty() {
                event = Some(trimmed);
            }
        }

        // 4. Orientation (tiff:Orientation)
        if let Some(orient_str) = extract_attr_or_tag(xml, "tiff:Orientation") {
            if let Ok(o) = orient_str.trim().parse::<u8>() {
                orientation = Some(o);
            }
        }

        // 5. Exposure (crs:Exposure2012)
        if let Some(exp_str) = extract_attr_or_tag(xml, "crs:Exposure2012") {
            if let Ok(exp) = exp_str.trim().parse::<f32>() {
                exposure = Some(exp);
            }
        }

        // 5b. Portrait Blur (crs:PortraitBlur)
        if let Some(blur_str) = extract_attr_or_tag(xml, "crs:PortraitBlur") {
            if let Ok(blur) = blur_str.trim().parse::<f64>() {
                portrait_blur = Some(blur);
            }
        }

        // 6. Capture Time (xmp:CreateDate, photoshop:DateCreated, exif:DateTimeOriginal)
        let date_candidates = [
            extract_attr_or_tag(xml, "xmp:CreateDate"),
            extract_attr_or_tag(xml, "photoshop:DateCreated"),
            extract_attr_or_tag(xml, "exif:DateTimeOriginal"),
        ];
        for candidate in date_candidates.into_iter().flatten() {
            if let Some(dt) = parse_xmp_date(&candidate) {
                capture_time = Some(dt);
                break;
            }
        }

        // 7. Title & Description
        // Title: dc:title (alt block or tag) -> photoshop:Headline -> Iptc4xmpCore:ObjectName
        let title = extract_alt_block(xml, "dc:title")
            .or_else(|| extract_tag_content(xml, "dc:title"))
            .or_else(|| extract_attr_or_tag(xml, "photoshop:Headline"))
            .or_else(|| extract_attr_or_tag(xml, "Iptc4xmpCore:ObjectName"))
            .map(|s| unescape_xml(s.trim()))
            .filter(|s| !s.is_empty());

        // Description: dc:description (alt block or tag) -> Iptc4xmpCore:Caption-Abstract
        let description = extract_alt_block(xml, "dc:description")
            .or_else(|| extract_tag_content(xml, "dc:description"))
            .or_else(|| extract_attr_or_tag(xml, "Iptc4xmpCore:Caption-Abstract"))
            .map(|s| unescape_xml(s.trim()))
            .filter(|s| !s.is_empty());

        // 8. Crop & Rotation
        // 8.1 Adobe Camera Raw (crs)
        let has_crs_crop = extract_attr_or_tag(xml, "crs:HasCrop")
            .map(|s| s.eq_ignore_ascii_case("true") || s == "1")
            .unwrap_or(false);

        if has_crs_crop {
            raw_crop.top = extract_attr_or_tag(xml, "crs:CropTop").and_then(|s| s.trim().parse().ok());
            raw_crop.left = extract_attr_or_tag(xml, "crs:CropLeft").and_then(|s| s.trim().parse().ok());
            raw_crop.bottom = extract_attr_or_tag(xml, "crs:CropBottom").and_then(|s| s.trim().parse().ok());
            raw_crop.right = extract_attr_or_tag(xml, "crs:CropRight").and_then(|s| s.trim().parse().ok());
            raw_crop.angle = extract_attr_or_tag(xml, "crs:CropAngle").and_then(|s| s.trim().parse().ok());
        } else {
            raw_crop.angle = extract_attr_or_tag(xml, "crs:CropAngle").and_then(|s| s.trim().parse().ok());
        }

        // 8.2 Mylio Fallback
        if raw_crop.top.is_none() {
            let my_enabled = extract_attr_or_tag(xml, "MY:cropEnabled")
                .map(|s| s.eq_ignore_ascii_case("true") || s == "1")
                .unwrap_or(false);

            if my_enabled {
                let top: Option<f64> = extract_attr_or_tag(xml, "MY:cropTop").and_then(|s| s.trim().parse().ok());
                let left: Option<f64> = extract_attr_or_tag(xml, "MY:cropLeft").and_then(|s| s.trim().parse().ok());
                let height: Option<f64> = extract_attr_or_tag(xml, "MY:cropHeight").and_then(|s| s.trim().parse().ok());
                let width: Option<f64> = extract_attr_or_tag(xml, "MY:cropWidth").and_then(|s| s.trim().parse().ok());
                let aspect: Option<f64> = extract_attr_or_tag(xml, "MY:cropAspect").and_then(|s| s.trim().parse().ok());

                if let (Some(t), Some(l), Some(h)) = (top, left, height) {
                    raw_crop.top = Some(t);
                    raw_crop.left = Some(l);
                    raw_crop.bottom = Some(t + h);
                    if let Some(w) = width {
                        raw_crop.right = Some(l + w);
                    } else if let Some(a) = aspect {
                        if let (Some(img_w), Some(img_h)) = (img_width, img_height) {
                            if img_w > 0 && img_h > 0 {
                                let orient = orientation_override.or(orientation).unwrap_or(1);
                                let (w_raw, h_raw) = if (5..=8).contains(&orient) {
                                    (img_h as f64, img_w as f64)
                                } else {
                                    (img_w as f64, img_h as f64)
                                };
                                raw_crop.right = Some(l + (h * a * (h_raw / w_raw)));
                            } else {
                                raw_crop.right = Some(l + (h * a));
                            }
                        } else {
                            raw_crop.right = Some(l + (h * a));
                        }
                    }
                }
            }
        }

        // Determine effective orientation for crop normalization
        let effective_orientation = orientation_override.or(orientation).unwrap_or(1);

        // Normalize raw crop coordinates to oriented coordinates
        let oriented_crop = if let (Some(t), Some(l), Some(b), Some(r)) = (
            raw_crop.top,
            raw_crop.left,
            raw_crop.bottom,
            raw_crop.right,
        ) {
            let (ot, ol, ob, or) = raw_to_oriented_crop(t, l, b, r, effective_orientation);
            CropMetadata {
                top: Some(ot),
                left: Some(ol),
                bottom: Some(ob),
                right: Some(or),
                angle: raw_crop.angle,
            }
        } else {
            CropMetadata {
                top: None,
                left: None,
                bottom: None,
                right: None,
                angle: raw_crop.angle,
            }
        };

        // 9. Location Metadata
        // 9.1 Photoshop & IPTC Core (Flat tags)
        location.city = extract_attr_or_tag(xml, "photoshop:City")
            .or_else(|| extract_attr_or_tag(xml, "Iptc4xmpCore:City"))
            .map(|s| unescape_xml(s.trim()))
            .filter(|s| !s.is_empty());

        location.state = extract_attr_or_tag(xml, "photoshop:State")
            .or_else(|| extract_attr_or_tag(xml, "Iptc4xmpCore:Province-State"))
            .map(|s| unescape_xml(s.trim()))
            .filter(|s| !s.is_empty());

        location.country = extract_attr_or_tag(xml, "photoshop:Country")
            .or_else(|| extract_attr_or_tag(xml, "Iptc4xmpCore:Country"))
            .map(|s| unescape_xml(s.trim()))
            .filter(|s| !s.is_empty());

        // 9.2 IPTC Extension (LocationShown / LocationCreated)
        let location_blocks = [
            extract_tag_block(xml, "Iptc4xmpExt:LocationShown"),
            extract_tag_block(xml, "Iptc4xmpExt:LocationCreated"),
        ];
        for block in location_blocks.into_iter().flatten() {
            if location.city.is_none() {
                location.city = extract_attr_or_tag(&block, "Iptc4xmpExt:City")
                    .map(|s| unescape_xml(s.trim()))
                    .filter(|s| !s.is_empty());
            }
            if location.state.is_none() {
                location.state = extract_attr_or_tag(&block, "Iptc4xmpExt:ProvinceState")
                    .map(|s| unescape_xml(s.trim()))
                    .filter(|s| !s.is_empty());
            }
            if location.country.is_none() {
                location.country = extract_attr_or_tag(&block, "Iptc4xmpExt:CountryName")
                    .map(|s| unescape_xml(s.trim()))
                    .filter(|s| !s.is_empty());
            }
        }

        // 9.3 Location Name
        let mut loc_name = extract_alt_block(xml, "Iptc4xmpExt:LocationName")
            .or_else(|| extract_tag_content(xml, "Iptc4xmpExt:LocationName"))
            .or_else(|| extract_attr_or_tag(xml, "photoshop:Location"))
            .map(|s| unescape_xml(s.trim()))
            .filter(|s| !s.is_empty());

        if let Some(name) = loc_name {
            let first_part = name.split(',').next().unwrap_or("").trim().to_string();
            loc_name = if first_part.is_empty() { None } else { Some(first_part) };
        }
        location.location_name = loc_name;

        // 10. Preserved File Name (xmpMM:PreservedFileName)
        let preserved_filename = extract_attr_or_tag(xml, "xmpMM:PreservedFileName")
            .map(|s| unescape_xml(s.trim()))
            .filter(|s| !s.is_empty());

        Ok(Self {
            raw_content: xml.to_string(),
            sidecar_path: None,
            raw_crop,
            crop_orientation: effective_orientation,
            rating,
            tags,
            event,
            title,
            description,
            capture_time,
            orientation,
            exposure,
            portrait_blur,
            crop: oriented_crop,
            location,
            preserved_filename,
        })
    }

    /// Create a new blank standard XMP document template.
    pub fn new_empty() -> Self {
        let template = r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="damright-prototype">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-11/">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#;

        Self {
            raw_content: template.to_string(),
            sidecar_path: None,
            raw_crop: CropMetadata::default(),
            crop_orientation: 1,
            rating: 0,
            tags: Vec::new(),
            event: None,
            title: None,
            description: None,
            capture_time: None,
            orientation: None,
            exposure: None,
            portrait_blur: None,
            crop: CropMetadata::default(),
            location: LocationMetadata::default(),
            preserved_filename: None,
        }
    }

    // Mutators

    pub fn set_rating(&mut self, rating: u8) {
        self.rating = rating.min(5);
    }

    pub fn set_tags(&mut self, tags: &[String]) {
        self.tags = tags.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    }

    pub fn set_event(&mut self, event: Option<String>) {
        self.event = event.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    }

    pub fn set_title(&mut self, title: Option<String>) {
        self.title = title.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    }

    pub fn set_description(&mut self, description: Option<String>) {
        self.description = description.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    }

    pub fn set_exposure(&mut self, exposure: Option<f32>) {
        self.exposure = exposure;
    }

    pub fn set_portrait_blur(&mut self, blur: Option<f64>) {
        self.portrait_blur = blur;
    }

    pub fn set_crop(&mut self, crop: CropMetadata, photo_orientation: u8) {
        self.crop_orientation = photo_orientation;
        self.crop = crop.clone();

        if let (Some(t), Some(l), Some(b), Some(r)) = (crop.top, crop.left, crop.bottom, crop.right) {
            let (rt, rl, rb, rr) = oriented_to_raw_crop(t, l, b, r, photo_orientation);
            self.raw_crop = CropMetadata {
                top: Some(rt),
                left: Some(rl),
                bottom: Some(rb),
                right: Some(rr),
                angle: crop.angle,
            };
        } else {
            self.raw_crop = CropMetadata {
                top: None,
                left: None,
                bottom: None,
                right: None,
                angle: crop.angle,
            };
        }
    }

    pub fn set_capture_time(&mut self, dt: NaiveDateTime) {
        self.capture_time = Some(dt);
    }

    pub fn set_preserved_filename(&mut self, filename: &str) {
        let trimmed = filename.trim();
        self.preserved_filename = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
    }

    /// Serialize the document to valid, well-formed XMP XML preserving existing custom namespaces.
    pub fn to_xml(&self) -> String {
        let mut content = self.raw_content.clone();

        // 1. Rating (xmp:Rating)
        if self.rating > 0 {
            update_or_set_attribute(&mut content, "xmp", "Rating", &self.rating.to_string());
            remove_element(&mut content, "xmp:Rating");
        } else {
            remove_attribute(&mut content, "xmp", "Rating");
            remove_element(&mut content, "xmp:Rating");
        }

        // 2. Exposure (crs:Exposure2012)
        if let Some(exp) = self.exposure {
            if exp != 0.0 {
                update_or_set_attribute(&mut content, "crs", "Exposure2012", &format!("{:.2}", exp));
                remove_element(&mut content, "crs:Exposure2012");
            } else {
                remove_attribute(&mut content, "crs", "Exposure2012");
                remove_element(&mut content, "crs:Exposure2012");
            }
        } else {
            remove_attribute(&mut content, "crs", "Exposure2012");
            remove_element(&mut content, "crs:Exposure2012");
        }

        // 2b. PortraitBlur (crs:PortraitBlur)
        if let Some(blur) = self.portrait_blur {
            if blur > 0.0 {
                update_or_set_attribute(&mut content, "crs", "PortraitBlur", &format!("{:.2}", blur));
                remove_element(&mut content, "crs:PortraitBlur");
            } else {
                remove_attribute(&mut content, "crs", "PortraitBlur");
                remove_element(&mut content, "crs:PortraitBlur");
            }
        } else {
            remove_attribute(&mut content, "crs", "PortraitBlur");
            remove_element(&mut content, "crs:PortraitBlur");
        }

        // 3. Capture Date
        if let Some(ref dt) = self.capture_time {
            let iso_dt = dt.format("%Y-%m-%dT%H:%M:%S").to_string();
            update_or_set_attribute(&mut content, "xmp", "CreateDate", &iso_dt);
            update_or_set_attribute(&mut content, "photoshop", "DateCreated", &iso_dt);
            remove_element(&mut content, "xmp:CreateDate");
            remove_element(&mut content, "photoshop:DateCreated");
        }

        // 4. Event
        if let Some(ref ev) = self.event {
            update_or_set_attribute(&mut content, "Iptc4xmpExt", "Event", &escape_xml(ev));
            remove_element(&mut content, "Iptc4xmpExt:Event");
        } else {
            remove_attribute(&mut content, "Iptc4xmpExt", "Event");
            remove_element(&mut content, "Iptc4xmpExt:Event");
        }

        // 5. Crop & Rotation
        if let (Some(rt), Some(rl), Some(rb), Some(rr)) = (
            self.raw_crop.top,
            self.raw_crop.left,
            self.raw_crop.bottom,
            self.raw_crop.right,
        ) {
            update_or_set_attribute(&mut content, "crs", "HasCrop", "True");
            update_or_set_attribute(&mut content, "crs", "CropTop", &format!("{:.6}", rt));
            update_or_set_attribute(&mut content, "crs", "CropLeft", &format!("{:.6}", rl));
            update_or_set_attribute(&mut content, "crs", "CropBottom", &format!("{:.6}", rb));
            update_or_set_attribute(&mut content, "crs", "CropRight", &format!("{:.6}", rr));
        } else {
            remove_attribute(&mut content, "crs", "HasCrop");
            remove_attribute(&mut content, "crs", "CropTop");
            remove_attribute(&mut content, "crs", "CropLeft");
            remove_attribute(&mut content, "crs", "CropBottom");
            remove_attribute(&mut content, "crs", "CropRight");
            remove_element(&mut content, "crs:HasCrop");
            remove_element(&mut content, "crs:CropTop");
            remove_element(&mut content, "crs:CropLeft");
            remove_element(&mut content, "crs:CropBottom");
            remove_element(&mut content, "crs:CropRight");
        }

        if let Some(angle) = self.raw_crop.angle {
            update_or_set_attribute(&mut content, "crs", "CropAngle", &format!("{:.6}", angle));
        } else {
            remove_attribute(&mut content, "crs", "CropAngle");
            remove_element(&mut content, "crs:CropAngle");
        }

        // 6. Tags (dc:subject)
        let subject_re = Regex::new(r"(?s)\s*<dc:subject>.*?</dc:subject>").unwrap();
        if !self.tags.is_empty() {
            let mut tags_xml = String::from("<dc:subject>\n    <rdf:Bag>\n");
            for tag in &self.tags {
                tags_xml.push_str(&format!("     <rdf:li>{}</rdf:li>\n", escape_xml(tag)));
            }
            tags_xml.push_str("    </rdf:Bag>\n   </dc:subject>");

            if subject_re.is_match(&content) {
                content = subject_re.replace(&content, &format!("\n   {}", tags_xml)).to_string();
            } else {
                insert_child_into_rdf_description(&mut content, &tags_xml);
            }
        } else {
            content = subject_re.replace(&content, "").to_string();
        }

        // 7. Title (dc:title)
        update_alt_block(&mut content, "dc:title", self.title.as_deref());

        // 8. Description (dc:description)
        update_alt_block(&mut content, "dc:description", self.description.as_deref());

        // 9. Preserved File Name
        if let Some(ref pfn) = self.preserved_filename {
            ensure_namespace_declared(&mut content, "xmpMM", "http://ns.adobe.com/xap/1.0/mm/");
            update_or_set_attribute(&mut content, "xmpMM", "PreservedFileName", &escape_xml(pfn));
            remove_element(&mut content, "xmpMM:PreservedFileName");
        }

        content
    }

    /// Save the document to disk (atomically overwriting the sidecar).
    pub fn save_to_file(&self, path: &Path) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let xml = self.to_xml();

        // Write atomically via a temp file in the same directory
        let temp_path = path.with_extension(format!("xmp.tmp-{}", uuid::Uuid::new_v4()));
        fs::write(&temp_path, &xml)?;

        if let Err(e) = fs::rename(&temp_path, path) {
            // Fallback for cross-filesystem / locking quirks
            let _ = fs::write(path, xml);
            let _ = fs::remove_file(&temp_path);
            if !path.exists() {
                return Err(anyhow::anyhow!("Failed to save XMP file to {}: {}", path.display(), e));
            }
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// XML Parsing & Modification Utilities
// ---------------------------------------------------------------------------

pub fn raw_to_oriented_crop(
    top: f64,
    left: f64,
    bottom: f64,
    right: f64,
    orientation: u8,
) -> (f64, f64, f64, f64) {
    match orientation {
        2 => (top, 1.0 - right, bottom, 1.0 - left),
        3 => (1.0 - bottom, 1.0 - right, 1.0 - top, 1.0 - left),
        4 => (1.0 - bottom, left, 1.0 - top, right),
        5 => (left, top, right, bottom),
        6 => (left, 1.0 - bottom, right, 1.0 - top),
        7 => (1.0 - right, 1.0 - bottom, 1.0 - left, 1.0 - top),
        8 => (1.0 - right, top, 1.0 - left, bottom),
        _ => (top, left, bottom, right),
    }
}

pub fn oriented_to_raw_crop(
    top: f64,
    left: f64,
    bottom: f64,
    right: f64,
    orientation: u8,
) -> (f64, f64, f64, f64) {
    match orientation {
        2 => (top, 1.0 - right, bottom, 1.0 - left),
        3 => (1.0 - bottom, 1.0 - right, 1.0 - top, 1.0 - left),
        4 => (1.0 - bottom, left, 1.0 - top, right),
        5 => (left, top, right, bottom),
        6 => (1.0 - right, top, 1.0 - left, bottom),
        7 => (1.0 - right, 1.0 - bottom, 1.0 - left, 1.0 - top),
        8 => (left, 1.0 - bottom, right, 1.0 - top),
        _ => (top, left, bottom, right),
    }
}

pub fn parse_xmp_date(date_str: &str) -> Option<NaiveDateTime> {
    let date_str = date_str.trim();
    if date_str.is_empty() {
        return None;
    }

    // 1. Try RFC 3339 / ISO 8601 with timezone first
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(date_str) {
        return Some(dt.naive_local());
    }

    // 2. Custom datetime formats with timezones
    let formats_with_tz = [
        "%Y-%m-%dT%H:%M:%S%.f%z",
        "%Y-%m-%dT%H:%M:%S%.f%Z",
        "%Y-%m-%d %H:%M:%S%.f%z",
        "%Y-%m-%d %H:%M:%S%.f%Z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S%Z",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S%Z",
    ];
    for fmt in &formats_with_tz {
        if let Ok(dt) = chrono::DateTime::parse_from_str(date_str, fmt) {
            return Some(dt.naive_local());
        }
    }

    // 3. Naive datetime formats without timezone
    let naive_formats = [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
        "%Y:%m:%d %H:%M:%S%.f",
        "%Y:%m:%d %H:%M:%S",
    ];
    for fmt in &naive_formats {
        if let Ok(dt) = NaiveDateTime::parse_from_str(date_str, fmt) {
            return Some(dt);
        }
    }

    // 4. Date only (default to 00:00:00)
    let date_formats = [
        "%Y-%m-%d",
        "%Y:%m:%d",
    ];
    for fmt in &date_formats {
        if let Ok(d) = chrono::NaiveDate::parse_from_str(date_str, fmt) {
            return d.and_hms_opt(0, 0, 0);
        }
    }

    None
}

fn extract_attr_or_tag(xml: &str, name_with_prefix: &str) -> Option<String> {
    extract_xml_attr(xml, name_with_prefix)
        .or_else(|| extract_xml_tag(xml, name_with_prefix))
}

pub fn extract_xml_attr(content: &str, attr: &str) -> Option<String> {
    let mut search_from = 0;
    while let Some(rel_pos) = content[search_from..].find(attr) {
        let pos = search_from + rel_pos;
        let before_ok = pos == 0 || {
            let prev = content[..pos].chars().next_back().unwrap();
            prev.is_whitespace() || prev == '<' || prev == '/'
        };

        if before_ok {
            let after_attr = &content[pos + attr.len()..];
            let trimmed = after_attr.trim_start();
            if let Some(rest) = trimmed.strip_prefix('=') {
                let rest_trimmed = rest.trim_start();
                if let Some(quote) = rest_trimmed.chars().next() {
                    if quote == '"' || quote == '\'' {
                        let val_start = quote.len_utf8();
                        if let Some(end_quote) = rest_trimmed[val_start..].find(quote) {
                            let raw_val = &rest_trimmed[val_start..val_start + end_quote];
                            return Some(raw_val.to_string());
                        }
                    }
                }
            }
        }
        search_from = pos + attr.len();
    }
    None
}

pub fn extract_xml_tag(content: &str, tag: &str) -> Option<String> {
    let open_pat = format!("<{}", tag);
    let close_pat = format!("</{}>", tag);
    let mut search_from = 0;
    while let Some(rel_pos) = content[search_from..].find(&open_pat) {
        let pos = search_from + rel_pos;
        let after_tag = &content[pos + open_pat.len()..];
        if let Some(first_char) = after_tag.chars().next() {
            if first_char.is_whitespace() || first_char == '>' || first_char == '/' {
                if let Some(tag_end) = after_tag.find('>') {
                    let body_start = pos + open_pat.len() + tag_end + 1;
                    if let Some(body_end) = content[body_start..].find(&close_pat) {
                        let body = &content[body_start..body_start + body_end];
                        return Some(body.trim().to_string());
                    }
                }
            }
        }
        search_from = pos + open_pat.len();
    }
    None
}

fn extract_tag_block(content: &str, tag: &str) -> Option<String> {
    let open_pat = format!("<{}", tag);
    let close_pat = format!("</{}>", tag);
    let pos = content.find(&open_pat)?;
    let end_pos = content[pos..].find(&close_pat).map(|p| p + pos + close_pat.len())?;
    Some(content[pos..end_pos].to_string())
}

fn extract_tag_content(content: &str, tag: &str) -> Option<String> {
    extract_xml_tag(content, tag)
}

fn extract_alt_block(content: &str, tag: &str) -> Option<String> {
    let block = extract_tag_block(content, tag)?;
    if let Some(li_start) = block.find("<rdf:li") {
        if let Some(tag_end) = block[li_start..].find('>') {
            let content_start = li_start + tag_end + 1;
            if let Some(li_end) = block[content_start..].find("</rdf:li>") {
                return Some(block[content_start..content_start + li_end].trim().to_string());
            }
        }
    }
    None
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn unescape_xml(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn ensure_namespace_declared(content: &mut String, prefix: &str, uri: &str) {
    let ns_decl = format!("xmlns:{}=", prefix);
    if !content.contains(&ns_decl) {
        if let Some(pos) = content.find("<rdf:Description") {
            if let Some(_) = content[pos..].find('>') {
                let insert_idx = pos + "<rdf:Description".len();
                let addition = format!("\n    xmlns:{}=\"{}\"", prefix, uri);
                content.insert_str(insert_idx, &addition);
            }
        }
    }
}

fn update_or_set_attribute(content: &mut String, prefix: &str, name: &str, value: &str) {
    let standard_uri = match prefix {
        "crs" => "http://ns.adobe.com/camera-raw-settings/1.0/",
        "xmp" => "http://ns.adobe.com/xap/1.0/",
        "xmpMM" => "http://ns.adobe.com/xap/1.0/mm/",
        "photoshop" => "http://ns.adobe.com/photoshop/1.0/",
        "dc" => "http://purl.org/dc/elements/1.1/",
        "Iptc4xmpExt" => "http://iptc.org/std/Iptc4xmpExt/2008-02-11/",
        "tiff" => "http://ns.adobe.com/tiff/1.0/",
        _ => "",
    };
    if !standard_uri.is_empty() {
        ensure_namespace_declared(content, prefix, standard_uri);
    }

    let pattern = format!(r#"(?i)({}:)?{}=["'][^"']*["']"#, regex::escape(prefix), regex::escape(name));
    let re = Regex::new(&pattern).unwrap();
    let replacement = format!("{}:{}=\"{}\"", prefix, name, value);

    if re.is_match(content) {
        *content = re.replace(content, replacement.as_str()).to_string();
    } else {
        // Insert attribute into the first <rdf:Description ...>
        let desc_re = Regex::new(r"<rdf:Description(\s+[^>]*)?(?:\s*/>|>)").unwrap();
        if let Some(mat) = desc_re.find(content) {
            let matched_str = mat.as_str();
            let is_self_closing = matched_str.ends_with("/>");
            if is_self_closing {
                let prefix_len = mat.start() + matched_str.len() - 2;
                content.insert_str(prefix_len, &format!(" {}:{}=\"{}\"", prefix, name, value));
            } else {
                let prefix_len = mat.start() + matched_str.len() - 1;
                content.insert_str(prefix_len, &format!(" {}:{}=\"{}\"", prefix, name, value));
            }
        }
    }
}

fn remove_attribute(content: &mut String, prefix: &str, name: &str) {
    let pattern = format!(r#"(?i)\s+({}:)?{}=["'][^"']*["']"#, regex::escape(prefix), regex::escape(name));
    let re = Regex::new(&pattern).unwrap();
    *content = re.replace(content, "").to_string();
}

fn remove_element(content: &mut String, tag: &str) {
    let pattern = format!(r#"(?is)\s*<{}(?:\s+[^>]*)?>.*?</{}>"#, regex::escape(tag), regex::escape(tag));
    if let Ok(re) = Regex::new(&pattern) {
        *content = re.replace(content, "").to_string();
    }
}

fn update_alt_block(content: &mut String, tag: &str, value: Option<&str>) {
    let tag_re = Regex::new(&format!(r"(?s)\s*<{}>.*?</{}>", regex::escape(tag), regex::escape(tag))).unwrap();
    match value {
        Some(val) if !val.trim().is_empty() => {
            let escaped_value = escape_xml(val.trim());
            let tag_xml = format!(
                "<{}>\n    <rdf:Alt>\n     <rdf:li xml:lang=\"x-default\">{}</rdf:li>\n    </rdf:Alt>\n   </{}>",
                tag, escaped_value, tag
            );
            if tag_re.is_match(content) {
                *content = tag_re.replace(content, &format!("\n   {}", tag_xml)).to_string();
            } else {
                insert_child_into_rdf_description(content, &tag_xml);
            }
        }
        _ => {
            *content = tag_re.replace(content, "").to_string();
        }
    }
}

fn insert_child_into_rdf_description(content: &mut String, child_xml: &str) {
    // If self-closing <rdf:Description ... />, convert to opening and closing tags
    let self_closing_re = Regex::new(r"(<rdf:Description\s+[^>]*?)\s*/>").unwrap();
    if let Some(caps) = self_closing_re.captures(content) {
        let open_tag = caps.get(1).unwrap().as_str();
        let replacement = format!("{}>\n    {}\n  </rdf:Description>", open_tag, child_xml);
        *content = self_closing_re.replace(content, replacement.as_str()).to_string();
        return;
    }

    // Otherwise insert right after <rdf:Description ...>
    let desc_re = Regex::new(r"<rdf:Description[^>]*>").unwrap();
    if let Some(mat) = desc_re.find(content) {
        content.insert_str(mat.end(), &format!("\n   {}", child_xml));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_adobe_camera_raw_roundtrip() {
        let original_xml = r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:customVendor="http://vendor.com/custom/1.0/"
    customVendor:CameraProfile="PortraitV2"
    crs:HasCrop="True"
    crs:CropTop="0.100000"
    crs:CropLeft="0.150000"
    crs:CropBottom="0.900000"
    crs:CropRight="0.850000"
    crs:CropAngle="2.500000"
    crs:Exposure2012="+0.35"
    xmp:Rating="2">
   <dc:subject>
    <rdf:Bag>
     <rdf:li>initial-tag</rdf:li>
    </rdf:Bag>
   </dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#;

        let mut doc = XmpDocument::from_str(original_xml).unwrap();
        assert_eq!(doc.rating, 2);
        assert_eq!(doc.tags, vec!["initial-tag".to_string()]);
        assert_eq!(doc.exposure, Some(0.35));
        assert_eq!(doc.crop.top, Some(0.1));
        assert_eq!(doc.crop.left, Some(0.15));
        assert_eq!(doc.crop.bottom, Some(0.9));
        assert_eq!(doc.crop.right, Some(0.85));
        assert_eq!(doc.crop.angle, Some(2.5));

        // Mutate rating and tags
        doc.set_rating(5);
        doc.set_tags(&["new-tag1".to_string(), "new-tag2".to_string()]);

        let updated_xml = doc.to_xml();

        // Verify custom vendor attribute remains untouched
        assert!(updated_xml.contains("customVendor:CameraProfile=\"PortraitV2\""));
        // Verify crop and exposure preserved
        assert!(updated_xml.contains("crs:CropTop=\"0.100000\""));
        assert!(updated_xml.contains("crs:Exposure2012=\"0.35\"") || updated_xml.contains("crs:Exposure2012=\"+0.35\""));
        // Verify updated rating and tags
        assert!(updated_xml.contains("xmp:Rating=\"5\""));
        assert!(updated_xml.contains("<rdf:li>new-tag1</rdf:li>"));
        assert!(updated_xml.contains("<rdf:li>new-tag2</rdf:li>"));
        assert!(!updated_xml.contains("<rdf:li>initial-tag</rdf:li>"));
    }

    #[test]
    fn test_mylio_crop_extraction() {
        let mylio_xml = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" 
                    xmlns:MY="http://ns.mylio.com/xmp/1.0/"
                    MY:cropTop="0.012038"
                    MY:cropLeft="0.209036"
                    MY:cropHeight="0.979937"
                    MY:cropAspect="1.0"
                    MY:cropEnabled="true" />
            </rdf:RDF>
        </x:xmpmeta>
        "#;

        let doc = XmpDocument::from_str_with_dimensions(mylio_xml, Some(4284), Some(5712), Some(6)).unwrap();
        let crop = doc.crop;

        let ct_val = crop.top.unwrap();
        let cl_val = crop.left.unwrap();
        let cb_val = crop.bottom.unwrap();
        let cr_val = crop.right.unwrap();

        assert!((ct_val - 0.209036).abs() < 1e-6);
        assert!((cl_val - 0.008025).abs() < 1e-6);
        assert!((cb_val - 0.94398875).abs() < 1e-6);
        assert!((cr_val - 0.987962).abs() < 1e-6);
    }

    #[test]
    fn test_iptc_location_extension_extraction() {
        let xml = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" 
                    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-11/">
                    <Iptc4xmpExt:LocationShown>
                        <rdf:Bag>
                            <rdf:li>
                                <rdf:Description
                                    Iptc4xmpExt:City="Edinburgh"
                                    Iptc4xmpExt:ProvinceState="Scotland"
                                    Iptc4xmpExt:CountryName="United Kingdom" />
                            </rdf:li>
                        </rdf:Bag>
                    </Iptc4xmpExt:LocationShown>
                    <Iptc4xmpExt:LocationName>
                        <rdf:Alt>
                            <rdf:li xml:lang="x-default">Edinburgh Castle, Castlehill, Edinburgh</rdf:li>
                        </rdf:Alt>
                    </Iptc4xmpExt:LocationName>
                </rdf:Description>
            </rdf:RDF>
        </x:xmpmeta>
        "#;

        let doc = XmpDocument::from_str(xml).unwrap();
        assert_eq!(doc.location.city, Some("Edinburgh".to_string()));
        assert_eq!(doc.location.state, Some("Scotland".to_string()));
        assert_eq!(doc.location.country, Some("United Kingdom".to_string()));
        assert_eq!(doc.location.location_name, Some("Edinburgh Castle".to_string()));
    }

    #[test]
    fn test_single_pass_performance() {
        let sample_xml = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about=""
                    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
                    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
                    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
                    xmlns:dc="http://purl.org/dc/elements/1.1/"
                    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-11/"
                    xmp:Rating="4"
                    crs:HasCrop="True"
                    crs:CropTop="0.05"
                    crs:CropLeft="0.10"
                    crs:CropBottom="0.95"
                    crs:CropRight="0.90"
                    crs:CropAngle="0.0"
                    crs:Exposure2012="0.75"
                    xmp:CreateDate="2024-05-12T14:30:00"
                    Iptc4xmpExt:Event="Graduation">
                    <dc:subject>
                        <rdf:Bag>
                            <rdf:li>family</rdf:li>
                            <rdf:li>celebration</rdf:li>
                        </rdf:Bag>
                    </dc:subject>
                    <dc:title>
                        <rdf:Alt>
                            <rdf:li xml:lang="x-default">Graduation Day</rdf:li>
                        </rdf:Alt>
                    </dc:title>
                    <dc:description>
                        <rdf:Alt>
                            <rdf:li xml:lang="x-default">Celebration with family.</rdf:li>
                        </rdf:Alt>
                    </dc:description>
                </rdf:Description>
            </rdf:RDF>
        </x:xmpmeta>
        "#;

        let start = std::time::Instant::now();
        for _ in 0..500 {
            let doc = XmpDocument::from_str(sample_xml).unwrap();
            assert_eq!(doc.rating, 4);
            assert_eq!(doc.tags.len(), 2);
            assert_eq!(doc.event, Some("Graduation".to_string()));
            assert_eq!(doc.title, Some("Graduation Day".to_string()));
        }
        let elapsed = start.elapsed();
        println!("500 parses took {:?}", elapsed);
        assert!(elapsed.as_millis() < 500, "500 parses took {}ms, expected <500ms", elapsed.as_millis());
    }
}
