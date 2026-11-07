use std::path::Path;
use std::fs;
use regex::Regex;
use crate::models::Face;
use super::xmp::{extract_xml_attr, extract_xml_tag};
use super::xmp_document::XmpDocument;

pub fn extract_faces(path: &Path) -> Vec<Face> {
    extract_faces_with_xmp(path, None)
}

pub fn extract_faces_with_xmp(path: &Path, _xmp_doc: Option<&XmpDocument>) -> Vec<Face> {
    let mut faces = Vec::new();
    let xmp_paths = crate::processing::storage::AssetStorage::find_sidecars(path);

    for xmp_path in xmp_paths {
        if let Ok(content) = fs::read_to_string(xmp_path) {
            faces = extract_faces_from_str(&content);
            if !faces.is_empty() {
                break;
            }
        }
    }
    faces
}

pub fn extract_faces_from_str(content: &str) -> Vec<Face> {
    let mut faces = Vec::new();

    // 1. mwg-rs:Regions (The Gold Standard)
    if let Some(pos) = content.find("<mwg-rs:RegionList>") {
        let end_pos = content[pos..].find("</mwg-rs:RegionList>").map(|p| p + pos).unwrap_or(content.len());
        let region_block = &content[pos..end_pos];
        
        let mut current = 0;
        while let Some(li_start) = region_block[current..].find("<rdf:li") {
            let li_abs_start = current + li_start;
            let li_end = region_block[li_abs_start..].find("</rdf:li>").map(|p| p + li_abs_start).unwrap_or(region_block.len());
            let li_content = &region_block[li_abs_start..li_end];

            // Extract Name
            let name = extract_xml_attr(li_content, "mwg-rs:Name")
                .or_else(|| extract_xml_tag(li_content, "mwg-rs:Name"));

            if let Some(name) = name {
                let mut face = Face {
                    name,
                    area_x: None,
                    area_y: None,
                    area_w: None,
                    area_h: None,
                };

                // Extract Area coords
                if let Some(area_pos) = li_content.find("<mwg-rs:Area") {
                    let area_end = li_content[area_pos..].find("/>").map(|p| p + area_pos).unwrap_or(li_content.len());
                    let area_tag = &li_content[area_pos..area_end];
                    
                    face.area_x = extract_xml_attr(area_tag, "stArea:x").and_then(|s| s.parse().ok());
                    face.area_y = extract_xml_attr(area_tag, "stArea:y").and_then(|s| s.parse().ok());
                    face.area_w = extract_xml_attr(area_tag, "stArea:w").and_then(|s| s.parse().ok());
                    face.area_h = extract_xml_attr(area_tag, "stArea:h").and_then(|s| s.parse().ok());
                }

                faces.push(face);
            }
            current = li_end;
        }
    }

    // 2. Fallback: HierarchicalSubject (e.g. lr:hierarchicalSubject)
    if faces.is_empty() {
        // Simple regex for "People|Name"
        let re = Regex::new(r"<rdf:li>People\|([^<]+)</rdf:li>").unwrap();
        for cap in re.captures_iter(content) {
            let name = cap[1].to_string();
            if !faces.iter().any(|f| f.name == name) {
                faces.push(Face {
                    name,
                    area_x: None,
                    area_y: None,
                    area_w: None,
                    area_h: None,
                });
            }
        }
    }

    // 3. Fallback: PersonInImage
    if faces.is_empty() {
        if let Some(pos) = content.find("<Iptc4xmpExt:PersonInImage>") {
            let end_pos = content[pos..].find("</Iptc4xmpExt:PersonInImage>").map(|p| p + pos).unwrap_or(content.len());
            let block = &content[pos..end_pos];
            let mut current = 0;
            while let Some(li_start) = block[current..].find("<rdf:li>") {
                let start = current + li_start + "<rdf:li>".len();
                if let Some(li_end) = block[start..].find("</rdf:li>") {
                    let name = block[start..start + li_end].trim().to_string();
                    if !name.is_empty() && !faces.iter().any(|f| f.name == name) {
                        faces.push(Face {
                            name,
                            area_x: None,
                            area_y: None,
                            area_w: None,
                            area_h: None,
                        });
                    }
                    current = start + li_end;
                } else { break; }
            }
        }
    }

    faces
}
