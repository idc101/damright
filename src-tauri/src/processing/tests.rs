use super::*;
use tempfile::tempdir;
use crate::db::{photo_repo, init_db};
use crate::models::{Photo, Source};
use crate::processing::xmp::{write_xmp, get_capture_time_xmp};
use std::fs;
use std::path::Path;

#[test]
fn test_init_db() {
    let dir = tempdir().unwrap();
    let conn = init_db(dir.path()).unwrap();
    
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='photos'").unwrap();
    let exists: bool = stmt.exists([]).unwrap();
    assert!(exists);
}

#[test]
fn test_get_xmp_orientation() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("test.jpg");
    let xmp_path = dir.path().join("test.jpg.xmp");
    
    let xmp_content = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Orientation="6" />
            </rdf:RDF>
        </x:xmpmeta>
    "#;
    fs::write(xmp_path, xmp_content).unwrap();
    
    assert_eq!(get_xmp_orientation(&photo_path), Some(6));
}

#[test]
fn test_get_xmp_metadata() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("test.jpg");
    let xmp_path = dir.path().join("test.jpg.xmp");
    
    let xmp_content = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" 
                    xmlns:xmp="http://ns.adobe.com/xap/1.0/" 
                    xmlns:dc="http://purl.org/dc/elements/1.1/"
                    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-11/"
                    xmp:Rating="3"
                    Iptc4xmpExt:Event="Summer Party">
                    <dc:subject>
                        <rdf:Bag>
                            <rdf:li>vacation</rdf:li>
                            <rdf:li>beach</rdf:li>
                        </rdf:Bag>
                    </dc:subject>
                </rdf:Description>
            </rdf:RDF>
        </x:xmpmeta>
    "#;
    fs::write(xmp_path, xmp_content).unwrap();
    
    let (rating, tags, event) = get_xmp_metadata(&photo_path);
    assert_eq!(rating, 3);
    assert!(tags.contains("vacation"));
    assert!(tags.contains("beach"));
    assert_eq!(event, Some("Summer Party".to_string()));
}

#[test]
fn test_extract_crop_adobe() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("test.jpg");
    let xmp_path = dir.path().join("test.jpg.xmp");
    
    let xmp_content = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" 
                    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
                    crs:HasCrop="True"
                    crs:CropTop="0.1"
                    crs:CropLeft="0.1"
                    crs:CropBottom="0.9"
                    crs:CropRight="0.9"
                    crs:CropAngle="5.0" />
            </rdf:RDF>
        </x:xmpmeta>
    "#;
    fs::write(xmp_path, xmp_content).unwrap();
    
    let (ct, cl, cb, cr, ca) = extract_crop_rotation(&photo_path, None, None, None);
    assert_eq!(ct, Some(0.1));
    assert_eq!(cl, Some(0.1));
    assert_eq!(cb, Some(0.9));
    assert_eq!(cr, Some(0.9));
    assert_eq!(ca, Some(5.0));
}

#[test]
fn test_write_xmp_capture_date() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("test.jpg");
    // Ensure photo file exists (needed for write_xmp to find extension)
    fs::File::create(&photo_path).unwrap();

    let capture_time = "1980-06-15 12:00:00".to_string();
    
    write_xmp(
        photo_path.to_str().unwrap(),
        0.0,
        0,
        "",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(capture_time.clone()),
        None,
        None,
    ).unwrap();

    let xmp_path = dir.path().join("test.xmp");
    assert!(xmp_path.exists());
    let content = fs::read_to_string(xmp_path).unwrap();
    
    // Check if both tags are present
    assert!(content.contains("xmp:CreateDate=\"1980-06-15T12:00:00\""));
    assert!(content.contains("photoshop:DateCreated=\"1980-06-15T12:00:00\""));

    // Verify we can read it back
    let read_back = get_capture_time_xmp(&photo_path);
    assert!(read_back.is_some());
    assert_eq!(read_back.unwrap().format("%Y-%m-%d %H:%M:%S").to_string(), capture_time);
}

#[test]
fn test_parse_xmp_date() {
    use crate::processing::metadata::xmp::parse_xmp_date;
    use chrono::{NaiveDate, NaiveTime, NaiveDateTime};

    let expected = NaiveDateTime::new(
        NaiveDate::from_ymd_opt(2024, 6, 9).unwrap(),
        NaiveTime::from_hms_opt(19, 25, 23).unwrap(),
    );

    assert_eq!(parse_xmp_date("2024-06-09T19:25:23.000"), Some(expected));
    assert_eq!(parse_xmp_date("2024-06-09T19:25:23Z"), Some(expected));
    assert_eq!(parse_xmp_date("2024-06-09T19:25:23-04:00"), Some(expected));
    assert_eq!(parse_xmp_date("2024-06-09T19:25:23.000-04:00"), Some(expected));
    assert_eq!(parse_xmp_date("2024-06-09 19:25:23"), Some(expected));
    assert_eq!(parse_xmp_date("2024-06-09T19:25:23"), Some(expected));

    let expected_date_only = NaiveDateTime::new(
        NaiveDate::from_ymd_opt(2024, 6, 9).unwrap(),
        NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
    );
    assert_eq!(parse_xmp_date("2024-06-09"), Some(expected_date_only));
    assert_eq!(parse_xmp_date("2024:06:09"), Some(expected_date_only));

    assert_eq!(parse_xmp_date(""), None);
    assert_eq!(parse_xmp_date("invalid-date"), None);
}

#[test]
fn test_parse_iso6709() {
    use crate::processing::metadata::parse_iso6709;
    let s = "+22.5797+113.9380+028.396/";
    let (lat, lon) = parse_iso6709(s).unwrap();
    assert!((lat - 22.5797).abs() < 0.0001);
    assert!((lon - 113.9380).abs() < 0.0001);

    let s2 = "+37.3318-122.0312/";
    let (lat2, lon2) = parse_iso6709(s2).unwrap();
    assert!((lat2 - 37.3318).abs() < 0.0001);
    assert!((lon2 - (-122.0312)).abs() < 0.0001);
}

#[test]
fn test_video_metadata_extraction() {
    let path = Path::new("../test_assets/test.mp4");
    if !path.exists() {
        return; // Skip if file doesn't exist
    }

    let extended = crate::processing::metadata::get_extended_metadata(path);
    
    // We expect some basic info even for a simple video
    // test.mp4 might have dimensions or file size
    assert!(extended.file_size.is_some());
    println!("Video Metadata: width={:?}, height={:?}, make={:?}, model={:?}, capture={:?}", 
        extended.width, extended.height, extended.camera_make, extended.camera_model, extended.capture_time);
}

#[test]
fn test_extract_crop_mylio() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("test.jpg");
    let xmp_path = dir.path().join("test.jpg.xmp");
    
    let xmp_content = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" 
                    xmlns:MY="http://ns.mylio.com/xmp/1.0/"
                    MY:cropTop="0.01"
                    MY:cropLeft="0.06"
                    MY:cropHeight="0.85"
                    MY:cropAspect="1.5"
                    MY:cropEnabled="true" />
            </rdf:RDF>
        </x:xmpmeta>
    "#;
    fs::write(xmp_path, xmp_content).unwrap();
    
    let (ct, cl, cb, cr, ca) = extract_crop_rotation(&photo_path, None, None, None);
    assert_eq!(ct, Some(0.01));
    assert_eq!(cl, Some(0.06));
    assert_eq!(cb, Some(0.86)); // 0.01 + 0.85
    assert_eq!(cr, Some(0.06 + (0.85 * 1.5)));
    assert_eq!(ca, None);
}

#[test]
fn test_extract_crop_mylio_with_dimensions() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("test.jpg");
    let xmp_path = dir.path().join("test.jpg.xmp");
    
    let xmp_content = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" 
                    xmlns:MY="http://ns.mylio.com/xmp/1.0/"
                    MY:cropTop="0.0"
                    MY:cropLeft="0.084964"
                    MY:cropHeight="0.811981"
                    MY:cropAspect="1.332601"
                    MY:cropEnabled="true" />
            </rdf:RDF>
        </x:xmpmeta>
    "#;
    fs::write(xmp_path, xmp_content).unwrap();
    
    let (ct, cl, cb, cr, ca) = extract_crop_rotation(&photo_path, Some(4032), Some(3024), None);
    assert_eq!(ct, Some(0.0));
    assert_eq!(cl, Some(0.084964));
    assert_eq!(cb, Some(0.811981));
    
    let expected_right = 0.084964 + (0.811981 * 1.332601 * (3024.0 / 4032.0));
    let diff = (cr.unwrap() - expected_right).abs();
    assert!(diff < 1e-9, "Expected close to {}, got {}", expected_right, cr.unwrap());
    assert_eq!(ca, None);
}

#[test]
fn test_extract_crop_mylio_with_dimensions_and_orientation() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("test.jpg");
    let xmp_path = dir.path().join("test.jpg.xmp");
    
    let xmp_content = r#"
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
    fs::write(xmp_path, xmp_content).unwrap();
    
    let (ct, cl, cb, cr, ca) = extract_crop_rotation(&photo_path, Some(4284), Some(5712), Some(6));
    
    // Expect oriented crop coordinates (since raw orientation is 6):
    // raw values: t=0.012038, l=0.209036, b=0.991975, r=0.209036 + (0.979937 * 0.75) = 0.94398875
    // oriented values: ot = l = 0.209036, ol = 1.0 - b = 0.008025, ob = r = 0.94398875, or = 1.0 - t = 0.987962
    let ct_val = ct.unwrap();
    let cl_val = cl.unwrap();
    let cb_val = cb.unwrap();
    let cr_val = cr.unwrap();
    
    assert!((ct_val - 0.209036).abs() < 1e-6, "Expected close to 0.209036, got {}", ct_val);
    assert!((cl_val - 0.008025).abs() < 1e-6, "Expected close to 0.008025, got {}", cl_val);
    assert!((cb_val - 0.94398875).abs() < 1e-6, "Expected close to 0.94398875, got {}", cb_val);
    assert!((cr_val - 0.987962).abs() < 1e-6, "Expected close to 0.987962, got {}", cr_val);
    assert_eq!(ca, None);
}

#[test]
fn test_extract_faces() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("faces.jpg");
    let xmp_path = dir.path().join("faces.xmp");
    
    let xmp_content = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" 
                    xmlns:mwg-rs="http://www.metadataworkinggroup.com/schemas/regions/"
                    xmlns:stArea="http://ns.adobe.com/xmp/sType/Area#">
                    <mwg-rs:Regions rdf:parseType="Resource">
                        <mwg-rs:RegionList>
                            <rdf:Seq>
                                <rdf:li>
                                    <rdf:Description mwg-rs:Name="Alice Smith" mwg-rs:Type="Face">
                                        <mwg-rs:Area stArea:x="0.5" stArea:y="0.5" stArea:w="0.1" stArea:h="0.1" />
                                    </rdf:Description>
                                </rdf:li>
                            </rdf:Seq>
                        </mwg-rs:RegionList>
                    </mwg-rs:Regions>
                </rdf:Description>
            </rdf:RDF>
        </x:xmpmeta>
    "#;
    fs::write(xmp_path, xmp_content).unwrap();
    
    let faces = extract_faces(&photo_path);
    assert_eq!(faces.len(), 1);
    assert_eq!(faces[0].name, "Alice Smith");
    assert_eq!(faces[0].area_x, Some(0.5));
}

#[test]
fn test_extract_faces_hierarchical_fallback() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("legacy.jpg");
    let xmp_path = dir.path().join("legacy.xmp");
    
    let xmp_content = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
                    <dc:subject>
                        <rdf:Bag>
                            <rdf:li>People|Bob Smith</rdf:li>
                            <rdf:li>Vacation</rdf:li>
                        </rdf:Bag>
                    </dc:subject>
                </rdf:Description>
            </rdf:RDF>
        </x:xmpmeta>
    "#;
    fs::write(xmp_path, xmp_content).unwrap();
    
    let faces = extract_faces(&photo_path);
    assert_eq!(faces.len(), 1);
    assert_eq!(faces[0].name, "Bob Smith");
    assert_eq!(faces[0].area_x, None);
}

#[test]
fn test_extract_location() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("location.jpg");
    let xmp_path = dir.path().join("location.xmp");
    
    let xmp_content = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" 
                    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
                    xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-11/">
                    <photoshop:City>London</photoshop:City>
                    <photoshop:State>England</photoshop:State>
                    <photoshop:Country>United Kingdom</photoshop:Country>
                    <Iptc4xmpExt:LocationName>
                        <rdf:Alt>
                            <rdf:li xml:lang="x-default">Puzzling World, 188 Wānaka Luggate Highway, New Zealand</rdf:li>
                        </rdf:Alt>
                    </Iptc4xmpExt:LocationName>
                </rdf:Description>
            </rdf:RDF>
        </x:xmpmeta>
    "#;
    fs::write(xmp_path, xmp_content).unwrap();
    
    let (city, state, country, location_name) = extract_location(&photo_path);
    assert_eq!(city, Some("London".to_string()));
    assert_eq!(state, Some("England".to_string()));
    assert_eq!(country, Some("United Kingdom".to_string()));
    assert_eq!(location_name, Some("Puzzling World".to_string()));
}

#[test]
fn test_extract_title_description() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("desc.jpg");
    let xmp_path = dir.path().join("desc.xmp");
    
    let xmp_content = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" 
                    xmlns:dc="http://purl.org/dc/elements/1.1/">
                    <dc:title>
                        <rdf:Alt>
                            <rdf:li xml:lang="x-default">Summer Vacation</rdf:li>
                        </rdf:Alt>
                    </dc:title>
                    <dc:description>
                        <rdf:Alt>
                            <rdf:li xml:lang="x-default">A beautiful day at the beach.</rdf:li>
                        </rdf:Alt>
                    </dc:description>
                </rdf:Description>
            </rdf:RDF>
        </x:xmpmeta>
    "#;
    fs::write(xmp_path, xmp_content).unwrap();
    
    let (title, description) = extract_title_description(&photo_path);
    assert_eq!(title, Some("Summer Vacation".to_string()));
    assert_eq!(description, Some("A beautiful day at the beach.".to_string()));
}

#[test]
fn test_is_video() {
    assert!(is_video("mp4"));
    assert!(is_video("mov"));
    assert!(is_video("mkv"));
    assert!(!is_video("jpg"));
    assert!(!is_video("heic"));
    assert!(!is_video("md"));
}

#[test]
fn test_is_markdown() {
    assert!(image::is_markdown("md"));
    assert!(image::is_markdown("markdown"));
    assert!(!image::is_markdown("jpg"));
    assert!(!image::is_markdown("mp4"));
}

#[test]
fn test_get_mime_type() {
    assert_eq!(get_mime_type("mp4"), "video/mp4");
    assert_eq!(get_mime_type("mov"), "video/quicktime");
    assert_eq!(get_mime_type("jpg"), "image/jpeg");
    assert_eq!(get_mime_type("png"), "image/png");
    assert_eq!(get_mime_type("webp"), "image/webp");
    assert_eq!(get_mime_type("heic"), "image/heic");
    assert_eq!(get_mime_type("md"), "text/markdown");
    assert_eq!(get_mime_type("markdown"), "text/markdown");
}

#[test]
fn test_markdown_frontmatter_and_heading_extraction() {
    let dir = tempdir().unwrap();
    let post_with_frontmatter = dir.path().join("post1.md");
    let content1 = r#"---
title: "Hiking Mount Rainier"
date: "2024-07-14 09:30:00"
event: "Summer Vacation"
tags: ["hiking", "mountains", "nature"]
description: "An incredible day exploring the Skyline Trail."
---

# Extra Heading
Body text here.
"#;
    fs::write(&post_with_frontmatter, content1).unwrap();

    let meta1 = crate::processing::metadata::parse_markdown_metadata(&post_with_frontmatter);
    assert_eq!(meta1.title, Some("Hiking Mount Rainier".to_string()));
    assert_eq!(meta1.event, Some("Summer Vacation".to_string()));
    assert_eq!(meta1.tags, vec!["hiking", "mountains", "nature"]);
    assert_eq!(meta1.description, Some("An incredible day exploring the Skyline Trail.".to_string()));
    assert_eq!(meta1.capture_time.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string()), Some("2024-07-14 09:30:00".to_string()));

    // Test markdown without frontmatter (using # Heading and paragraph excerpt)
    let post_without_frontmatter = dir.path().join("2024-08-20-kayaking.md");
    let content2 = r#"# Kayaking Lake Tahoe

We launched early in the morning when the water was like glass.
The reflections were stunning.
"#;
    fs::write(&post_without_frontmatter, content2).unwrap();

    let meta2 = crate::processing::metadata::parse_markdown_metadata(&post_without_frontmatter);
    assert_eq!(meta2.title, Some("Kayaking Lake Tahoe".to_string()));
    assert_eq!(meta2.description, Some("We launched early in the morning when the water was like glass.".to_string()));
}

#[test]
fn test_import_folder_integration() {
    let dir = tempdir().unwrap();
    let cache_dir = dir.path().join("cache");
    let db_dir = dir.path();
    let db_path = db_dir.join("damright.db");
    fs::create_dir(&cache_dir).unwrap();
    
    // Initialize the database schema
    init_db(db_dir).unwrap();
    
    // We need a mock app handle for progress reporting
    let app = tauri::test::mock_app();
    let handle = app.handle();

    // Path to our test assets in the project root
    let assets_path = Path::new("..").join("test_assets");
    
    // Ensure assets exist (they were created in a previous step)
    if !assets_path.exists() {
        println!("Skipping integration test: test_assets not found at {:?}", assets_path);
        return;
    }

    let photos = import_folder(
        assets_path.to_str().unwrap(),
        &cache_dir,
        &db_path,
        Some(handle)
    ).unwrap();

    assert!(photos.len() >= 4, "Should have imported at least 4 items (3 photos + 1 video)");

    // Verify video import
    let video = photos.iter().find(|p| p.path.contains("test.mp4")).unwrap();
    assert_eq!(video.mime_type, "video/mp4");
    let video_thumb_path = Path::new(&video.thumb_path);
    assert!(video_thumb_path.exists(), "Video thumbnail should be created");
    assert_eq!(video_thumb_path.extension().unwrap(), "png", "Video thumbnail should be PNG");

    // Verify XMP priority
    let with_xmp = photos.iter().find(|p| p.path.contains("with_xmp.jpg")).unwrap();
    assert_eq!(with_xmp.rating, 5, "XMP rating should take priority");
    assert!(with_xmp.tags.contains("priority-test"), "XMP tags should take priority");

    // Verify HEIC import and dimensions (already oriented)
    let heic = photos.iter().find(|p| p.path.contains("test.heic")).unwrap();
    assert_eq!(heic.mime_type, "image/heic");
    let thumb_path = Path::new(&heic.thumb_path);
    assert!(thumb_path.exists(), "HEIC thumbnail should be created");
    // test.heic in test_assets is actually portrait 3024x4032 (or similar) or square 32x32.
    // Our check_orientation showed 2316x3088 for the user's file.
    // In test_assets/test.heic it is 32x32.

    // Verify rotated JPEG dimensions
    if let Some(tall) = photos.iter().find(|p| p.path.contains("tall.jpg")) {
        assert_eq!(tall.orientation, 6);
        // Raw was 32x64. Swapped should be 64x32.
        assert_eq!(tall.width, Some(64));
        assert_eq!(tall.height, Some(32));
    }
}

#[test]
fn test_heic_image_loading() {
    use crate::processing::image::RustImageProcessor;
    let proc = RustImageProcessor;
    let path = Path::new("test_assets/test.heic");
    if path.exists() {
        let img = proc.load_image(path).unwrap();
        assert!(matches!(img, ::image::DynamicImage::ImageRgb8(_)), "HEIC loaded image should be ImageRgb8, not monochrome or grayscale mask");
        assert_eq!(img.width(), 32);
        assert_eq!(img.height(), 32);
    }
}

#[test]
fn test_iphone_portrait_heic_loading_and_similarity() {
    use crate::processing::image::RustImageProcessor;
    use image_hasher::{HasherConfig, HashAlg};
    use ::image::GenericImageView;
    let proc = RustImageProcessor;
    let heic_path = Path::new("test_assets/test-portrait.heic");
    let expected_path = Path::new("test_assets/expected-portrait.jpeg");

    if heic_path.exists() && expected_path.exists() {
        let loaded_img = proc.load_image(heic_path).expect("Failed to load iPhone HEIC");
        assert_eq!(loaded_img.dimensions(), (600, 800), "Portrait HEIC should decode to 600x800 resolution");
        assert!(matches!(loaded_img, ::image::DynamicImage::ImageRgb8(_)));

        let expected_img = ::image::open(expected_path)
            .expect("Failed to open expected JPEG");

        assert_eq!(loaded_img.dimensions(), expected_img.dimensions());

        let hasher = HasherConfig::new().hash_alg(HashAlg::Gradient).to_hasher();
        let hash_loaded = hasher.hash_image(&loaded_img);
        let hash_expected = hasher.hash_image(&expected_img);
        let dist = hash_loaded.dist(&hash_expected);
        assert!(dist <= 3, "Perceptual hash distance ({}) between decoded HEIC and expected JPEG must be <= 3", dist);

        // Test metadata extraction dimensions
        let meta = crate::processing::metadata::get_extended_metadata(heic_path);
        assert_eq!(meta.width, Some(600));
        assert_eq!(meta.height, Some(800));
    }
}

#[test]
fn test_portrait_blur_adjustment() {
    use crate::processing::image::RustImageProcessor;
    let proc = RustImageProcessor;
    let path = Path::new("test_assets/test.heic");
    if path.exists() {
        let mut photo = Photo::default_for_test();
        photo.path = path.to_string_lossy().to_string();
        photo.portrait_blur = Some(0.75);

        let base_img = proc.load_image(path).unwrap();
        let adjusted_img = proc.apply_adjustments(base_img, &photo, false);
        assert_eq!(adjusted_img.width(), 32);
        assert_eq!(adjusted_img.height(), 32);
    }
}


#[test]
fn test_import_resumable_and_logging() {
    let dir = tempdir().unwrap();
    let cache_dir = dir.path().join("cache");
    let db_dir = dir.path();
    let db_path = db_dir.join("damright.db");
    let test_import_dir = dir.path().join("import_source");
    
    fs::create_dir(&cache_dir).unwrap();
    fs::create_dir(&test_import_dir).unwrap();
    init_db(db_dir).unwrap();
    
    // Copy test assets to our temp import source directory
    let assets_path = Path::new("..").join("test_assets");
    if !assets_path.exists() {
        return;
    }
    
    for entry in fs::read_dir(&assets_path).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_file() {
            let dest = test_import_dir.join(path.file_name().unwrap());
            fs::copy(&path, &dest).unwrap();
        }
    }
    
    let app = tauri::test::mock_app();
    let handle = app.handle();
    
    // 1st Import (Clean)
    let photos1 = import_folder(
        test_import_dir.to_str().unwrap(),
        &cache_dir,
        &db_path,
        Some(handle)
    ).unwrap();
    
    assert!(photos1.len() >= 4);
    
    // Verify log file exists and contains content
    let log_file = db_dir.join("import.log");
    assert!(log_file.exists());
    let log_content = fs::read_to_string(&log_file).unwrap();
    assert!(log_content.contains("Starting import"));
    
    // 2nd Import (Resumable check - should skip all)
    let photos2 = import_folder(
        test_import_dir.to_str().unwrap(),
        &cache_dir,
        &db_path,
        Some(handle)
    ).unwrap();
    
    assert_eq!(photos2.len(), photos1.len());
    let log_content2 = fs::read_to_string(&log_file).unwrap();
    assert!(log_content2.contains("No new files to import") || log_content2.contains("Already imported:"));
    
    // Verify deterministic thumbnail naming (wipe DB but keep cache)
    fs::remove_file(&db_path).unwrap();
    init_db(db_dir).unwrap();
    let photos_wiped = import_folder(
        test_import_dir.to_str().unwrap(),
        &cache_dir,
        &db_path,
        Some(handle)
    ).unwrap();
    assert_eq!(photos_wiped.len(), photos1.len());
    for pw in &photos_wiped {
        let p1 = photos1.iter().find(|p| p.path == pw.path).unwrap();
        assert_eq!(pw.thumb_path, p1.thumb_path);
    }
    
    // 3rd: Delete a file on disk and call refresh_folder
    let first_photo_path = Path::new(&photos1[0].path);
    fs::remove_file(first_photo_path).unwrap();
    
    let photos3 = refresh_folder(
        test_import_dir.to_str().unwrap(),
        &cache_dir,
        &db_path,
        Some(handle)
    ).unwrap();
    
    // The photo that was deleted should no longer be in the returned list
    assert_eq!(photos3.len(), photos1.len() - 1);
    
    // Verify it was actually deleted from the database
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let db_photos = photo_repo::get_all(&conn, None).unwrap();
    assert_eq!(db_photos.len(), photos1.len() - 1);
}

#[test]
fn test_real_file_metadata() {
    let path = Path::new("..").join("test_assets").join("with_xmp.jpg");
    if !path.exists() { return; }
    
    let orientation = get_exif_orientation(&path);
    println!("Orientation: {:?}", orientation);
    // with_xmp.jpg might not have orientation, but let's see.
    
    let (rating, tags, _) = get_xmp_metadata(&path);
    assert_eq!(rating, 5);
    assert!(tags.contains("priority-test"));
}

#[test]
fn test_write_xmp_preserves_other_fields() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("test.jpg");
    let xmp_path = dir.path().join("test.xmp");
    
    let initial_content = r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmp:CreatorTool="TestTool">
    <dc:rights>
     <rdf:Alt>
      <rdf:li xml:lang="x-default">Copyright 2026</rdf:li>
     </rdf:Alt>
    </dc:rights>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#;
    fs::write(&xmp_path, initial_content).unwrap();
    
    write_xmp(photo_path.to_str().unwrap(), 1.0, 3, "test", None, None, None, None, None, None, None, None, None, None).unwrap();
    
    let updated_content = fs::read_to_string(xmp_path).unwrap();
    println!("DEBUG: Updated XMP:\n{}", updated_content);
    assert!(updated_content.contains("xmp:Rating=\"3\""));
    assert!(updated_content.contains("Copyright 2026"), "Should preserve existing copyright");
    assert!(updated_content.contains("xmp:CreatorTool=\"TestTool\""), "Should preserve creator tool");
}

#[test]
fn test_write_xmp() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("test.jpg");
    fs::write(&photo_path, "fake image data").unwrap();

    write_xmp(photo_path.to_str().unwrap(), 0.5, 4, "nature, landscape", None, None, None, None, None, None, None, None, Some("Testing".to_string()), Some(0.8)).unwrap();

    let xmp_path = dir.path().join("test.xmp");

    assert!(xmp_path.exists());
    
    let content = fs::read_to_string(xmp_path).unwrap();
    assert!(content.contains("crs:Exposure2012=\"0.50\""));
    assert!(content.contains("crs:PortraitBlur=\"0.80\""));
    assert!(content.contains("xmp:Rating=\"4\""));
    assert!(content.contains("<rdf:li>nature</rdf:li>"));
    assert!(content.contains("<rdf:li>landscape</rdf:li>"));
    assert!(content.contains("Iptc4xmpExt:Event=\"Testing\""));
}

#[test]
fn test_write_xmp_title_description() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("test_desc.jpg");
    fs::write(&photo_path, "fake image data").unwrap();

    write_xmp(
        photo_path.to_str().unwrap(),
        0.0, 0, "",
        Some("Beautiful Sunrise"),
        Some("A gorgeous sunrise over Clarke Quay & Dempsy."),
        None, None, None, None, None,
        None,
        None,
        None,
    ).unwrap();

    let xmp_path = dir.path().join("test_desc.xmp");
    assert!(xmp_path.exists());
    
    let content = fs::read_to_string(xmp_path).unwrap();
    assert!(content.contains("<dc:title>"));
    assert!(content.contains("<dc:description>"));
    assert!(content.contains("A gorgeous sunrise over Clarke Quay &amp; Dempsy."));
}

#[test]
fn test_extended_metadata_with_xmp_cleared_description() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("cleared_desc.jpg");
    fs::write(&photo_path, "fake image data").unwrap();

    let xmp_content = r#"
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <rdf:Description rdf:about="" xmp:Rating="3">
                </rdf:Description>
            </rdf:RDF>
        </x:xmpmeta>
    "#;
    let xmp_doc = crate::processing::metadata::XmpDocument::from_str(xmp_content).unwrap();
    assert!(xmp_doc.description.is_none());
    assert!(xmp_doc.title.is_none());

    let extended = crate::processing::metadata::get_extended_metadata_with_xmp(&photo_path, Some(&xmp_doc));
    assert_eq!(extended.description, None);
    assert_eq!(extended.title, None);
}


#[test]
fn test_write_xmp_crop() {
    let dir = tempdir().unwrap();
    let photo_path = dir.path().join("crop.jpg");
    fs::write(&photo_path, "fake image data").unwrap();
    
    write_xmp(
        photo_path.to_str().unwrap(), 
        0.0, 0, "", 
        None, None,
        Some(0.1), Some(0.2), Some(0.8), Some(0.9), Some(45.0),
        None,
        None,
        None,
    ).unwrap();
    
    let xmp_path = dir.path().join("crop.xmp");
    let content = fs::read_to_string(xmp_path).unwrap();
    assert!(content.contains("crs:HasCrop=\"True\""));
    assert!(content.contains("crs:CropTop=\"0.100000\""));
    assert!(content.contains("crs:CropLeft=\"0.200000\""));
    assert!(content.contains("crs:CropBottom=\"0.800000\""));
    assert!(content.contains("crs:CropRight=\"0.900000\""));
    assert!(content.contains("crs:CropAngle=\"45.000000\""));
}

#[test]
fn test_crop_orientation_transformations() {
    use crate::processing::metadata::xmp::{raw_to_oriented_crop, oriented_to_raw_crop};
    
    // We'll test with orientation 6 (rotate 90 degrees CW)
    let raw = (0.1, 0.2, 0.8, 0.9); // (top, left, bottom, right)
    
    // raw -> oriented
    let oriented = raw_to_oriented_crop(raw.0, raw.1, raw.2, raw.3, 6);
    // Formula for 6 is: top' = left = 0.2, left' = 1.0 - bottom = 0.2, bottom' = right = 0.9, right' = 1.0 - top = 0.9
    assert!((oriented.0 - 0.2).abs() < 1e-9);
    assert!((oriented.1 - 0.2).abs() < 1e-9);
    assert!((oriented.2 - 0.9).abs() < 1e-9);
    assert!((oriented.3 - 0.9).abs() < 1e-9);
    
    // oriented -> raw (should get initial back)
    let back = oriented_to_raw_crop(oriented.0, oriented.1, oriented.2, oriented.3, 6);
    assert!((back.0 - raw.0).abs() < 1e-9);
    assert!((back.1 - raw.1).abs() < 1e-9);
    assert!((back.2 - raw.2).abs() < 1e-9);
    assert!((back.3 - raw.3).abs() < 1e-9);

    // Test for orientation 8 (rotate 270 degrees CW / 90 CCW)
    let oriented8 = raw_to_oriented_crop(raw.0, raw.1, raw.2, raw.3, 8);
    // Formula for 8 is: top' = 1.0 - right = 0.1, left' = top = 0.1, bottom' = 1.0 - left = 0.8, right' = bottom = 0.8
    assert!((oriented8.0 - 0.1).abs() < 1e-9);
    assert!((oriented8.1 - 0.1).abs() < 1e-9);
    assert!((oriented8.2 - 0.8).abs() < 1e-9);
    assert!((oriented8.3 - 0.8).abs() < 1e-9);
    
    let back8 = oriented_to_raw_crop(oriented8.0, oriented8.1, oriented8.2, oriented8.3, 8);
    assert!((back8.0 - raw.0).abs() < 1e-9);
    assert!((back8.1 - raw.1).abs() < 1e-9);
    assert!((back8.2 - raw.2).abs() < 1e-9);
    assert!((back8.3 - raw.3).abs() < 1e-9);
}


#[test]
fn test_get_preview_image() {
    let dir = tempdir().unwrap();
    let cache_dir = dir.path().join("cache");
    fs::create_dir_all(&cache_dir).unwrap();

    let assets_path = Path::new("..").join("test_assets").join("simple.jpg");
    if !assets_path.exists() { return; }

    let photo = Photo {
        id: "test-id".to_string(),
        path: assets_path.to_string_lossy().to_string(),
        ..Photo::default_for_test()
    };

    let preview_path_str = get_preview_image(&photo, &cache_dir, false).unwrap();
    let preview_path = Path::new(&preview_path_str);
    assert!(preview_path.exists());
    
    let path_hash = blake3::hash(photo.path.as_bytes()).to_string();
    let prefix = &path_hash[0..2];
    let expected_pattern = format!("cache/previews/{}/{}.jpg", prefix, path_hash);
    assert!(preview_path.to_string_lossy().contains(&expected_pattern));
}

#[test]
fn test_auto_rename_photo() {
    let dir = tempdir().unwrap();
    let db_dir = dir.path();
    let photo_path = dir.path().join("original.jpg");
    fs::write(&photo_path, "fake image data").unwrap();
    
    let conn = crate::db::init_db(db_dir).unwrap();
    let id = "test-rename-id".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id.clone(),
        path: photo_path.to_string_lossy().to_string(),
        thumb_path: "thumb.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    // Create an XMP sidecar with a capture date
    let xmp_path = dir.path().join("original.xmp");
    fs::write(&xmp_path, r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreateDate>2026-05-09T12:34:56</xmp:CreateDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#).unwrap();

    let new_path_str = auto_rename_photo(&id, &photo_path.to_string_lossy(), &conn).unwrap();
    let new_path = Path::new(&new_path_str);
    
    assert!(new_path.exists());
    assert!(new_path.file_name().unwrap().to_str().unwrap().starts_with("20260509T123456-"));
    assert!(!photo_path.exists());
    
    // Verify XMP was also renamed
    let new_xmp = new_path.with_extension("xmp");
    assert!(new_xmp.exists());
    assert!(!xmp_path.exists());

    // Verify PreservedFileName was written
    let xmp_content = fs::read_to_string(&new_xmp).unwrap();
    assert!(xmp_content.contains("xmpMM:PreservedFileName=\"original.jpg\""));

    // Verify DB was updated
    let db_path_val = photo_repo::get_by_id(&conn, &id).unwrap().path;
    assert_eq!(db_path_val, new_path_str);
}

#[test]
fn test_auto_rename_photo_fails_without_date() {
    let dir = tempdir().unwrap();
    let db_dir = dir.path();
    let photo_path = dir.path().join("no_date.jpg");
    fs::write(&photo_path, "fake image data").unwrap();
    
    let conn = crate::db::init_db(db_dir).unwrap();
    let id = "test-fail-rename-id".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id.clone(),
        path: photo_path.to_string_lossy().to_string(),
        thumb_path: "thumb.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    let result = auto_rename_photo(&id, &photo_path.to_string_lossy(), &conn);
    assert!(result.is_err());
    let err_msg = result.err().unwrap().to_string();
    assert!(err_msg.contains("No capture date"));
}

#[test]
fn test_cleanup_database() {
    use crate::db::source_repo;
    let dir = tempdir().unwrap();
    let conn = crate::db::init_db(dir.path()).unwrap();
    
    // 1. Add a source
    let source_path = "/real/photos";
    source_repo::insert(&conn, &Source {
        id: "src1".to_string(),
        path: source_path.to_string(),
        name: "Photos".to_string(),
        sync_mode: "none".to_string(),
        server_path: None,
        archive_prefix: None,
        rating_enabled: true,
    }).unwrap();

    // 2. Add a valid photo
    photo_repo::insert(&conn, &Photo {
        id: "valid".to_string(),
        path: format!("{}/test.jpg", source_path),
        thumb_path: "thumb.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    // 3. Add an orphan photo (e.g. from a test)
    photo_repo::insert(&conn, &Photo {
        id: "orphan".to_string(),
        path: "/tmp/assets/test.jpg".to_string(),
        thumb_path: "thumb2.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    let count = cleanup_database(&conn).unwrap();
    assert_eq!(count, 1);

    let remaining = photo_repo::get_all(&conn, None).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, "valid");
}

#[test]
fn test_move_photos() {
    let dir = tempdir().unwrap();
    let db_dir = dir.path();
    let source_dir = dir.path().join("source");
    let dest_dir = dir.path().join("dest");
    fs::create_dir(&source_dir).unwrap();
    fs::create_dir(&dest_dir).unwrap();

    let photo_path = source_dir.join("test.jpg");
    fs::write(&photo_path, "fake data").unwrap();
    let xmp_path = source_dir.join("test.xmp");
    fs::write(&xmp_path, "xmp data").unwrap();

    let conn = init_db(db_dir).unwrap();
    let id = "move-test-id".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id.clone(),
        path: photo_path.to_string_lossy().to_string(),
        thumb_path: "thumb.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    let count = move_photos(vec![id.clone()], dest_dir.to_str().unwrap(), &conn).unwrap();
    
    assert_eq!(count, 1);
    let new_photo_path = dest_dir.join("test.jpg");
    let new_xmp_path = dest_dir.join("test.xmp");
    
    assert!(new_photo_path.exists());
    assert!(new_xmp_path.exists());
    assert!(!photo_path.exists());
    assert!(!xmp_path.exists());

    let db_path_val = photo_repo::get_by_id(&conn, &id).unwrap().path;
    assert_eq!(db_path_val, new_photo_path.to_string_lossy().to_string());
}

#[test]
fn test_move_folder_renaming_and_nested_photos() {
    let dir = tempdir().unwrap();
    let db_dir = dir.path();
    let library_dir = dir.path().join("Library");
    let event_dir = library_dir.join("2026").join("08-04");
    let sub_dir = event_dir.join("Sub");
    fs::create_dir_all(&sub_dir).unwrap();

    let conn = init_db(db_dir).unwrap();

    // Register Library source
    let source = crate::models::Source {
        id: "src-lib".to_string(),
        path: library_dir.to_string_lossy().to_string(),
        name: "Library".to_string(),
        sync_mode: "push".to_string(),
        server_path: Some("Library".to_string()),
        archive_prefix: None,
        rating_enabled: true,
    };
    crate::db::source_repo::insert(&conn, &source).unwrap();

    let p1_path = event_dir.join("photo1.jpg");
    fs::write(&p1_path, "fake data 1").unwrap();
    let p1_xmp = event_dir.join("photo1.xmp");
    fs::write(&p1_xmp, "xmp data 1").unwrap();

    let p2_path = sub_dir.join("photo2.jpg");
    fs::write(&p2_path, "fake data 2").unwrap();

    let id1 = "photo-1".to_string();
    let id2 = "photo-2".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id1.clone(),
        path: p1_path.to_string_lossy().to_string(),
        thumb_path: "thumb1.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();
    photo_repo::insert(&conn, &Photo {
        id: id2.clone(),
        path: p2_path.to_string_lossy().to_string(),
        thumb_path: "thumb2.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    // 1. Rename folder in place
    let renamed_dest = library_dir.join("2026").join("08-04 Birthday");
    let moved_count = crate::processing::file_ops::move_folder(
        event_dir.to_str().unwrap(),
        renamed_dest.to_str().unwrap(),
        &conn,
    ).unwrap();

    assert_eq!(moved_count, 2);
    assert!(!event_dir.exists());
    assert!(renamed_dest.exists());
    assert!(renamed_dest.join("photo1.jpg").exists());
    assert!(renamed_dest.join("photo1.xmp").exists());
    assert!(renamed_dest.join("Sub").join("photo2.jpg").exists());

    // Verify DB records updated
    let p1_db = photo_repo::get_by_id(&conn, &id1).unwrap();
    let p2_db = photo_repo::get_by_id(&conn, &id2).unwrap();
    assert_eq!(p1_db.path, renamed_dest.join("photo1.jpg").to_string_lossy().to_string());
    assert_eq!(p2_db.path, renamed_dest.join("Sub").join("photo2.jpg").to_string_lossy().to_string());

    // 2. Move folder to another parent directory
    let archive_dir = library_dir.join("Archive");
    let target_dest = archive_dir.join("08-04 Birthday");
    let moved_count2 = crate::processing::file_ops::move_folder(
        renamed_dest.to_str().unwrap(),
        target_dest.to_str().unwrap(),
        &conn,
    ).unwrap();

    assert_eq!(moved_count2, 2);
    assert!(!renamed_dest.exists());
    assert!(target_dest.exists());
    assert!(target_dest.join("photo1.jpg").exists());
    assert!(target_dest.join("Sub").join("photo2.jpg").exists());

    let p1_db2 = photo_repo::get_by_id(&conn, &id1).unwrap();
    assert_eq!(p1_db2.path, target_dest.join("photo1.jpg").to_string_lossy().to_string());
}

#[test]
fn test_move_folder_validation_and_inbox_tombstones() {
    let dir = tempdir().unwrap();
    let db_dir = dir.path();
    let inbox_dir = dir.path().join("Inbox");
    let trip_dir = inbox_dir.join("Trip");
    fs::create_dir_all(&trip_dir).unwrap();

    let conn = init_db(db_dir).unwrap();

    let source = crate::models::Source {
        id: "src-inbox".to_string(),
        path: inbox_dir.to_string_lossy().to_string(),
        name: "Inbox".to_string(),
        sync_mode: "pull".to_string(),
        server_path: Some("Inbox".to_string()),
        archive_prefix: Some("Inbox/archive".to_string()),
        rating_enabled: false,
    };
    crate::db::source_repo::insert(&conn, &source).unwrap();

    let photo_path = trip_dir.join("img.jpg");
    fs::write(&photo_path, "inbox data").unwrap();

    let id = "inbox-photo".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id.clone(),
        path: photo_path.to_string_lossy().to_string(),
        thumb_path: "thumb.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    // Test cycle detection: cannot move folder into its own child
    let child_dest = trip_dir.join("Child");
    let cycle_err = crate::processing::file_ops::move_folder(
        trip_dir.to_str().unwrap(),
        child_dest.to_str().unwrap(),
        &conn,
    );
    assert!(cycle_err.is_err());
    assert!(cycle_err.unwrap_err().to_string().contains("own subdirectory"));

    // Move out of inbox to an external sorted folder
    let sorted_dir = dir.path().join("SortedTrip");
    let count = crate::processing::file_ops::move_folder(
        trip_dir.to_str().unwrap(),
        sorted_dir.to_str().unwrap(),
        &conn,
    ).unwrap();
    assert_eq!(count, 1);

    // Verify inbox tombstone was created in sync_state with status 'sorted'
    let state = crate::db::sync_state_repo::get_sync_state(&conn, "Inbox/Trip/img.jpg").unwrap();
    assert!(state.is_some(), "Inbox tombstone must exist in sync_state");
    assert_eq!(state.unwrap().status, "sorted");
}


#[test]
fn test_delete_photo() {
    let dir = tempdir().unwrap();
    let db_dir = dir.path();
    let source_dir = dir.path().join("source");
    fs::create_dir(&source_dir).unwrap();

    let photo_path = source_dir.join("test.jpg");
    fs::write(&photo_path, "fake data").unwrap();
    let xmp_path = source_dir.join("test.xmp");
    fs::write(&xmp_path, "xmp data").unwrap();
    let xmp_ext_path = source_dir.join("test.jpg.xmp");
    fs::write(&xmp_ext_path, "xmp data 2").unwrap();
    let thumb_path = source_dir.join("thumb.jpg");
    fs::write(&thumb_path, "thumb data").unwrap();

    let conn = init_db(db_dir).unwrap();
    let id = "delete-test-id".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id.clone(),
        path: photo_path.to_string_lossy().to_string(),
        thumb_path: thumb_path.to_string_lossy().to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    delete_photo_by_id(&id, &conn).unwrap();

    assert!(!photo_path.exists());
    assert!(!xmp_path.exists());
    assert!(!xmp_ext_path.exists());
    assert!(!thumb_path.exists());

    // Verify it is deleted from database
    let db_res = photo_repo::get_by_id(&conn, &id);
    assert!(db_res.is_err());
}


#[test]
fn test_get_dir_tree_sorting_descending() {
    let dir = tempdir().unwrap();
    let root = dir.path().join("root");
    fs::create_dir(&root).unwrap();

    let conn = init_db(dir.path()).unwrap();

    // Insert photos across different subfolders in DB
    photo_repo::insert(&conn, &Photo {
        id: "p1".to_string(),
        path: root.join("aaa").join("p1.jpg").to_str().unwrap().to_string(),
        thumb_path: "thumb1.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    photo_repo::insert(&conn, &Photo {
        id: "p2".to_string(),
        path: root.join("ccc").join("p2.jpg").to_str().unwrap().to_string(),
        thumb_path: "thumb2.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    photo_repo::insert(&conn, &Photo {
        id: "p3".to_string(),
        path: root.join("bbb").join("p3.jpg").to_str().unwrap().to_string(),
        thumb_path: "thumb3.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    let tree = get_dir_tree(&conn, root.to_str().unwrap()).unwrap();

    // Should be sorted alphabetically descending: ccc, bbb, aaa
    assert_eq!(tree.children.len(), 3);
    assert_eq!(tree.children[0].name, "ccc");
    assert_eq!(tree.children[1].name, "bbb");
    assert_eq!(tree.children[2].name, "aaa");
    assert_eq!(tree.photo_count, 3);
}

#[test]
fn test_get_dir_tree_from_db_nested_structure() {
    let dir = tempdir().unwrap();
    let root = dir.path().join("root");
    fs::create_dir(&root).unwrap();

    let conn = init_db(dir.path()).unwrap();

    // Add root photo
    photo_repo::insert(&conn, &Photo {
        id: "root_photo".to_string(),
        path: root.join("root_photo.jpg").to_str().unwrap().to_string(),
        thumb_path: "thumb0.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    // Add photos in nested 2024/01-01 and 2024/05-10
    photo_repo::insert(&conn, &Photo {
        id: "p1".to_string(),
        path: root.join("2024").join("01-01").join("p1.jpg").to_str().unwrap().to_string(),
        thumb_path: "thumb1.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    photo_repo::insert(&conn, &Photo {
        id: "p2".to_string(),
        path: root.join("2024").join("01-01").join("p2.jpg").to_str().unwrap().to_string(),
        thumb_path: "thumb2.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    photo_repo::insert(&conn, &Photo {
        id: "p3".to_string(),
        path: root.join("2024").join("05-10").join("p3.jpg").to_str().unwrap().to_string(),
        thumb_path: "thumb3.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    // Add photo in 2025/vacation
    photo_repo::insert(&conn, &Photo {
        id: "p4".to_string(),
        path: root.join("2025").join("vacation").join("p4.jpg").to_str().unwrap().to_string(),
        thumb_path: "thumb4.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    let tree = get_dir_tree(&conn, root.to_str().unwrap()).unwrap();

    assert_eq!(tree.name, "root");
    assert_eq!(tree.photo_count, 5);
    assert_eq!(tree.children.len(), 2);

    // 2025 should be before 2024
    let node_2025 = &tree.children[0];
    assert_eq!(node_2025.name, "2025");
    assert_eq!(node_2025.photo_count, 1);
    assert_eq!(node_2025.children.len(), 1);
    assert_eq!(node_2025.children[0].name, "vacation");
    assert_eq!(node_2025.children[0].photo_count, 1);

    let node_2024 = &tree.children[1];
    assert_eq!(node_2024.name, "2024");
    assert_eq!(node_2024.photo_count, 3);
    assert_eq!(node_2024.children.len(), 2);
    // 05-10 should be before 01-01
    assert_eq!(node_2024.children[0].name, "05-10");
    assert_eq!(node_2024.children[0].photo_count, 1);
    assert_eq!(node_2024.children[1].name, "01-01");
    assert_eq!(node_2024.children[1].photo_count, 2);
}

#[test]
fn test_get_dir_tree_from_db_empty() {
    let dir = tempdir().unwrap();
    let root = dir.path().join("root");
    fs::create_dir(&root).unwrap();

    let conn = init_db(dir.path()).unwrap();
    let tree = get_dir_tree(&conn, root.to_str().unwrap()).unwrap();

    assert_eq!(tree.name, "root");
    assert_eq!(tree.photo_count, 0);
    assert_eq!(tree.children.len(), 0);
}

#[test]
fn test_get_capture_time_fallback_filename() {
    use crate::processing::metadata::get_capture_time;
    use chrono::{NaiveDate, NaiveTime, NaiveDateTime};

    let cases = vec![
        ("20050801T150027-027.MOV", Some(NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2005, 8, 1).unwrap(),
            NaiveTime::from_hms_opt(15, 0, 27).unwrap()
        ))),
        ("/some/path/20050801_150027.mov", Some(NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2005, 8, 1).unwrap(),
            NaiveTime::from_hms_opt(15, 0, 27).unwrap()
        ))),
        ("2005-08-01-15-00-27.avi", Some(NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2005, 8, 1).unwrap(),
            NaiveTime::from_hms_opt(15, 0, 27).unwrap()
        ))),
        ("2005-08-01 15.00.27.mp4", Some(NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2005, 8, 1).unwrap(),
            NaiveTime::from_hms_opt(15, 0, 27).unwrap()
        ))),
        ("20050801_1500.mov", Some(NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2005, 8, 1).unwrap(),
            NaiveTime::from_hms_opt(15, 0, 0).unwrap()
        ))),
        ("20050801.avi", Some(NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2005, 8, 1).unwrap(),
            NaiveTime::from_hms_opt(12, 0, 0).unwrap() // noon default
        ))),
        ("2005-08-01.mov", Some(NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2005, 8, 1).unwrap(),
            NaiveTime::from_hms_opt(12, 0, 0).unwrap() // noon default
        ))),
        ("IMG_20050801_150027.jpg", Some(NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2005, 8, 1).unwrap(),
            NaiveTime::from_hms_opt(15, 0, 27).unwrap()
        ))),
        ("20050801123456.mp4", Some(NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2005, 8, 1).unwrap(),
            NaiveTime::from_hms_opt(12, 34, 56).unwrap()
        ))),
        ("not_a_date.mov", None),
        ("20050801T990027.mov", Some(NaiveDateTime::new(
            NaiveDate::from_ymd_opt(2005, 8, 1).unwrap(),
            NaiveTime::from_hms_opt(12, 0, 0).unwrap()
        ))),
        ("20051301T150027.mov", None),
        ("20050832T150027.mov", None),
    ];

    for (filename, expected) in cases {
        let res = get_capture_time(Path::new(filename));
        assert_eq!(res, expected, "Failed for filename: {}", filename);
    }
}

#[test]
fn test_fix_validation_issues_integration() {
    let dir = tempdir().unwrap();
    let db_dir = dir.path();

    // Set up a folder structure: family_vacation/2026-06-01/
    let vacation_dir = dir.path().join("family_vacation");
    let wrong_date_dir = vacation_dir.join("2026-06-01");
    fs::create_dir_all(&wrong_date_dir).unwrap();

    // Create a photo with wrong date folder, missing event, and bad name
    let photo_path = wrong_date_dir.join("badname.jpg");
    fs::write(&photo_path, "fake image data").unwrap();

    let conn = init_db(db_dir).unwrap();
    let photo_id = "test-val-id".to_string();

    photo_repo::insert(&conn, &Photo {
        id: photo_id.clone(),
        path: photo_path.to_string_lossy().to_string(),
        thumb_path: "thumb.jpg".to_string(),
        capture_time: Some("2026-05-09 12:30:45".to_string()),
        event: None, // Missing Event!
        ..Photo::default_for_test()
    }).unwrap();

    let count = super::audit::fix_validation_issues(&conn, Some(vec![photo_id.clone()])).unwrap();

    assert_eq!(count, 1);

    // Get the updated photo from DB
    let updated = photo_repo::get_by_id(&conn, &photo_id).unwrap();

    // 1. Event should be suggested as "Family Vacation"
    assert_eq!(updated.event.as_deref(), Some("Family Vacation"));

    // 2. Folder should be corrected to 2026-05-09
    // 3. Name should be corrected to 20260509T123045-*.jpg
    let updated_path = Path::new(&updated.path);
    assert!(updated_path.exists());
    
    let parent_dir = updated_path.parent().unwrap();
    assert_eq!(parent_dir.file_name().unwrap().to_str().unwrap(), "2026-05-09");

    let filename = updated_path.file_name().unwrap().to_str().unwrap();
    assert!(filename.starts_with("20260509T123045-"));
}

#[test]
fn test_inbox_tombstone_on_move_and_delete() {
    use crate::db::source_repo;
    use crate::db::sync_state_repo::get_sync_state;
    use crate::models::Source;

    let dir = tempdir().unwrap();
    let db_dir = dir.path();
    let inbox_dir = dir.path().join("Inbox");
    let dest_dir = dir.path().join("2026").join("08-16");
    fs::create_dir_all(&inbox_dir).unwrap();
    fs::create_dir_all(&dest_dir).unwrap();

    let conn = init_db(db_dir).unwrap();

    // Insert inbox source
    let source = Source {
        id: "src_inbox".to_string(),
        path: inbox_dir.to_string_lossy().to_string(),
        name: "Inbox".to_string(),
        sync_mode: "pull".to_string(),
        server_path: Some("Inbox".to_string()),
        archive_prefix: None,
        rating_enabled: false,
    };
    source_repo::insert(&conn, &source).unwrap();

    // Photo 1: to be moved
    let photo1_path = inbox_dir.join("photo1.jpg");
    fs::write(&photo1_path, "photo1 data").unwrap();
    let id1 = "photo1_id".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id1.clone(),
        path: photo1_path.to_string_lossy().to_string(),
        thumb_path: "thumb1.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    // Move photo1
    let moved_count = move_photos(vec![id1.clone()], dest_dir.to_str().unwrap(), &conn).unwrap();
    assert_eq!(moved_count, 1);

    // Verify tombstone in sync_state for Inbox/photo1.jpg with status 'sorted'
    let state1 = get_sync_state(&conn, "Inbox/photo1.jpg").unwrap();
    assert!(state1.is_some());
    assert_eq!(state1.unwrap().status, "sorted");

    // Photo 2: to be deleted
    let photo2_path = inbox_dir.join("photo2.jpg");
    fs::write(&photo2_path, "photo2 data").unwrap();
    let id2 = "photo2_id".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id2.clone(),
        path: photo2_path.to_string_lossy().to_string(),
        thumb_path: "thumb2.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    // Delete photo2
    delete_photo_by_id(&id2, &conn).unwrap();

    // Verify tombstone in sync_state for Inbox/photo2.jpg with status 'deleted'
    let state2 = get_sync_state(&conn, "Inbox/photo2.jpg").unwrap();
    assert!(state2.is_some());
    assert_eq!(state2.unwrap().status, "deleted");

    // Photo 3: to be auto-renamed inside Inbox
    let photo3_path = inbox_dir.join("photo3.jpg");
    fs::write(&photo3_path, "photo3 data").unwrap();
    let photo3_xmp = inbox_dir.join("photo3.xmp");
    fs::write(&photo3_xmp, r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreateDate>2026-08-16T20:00:00</xmp:CreateDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#).unwrap();

    let id3 = "photo3_id".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id3.clone(),
        path: photo3_path.to_string_lossy().to_string(),
        thumb_path: "thumb3.jpg".to_string(),
        capture_time: Some("2026-08-16 20:00:00".to_string()),
        ..Photo::default_for_test()
    }).unwrap();

    // Auto rename photo3 inside Inbox
    let new_path3 = auto_rename_photo(&id3, &photo3_path.to_string_lossy(), &conn).unwrap();
    assert_ne!(new_path3, photo3_path.to_string_lossy());

    // Verify tombstone in sync_state for Inbox/photo3.jpg with status 'sorted'
    let state3 = get_sync_state(&conn, "Inbox/photo3.jpg").unwrap();
    assert!(state3.is_some());
    assert_eq!(state3.unwrap().status, "sorted");

    // Photo 4: nested relative path photo in subfolder (e.g. Inbox/My iPhone/Recents/IMG_1784.HEIC)
    let nested_dir = inbox_dir.join("My iPhone").join("Recents");
    fs::create_dir_all(&nested_dir).unwrap();
    let photo4_path = nested_dir.join("IMG_1784.HEIC");
    fs::write(&photo4_path, "heic data").unwrap();
    let id4 = "photo4_id".to_string();
    let rel_path4 = "Inbox/My iPhone/Recents/IMG_1784.HEIC".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id4.clone(),
        path: rel_path4.clone(),
        thumb_path: "thumb4.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    delete_photo_by_id(&id4, &conn).unwrap();

    let state4 = get_sync_state(&conn, "Inbox/My iPhone/Recents/IMG_1784.HEIC").unwrap();
    assert!(state4.is_some());
    assert_eq!(state4.unwrap().status, "deleted");
}

#[test]
fn test_delete_photo_lifecycle() {
    use crate::processing::storage::AssetStorage;
    use crate::processing::image::get_preview_path;

    let dir = tempdir().unwrap();
    let db_dir = dir.path();
    let photo_path = dir.path().join("lifecycle.jpg");
    fs::write(&photo_path, b"mock image").unwrap();

    let xmp_compound = dir.path().join("lifecycle.jpg.xmp");
    fs::write(&xmp_compound, b"<xmp>compound</xmp>").unwrap();

    let xmp_standard = dir.path().join("lifecycle.xmp");
    fs::write(&xmp_standard, b"<xmp>standard</xmp>").unwrap();

    let cache_dir = dir.path().join("cache");
    let thumb_path = crate::processing::image::get_thumbnail_path(&photo_path, &cache_dir);
    if let Some(parent) = thumb_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&thumb_path, b"mock thumbnail").unwrap();

    let photo_path_str = photo_path.to_string_lossy().to_string();
    let thumb_path_str = thumb_path.to_string_lossy().to_string();

    let preview_path = get_preview_path(&photo_path_str, &cache_dir, false);
    if let Some(parent) = preview_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&preview_path, b"mock preview").unwrap();

    let uncropped_preview_path = get_preview_path(&photo_path_str, &cache_dir, true);
    if let Some(parent) = uncropped_preview_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&uncropped_preview_path, b"mock uncropped preview").unwrap();

    let conn = init_db(db_dir).unwrap();
    let id = "test-lifecycle-id".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id.clone(),
        path: photo_path_str.clone(),
        thumb_path: thumb_path_str.clone(),
        ..Photo::default_for_test()
    }).unwrap();

    // Verify all files exist before deletion
    assert!(photo_path.exists());
    assert!(xmp_compound.exists());
    assert!(xmp_standard.exists());
    assert!(thumb_path.exists());
    assert!(preview_path.exists());
    assert!(uncropped_preview_path.exists());
    assert!(photo_repo::get_by_id(&conn, &id).is_ok());

    // Execute deletion via AssetStorage
    AssetStorage::delete_photo(&conn, &id).unwrap();

    // Verify all physical files and DB records are removed
    assert!(!photo_path.exists());
    assert!(!xmp_compound.exists());
    assert!(!xmp_standard.exists());
    assert!(!thumb_path.exists());
    assert!(!preview_path.exists());
    assert!(!uncropped_preview_path.exists());
    assert!(photo_repo::get_by_id(&conn, &id).is_err());
}

#[test]
fn test_move_photo_with_multi_sidecars() {
    use crate::processing::storage::AssetStorage;

    let dir = tempdir().unwrap();
    let db_dir = dir.path();
    let src_dir = dir.path().join("src_folder");
    let dest_dir = dir.path().join("dest_folder");
    fs::create_dir_all(&src_dir).unwrap();
    fs::create_dir_all(&dest_dir).unwrap();

    let photo_path = src_dir.join("photo_multi.jpg");
    fs::write(&photo_path, b"mock image").unwrap();

    let xmp_compound = src_dir.join("photo_multi.jpg.xmp");
    fs::write(&xmp_compound, b"<xmp>compound sidecar</xmp>").unwrap();

    let xmp_standard = src_dir.join("photo_multi.xmp");
    fs::write(&xmp_standard, b"<xmp>standard sidecar</xmp>").unwrap();

    let conn = init_db(db_dir).unwrap();
    let id = "test-multi-sidecar-id".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id.clone(),
        path: photo_path.to_string_lossy().to_string(),
        thumb_path: "thumb.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    let moved_count = AssetStorage::move_photos(&conn, &[id.clone()], dest_dir.to_str().unwrap()).unwrap();
    assert_eq!(moved_count, 1);

    let new_photo_path = dest_dir.join("photo_multi.jpg");
    let new_xmp_compound = dest_dir.join("photo_multi.jpg.xmp");
    let new_xmp_standard = dest_dir.join("photo_multi.xmp");

    // Verify source files removed
    assert!(!photo_path.exists());
    assert!(!xmp_compound.exists());
    assert!(!xmp_standard.exists());

    // Verify destination files exist
    assert!(new_photo_path.exists());
    assert!(new_xmp_compound.exists());
    assert!(new_xmp_standard.exists());

    // Verify DB updated
    let updated = photo_repo::get_by_id(&conn, &id).unwrap();
    assert_eq!(updated.path, new_photo_path.to_string_lossy().to_string());
}

#[test]
fn test_auto_rename_preserves_sidecar_and_metadata() {
    use crate::processing::storage::AssetStorage;

    let dir = tempdir().unwrap();
    let db_dir = dir.path();
    let photo_path = dir.path().join("vacation_pic.jpg");
    fs::write(&photo_path, b"vacation content 12345").unwrap();

    let xmp_path = dir.path().join("vacation_pic.xmp");
    fs::write(&xmp_path, r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreateDate>2026-07-20T15:45:30</xmp:CreateDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#).unwrap();

    let conn = init_db(db_dir).unwrap();
    let id = "test-preserves-id".to_string();
    photo_repo::insert(&conn, &Photo {
        id: id.clone(),
        path: photo_path.to_string_lossy().to_string(),
        thumb_path: "thumb.jpg".to_string(),
        ..Photo::default_for_test()
    }).unwrap();

    let new_path_str = AssetStorage::auto_rename_photo(&conn, &id).unwrap();
    let new_path = Path::new(&new_path_str);

    assert!(new_path.exists());
    assert!(!photo_path.exists());
    assert!(new_path.file_name().unwrap().to_str().unwrap().starts_with("20260720T154530-"));

    let new_xmp = new_path.with_extension("xmp");
    assert!(new_xmp.exists());
    assert!(!xmp_path.exists());

    let xmp_content = fs::read_to_string(&new_xmp).unwrap();
    assert!(xmp_content.contains("xmpMM:PreservedFileName=\"vacation_pic.jpg\""));

    let updated = photo_repo::get_by_id(&conn, &id).unwrap();
    assert_eq!(updated.path, new_path_str);
}

#[test]
fn test_import_folder_with_markdown() {
    let dir = tempdir().unwrap();
    let source_dir = dir.path().join("source");
    let cache_dir = dir.path().join("cache");
    let db_dir = dir.path().join("db");
    fs::create_dir_all(&source_dir).unwrap();
    fs::create_dir_all(&cache_dir).unwrap();
    fs::create_dir_all(&db_dir).unwrap();

    let db_path = db_dir.join("damright.db");
    init_db(&db_dir).unwrap();

    let md_file = source_dir.join("2024-05-10-camp.md");
    let md_content = r#"---
title: "Spring Camp 2024"
date: "2024-05-10 14:00:00"
event: "Camping Trip"
tags: ["camping", "outdoors"]
description: "Setting up camp by the river under clear skies."
---

# Spring Camp 2024

We set up camp by the river.
"#;
    fs::write(&md_file, md_content).unwrap();

    let photos = import_folder_headless(
        source_dir.to_str().unwrap(),
        &cache_dir,
        &db_path,
    ).unwrap();

    assert_eq!(photos.len(), 1);
    let post = &photos[0];
    assert_eq!(post.mime_type, "text/markdown");
    assert_eq!(post.title, Some("Spring Camp 2024".to_string()));
    assert_eq!(post.event, Some("Camping Trip".to_string()));
    assert!(post.tags.contains("camping"));
    assert_eq!(post.description, Some("Setting up camp by the river under clear skies.".to_string()));
    assert_eq!(post.capture_time, Some("2024-05-10 14:00:00".to_string()));
}

#[test]
fn test_refresh_folder_with_markdown() {
    let dir = tempdir().unwrap();
    let source_dir = dir.path().join("source");
    let cache_dir = dir.path().join("cache");
    let db_dir = dir.path().join("db");
    fs::create_dir_all(&source_dir).unwrap();
    fs::create_dir_all(&cache_dir).unwrap();
    fs::create_dir_all(&db_dir).unwrap();

    let db_path = db_dir.join("damright.db");
    let conn = init_db(&db_dir).unwrap();
    crate::db::source_repo::insert(&conn, &crate::models::Source {
        id: "s1".to_string(),
        path: source_dir.to_str().unwrap().to_string(),
        name: "Source".to_string(),
        sync_mode: "none".to_string(),
        server_path: None,
        archive_prefix: None,
        rating_enabled: true,
    }).unwrap();

    let md_file = source_dir.join("journal.md");
    fs::write(&md_file, "# Day 1\n\nHello world").unwrap();

    let photos = refresh_folder_headless(
        source_dir.to_str().unwrap(),
        &cache_dir,
        &db_path,
    ).unwrap();

    assert_eq!(photos.len(), 1);
    assert_eq!(photos[0].mime_type, "text/markdown");
    assert_eq!(photos[0].title, Some("Day 1".to_string()));
}

