use super::rust_processor::RustImageProcessor;
use super::traits::ImageProcessor;
use crate::models::Photo;
use image::{DynamicImage, RgbImage, Rgb};
use tempfile::tempdir;
use std::path::Path;

fn create_test_image(path: &Path, width: u32, height: u32) {
    let mut img = RgbImage::new(width, height);
    // Fill with a pattern so we can verify crop
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        if x < width / 2 && y < height / 2 {
            *pixel = Rgb([255, 0, 0]); // Red top-left
        } else if x >= width / 2 && y < height / 2 {
            *pixel = Rgb([0, 255, 0]); // Green top-right
        } else if x < width / 2 && y >= height / 2 {
            *pixel = Rgb([0, 0, 255]); // Blue bottom-left
        } else {
            *pixel = Rgb([255, 255, 255]); // White bottom-right
        }
    }
    DynamicImage::ImageRgb8(img).save(path).unwrap();
}

#[test]
fn test_rust_processor_thumbnail() {
    let dir = tempdir().unwrap();
    let input_path = dir.path().join("input.jpg");
    let output_path = dir.path().join("thumb.jpg");
    create_test_image(&input_path, 1000, 1000);

    let photo = Photo {
        id: "test".to_string(),
        path: input_path.to_string_lossy().to_string(),
        width: Some(1000),
        height: Some(1000),
        ..Photo::default_for_test()
    };

    let processor = RustImageProcessor;
    processor.generate_thumbnail(&photo, &output_path).unwrap();

    assert!(output_path.exists());
    let thumb = image::open(output_path).unwrap();
    assert!(thumb.width() <= 400);
    assert!(thumb.height() <= 400);
}

#[test]
fn test_rust_processor_crop() {
    let dir = tempdir().unwrap();
    let input_path = dir.path().join("input.png");
    let output_path = dir.path().join("cropped.png");
    create_test_image(&input_path, 100, 100);

    let photo = Photo {
        id: "test".to_string(),
        path: input_path.to_string_lossy().to_string(),
        mime_type: "image/png".to_string(),
        width: Some(100),
        height: Some(100),
        crop_top: Some(0.0),
        crop_left: Some(0.0),
        crop_bottom: Some(0.5),
        crop_right: Some(0.5),
        ..Photo::default_for_test()
    };

    let processor = RustImageProcessor;
    // Process image with 0.5x0.5 crop (should be red quadrant)
    processor.process_image(&photo, &output_path, None).unwrap();

    assert!(output_path.exists());
    let cropped = image::open(output_path).unwrap();
    assert_eq!(cropped.width(), 50);
    assert_eq!(cropped.height(), 50);
    
    // Verify it's red (from top-left quadrant)
    let rgb = cropped.to_rgb8();
    let pixel = rgb.get_pixel(10, 10);
    assert_eq!(pixel.0[0], 255);
    assert_eq!(pixel.0[1], 0);
    assert_eq!(pixel.0[2], 0);
}

#[test]
fn test_rust_processor_exposure() {
    let dir = tempdir().unwrap();
    let input_path = dir.path().join("input.jpg");
    let output_path = dir.path().join("exposed.jpg");
    
    // Create a gray image
    let mut img = RgbImage::new(10, 10);
    for p in img.pixels_mut() {
        *p = Rgb([100, 100, 100]);
    }
    DynamicImage::ImageRgb8(img).save(&input_path).unwrap();

    let photo = Photo {
        id: "test".to_string(),
        path: input_path.to_string_lossy().to_string(),
        exposure: 1.0, // +1.0 exposure
        width: Some(10),
        height: Some(10),
        ..Photo::default_for_test()
    };

    let processor = RustImageProcessor;
    processor.process_image(&photo, &output_path, None).unwrap();

    let exposed = image::open(output_path).unwrap().to_rgb8();
    let pixel = exposed.get_pixel(0, 0);
    // Original was 100. +1.0 exposure (brighten(255)) should hit 255.
    assert!(pixel.0[0] > 100);
}

#[test]
fn test_rust_processor_hash() {
    let dir = tempdir().unwrap();
    let img1_path = dir.path().join("img1.jpg");
    let img2_path = dir.path().join("img2.jpg");
    
    create_test_image(&img1_path, 100, 100);
    // Create a slightly different image
    let mut img2 = RgbImage::new(100, 100);
    for p in img2.pixels_mut() {
        *p = Rgb([255, 255, 255]);
    }
    DynamicImage::ImageRgb8(img2).save(&img2_path).unwrap();

    let photo1 = Photo {
        path: img1_path.to_string_lossy().to_string(),
        ..Photo::default_for_test()
    };
    let photo2 = Photo {
        path: img2_path.to_string_lossy().to_string(),
        ..Photo::default_for_test()
    };

    let processor = RustImageProcessor;
    let hash1 = processor.generate_perceptual_hash(&photo1).unwrap();
    let hash2 = processor.generate_perceptual_hash(&photo2).unwrap();

    assert!(!hash1.is_empty());
    assert!(!hash2.is_empty());
    assert_ne!(hash1, hash2);
    
    // Hash of the same image should be identical
    let hash1_again = processor.generate_perceptual_hash(&photo1).unwrap();
    assert_eq!(hash1, hash1_again);
}

#[test]
fn test_mismatched_extension() {
    let dir = tempdir().unwrap();
    // Create a valid PNG image but name it with a .jpg extension
    let input_path = dir.path().join("input.jpg");
    let output_path = dir.path().join("thumb.jpg");
    
    let mut img = RgbImage::new(100, 100);
    for p in img.pixels_mut() {
        *p = Rgb([0, 128, 0]);
    }
    // Save explicitly as PNG format
    DynamicImage::ImageRgb8(img).save_with_format(&input_path, image::ImageFormat::Png).unwrap();

    let photo = Photo {
        id: "test".to_string(),
        path: input_path.to_string_lossy().to_string(),
        width: Some(100),
        height: Some(100),
        ..Photo::default_for_test()
    };

    let processor = RustImageProcessor;
    // This should not fail because with_guessed_format() detects it as PNG despite the .jpg extension
    let res = processor.generate_thumbnail(&photo, &output_path);
    assert!(res.is_ok(), "Failed to generate thumbnail for mismatched extension: {:?}", res.err());
    assert!(output_path.exists());
}

#[test]
fn test_rgba_preview() {
    let dir = tempdir().unwrap();
    let input_path = dir.path().join("input.png");
    let output_path = dir.path().join("preview.jpg");
    
    // Create an RGBA image
    let mut img = image::RgbaImage::new(100, 100);
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        *pixel = image::Rgba([x as u8, y as u8, 0, 255]);
    }
    DynamicImage::ImageRgba8(img).save(&input_path).unwrap();

    let photo = Photo {
        id: "test".to_string(),
        path: input_path.to_string_lossy().to_string(),
        mime_type: "image/png".to_string(),
        width: Some(100),
        height: Some(100),
        ..Photo::default_for_test()
    };

    let processor = RustImageProcessor;
    processor.generate_preview(&photo, &output_path, true).unwrap();
    assert!(output_path.exists());
}

#[test]
fn test_luma_preview() {
    let dir = tempdir().unwrap();
    let input_path = dir.path().join("input.png");
    let output_path = dir.path().join("preview.jpg");
    
    // Create a Grayscale (Luma) image
    let mut img = image::GrayImage::new(100, 100);
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        *pixel = image::Luma([(x + y) as u8]);
    }
    DynamicImage::ImageLuma8(img).save(&input_path).unwrap();

    let photo = Photo {
        id: "test".to_string(),
        path: input_path.to_string_lossy().to_string(),
        mime_type: "image/png".to_string(),
        width: Some(100),
        height: Some(100),
        ..Photo::default_for_test()
    };

    let processor = RustImageProcessor;
    processor.generate_preview(&photo, &output_path, true).unwrap();
    assert!(output_path.exists());
}


