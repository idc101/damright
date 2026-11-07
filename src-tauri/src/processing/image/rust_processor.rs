use std::path::Path;
use image::{DynamicImage, ImageBuffer, Rgb, GenericImageView};
use fast_image_resize as fr;
use image_hasher::{HasherConfig, HashAlg};
use heic::{DecoderConfig, PixelLayout};
use crate::models::Photo;
use crate::processing::image::traits::ImageProcessor;
use crate::processing::image::apply_orientation;

pub struct RustImageProcessor;

impl RustImageProcessor {
    fn is_auto_rotated(&self, path: &Path) -> bool {
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        // heic crate handles container transformations (irot/imir/clap) on HEIC/HEIF images
        ext == "heic" || ext == "heif"
    }

    fn decode_heic_from_bytes(&self, data: &[u8]) -> anyhow::Result<DynamicImage> {
        let decoder = DecoderConfig::new();
        let decoded = decoder
            .decode_request(data)
            .with_output_layout(PixelLayout::Rgb8)
            .decode()
            .map_err(|e| anyhow::anyhow!("HEIC decode error: {}", e))?;

        let buffer = ImageBuffer::<Rgb<u8>, _>::from_raw(decoded.width, decoded.height, decoded.data)
            .ok_or_else(|| anyhow::anyhow!("Failed to construct RgbImage from decoded pixel buffer"))?;

        Ok(DynamicImage::ImageRgb8(buffer))
    }

    pub fn load_image(&self, path: &Path) -> anyhow::Result<DynamicImage> {
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if ext == "heic" || ext == "heif" {
            if let Ok(data) = std::fs::read(path) {
                if let Ok(img) = self.decode_heic_from_bytes(&data) {
                    return Ok(img);
                }
            }
            let temp_dir = std::env::temp_dir();
            let temp_file = temp_dir.join(format!("heic_conv_{}.jpg", uuid::Uuid::new_v4()));
            let ffmpeg_bin = dirs::home_dir()
                .map(|h| h.join(".local/bin/ffmpeg"))
                .filter(|p| p.exists())
                .unwrap_or_else(|| std::path::PathBuf::from("ffmpeg"));
            let mut cmd = std::process::Command::new(ffmpeg_bin);
            cmd.arg("-i")
                .arg(path)
                .arg("-map")
                .arg("0:v:0")
                .arg("-vframes")
                .arg("1")
                .arg("-y")
                .arg(&temp_file);
            if let Ok(output) = crate::processing::run_command_with_timeout(&mut cmd, std::time::Duration::from_secs(10)) {
                if output.status.success() && temp_file.exists() {
                    let decoded = image::open(&temp_file);
                    let _ = std::fs::remove_file(temp_file);
                    if let Ok(img) = decoded {
                        return Ok(img);
                    }
                }
            }
        }

        let img = image::ImageReader::open(path)?
            .with_guessed_format()?
            .decode()?;
        Ok(img)
    }

    fn extract_depth_map(&self, path: &Path) -> Option<DynamicImage> {
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if ext != "heic" && ext != "heif" {
            return None;
        }

        let data = std::fs::read(path).ok()?;
        let decoder = DecoderConfig::new();
        let depth_map = decoder.decode_depth(&data).ok()?;

        let shift = if depth_map.bit_depth > 8 {
            depth_map.bit_depth - 8
        } else {
            0
        };

        let luma_bytes: Vec<u8> = depth_map
            .data
            .into_iter()
            .map(|v| (v >> shift) as u8)
            .collect();

        let buffer = ImageBuffer::<image::Luma<u8>, _>::from_raw(
            depth_map.width,
            depth_map.height,
            luma_bytes,
        )?;

        Some(DynamicImage::ImageLuma8(buffer))
    }

    pub fn apply_adjustments(&self, mut img: DynamicImage, photo: &Photo, include_crop: bool) -> DynamicImage {
        // 1. Orientation (only if not already rotated by loader)
        if !self.is_auto_rotated(Path::new(&photo.path)) {
            img = apply_orientation(img, photo.orientation);
        }

        // 2. Exposure (Simple brightness for now)
        if photo.exposure != 0.0 {
            let val = (photo.exposure * 255.0) as i32;
            img = img.brighten(val);
        }

        // 3. Depth / Portrait Blur
        if let Some(blur_val) = photo.portrait_blur {
            if blur_val > 0.0 {
                let (width, height) = img.dimensions();
                let sigma = (blur_val * 12.0) as f32;
                let blurred = img.blur(sigma);

                let depth_mask = self.extract_depth_map(Path::new(&photo.path));

                let mut rgba = img.to_rgba8();
                let blurred_rgba = blurred.to_rgba8();

                if let Some(mask) = depth_mask {
                    let resized_mask = mask.resize_exact(width, height, image::imageops::FilterType::Triangle).to_luma8();
                    for y in 0..height {
                        for x in 0..width {
                            let depth_val = resized_mask.get_pixel(x, y).0[0] as f32 / 255.0;
                            let factor = (depth_val * blur_val as f32).clamp(0.0, 1.0);
                            let orig_p = rgba.get_pixel(x, y);
                            let blur_p = blurred_rgba.get_pixel(x, y);

                            let r = ((1.0 - factor) * orig_p[0] as f32 + factor * blur_p[0] as f32) as u8;
                            let g = ((1.0 - factor) * orig_p[1] as f32 + factor * blur_p[1] as f32) as u8;
                            let b = ((1.0 - factor) * orig_p[2] as f32 + factor * blur_p[2] as f32) as u8;
                            rgba.put_pixel(x, y, image::Rgba([r, g, b, orig_p[3]]));
                        }
                    }
                } else {
                    let cx = width as f32 / 2.0;
                    let cy = height as f32 / 2.0;
                    let max_dist = (cx * cx + cy * cy).sqrt();
                    for y in 0..height {
                        for x in 0..width {
                            let dx = x as f32 - cx;
                            let dy = y as f32 - cy;
                            let dist = (dx * dx + dy * dy).sqrt();
                            let depth_factor = ((dist / max_dist).powf(1.5) * blur_val as f32).clamp(0.0, 1.0);
                            let orig_p = rgba.get_pixel(x, y);
                            let blur_p = blurred_rgba.get_pixel(x, y);

                            let r = ((1.0 - depth_factor) * orig_p[0] as f32 + depth_factor * blur_p[0] as f32) as u8;
                            let g = ((1.0 - depth_factor) * orig_p[1] as f32 + depth_factor * blur_p[1] as f32) as u8;
                            let b = ((1.0 - depth_factor) * orig_p[2] as f32 + depth_factor * blur_p[2] as f32) as u8;
                            rgba.put_pixel(x, y, image::Rgba([r, g, b, orig_p[3]]));
                        }
                    }
                }
                img = DynamicImage::ImageRgba8(rgba);
            }
        }

        // 4. Crop
        if include_crop {
            if let (Some(top), Some(left), Some(bottom), Some(right)) = 
                (photo.crop_top, photo.crop_left, photo.crop_bottom, photo.crop_right) 
            {
                let (width, height) = img.dimensions();
                let mut x = (left * width as f64).round() as u32;
                let mut y = (top * height as f64).round() as u32;
                let mut w = ((right - left) * width as f64).round() as u32;
                let mut h = ((bottom - top) * height as f64).round() as u32;
                
                // Clamp coordinates to image dimensions to avoid panics
                if x >= width {
                    x = width.saturating_sub(1);
                }
                if y >= height {
                    y = height.saturating_sub(1);
                }
                if x + w > width {
                    w = width.saturating_sub(x);
                }
                if y + h > height {
                    h = height.saturating_sub(y);
                }
                
                if w > 0 && h > 0 {
                    img = img.crop_imm(x, y, w, h);
                }
            }

            // 4. Crop Angle / Rotation
            if let Some(angle) = photo.crop_angle {
                let normalized_angle = ((angle as i32 % 360) + 360) % 360;
                img = match normalized_angle {
                    90 => img.rotate90(),
                    180 => img.rotate180(),
                    270 => img.rotate270(),
                    _ => img,
                };
            }
        }

        img
    }

    fn resize_image(&self, img: DynamicImage, width: u32, height: u32, high_quality: bool) -> anyhow::Result<DynamicImage> {
        let has_alpha = img.color().has_alpha();
        let img = if has_alpha {
            DynamicImage::ImageRgba8(img.into_rgba8())
        } else {
            DynamicImage::ImageRgb8(img.into_rgb8())
        };

        let pixel_type = match &img {
            DynamicImage::ImageRgb8(_) => fr::PixelType::U8x3,
            DynamicImage::ImageRgba8(_) => fr::PixelType::U8x4,
            _ => unreachable!(),
        };

        let mut dst_image = fr::images::Image::new(width, height, pixel_type);
        let mut resizer = fr::Resizer::new();
        
        // Use CatmullRom for fast thumbnails, Lanczos3 for high-quality previews
        let filter = if high_quality {
            fr::FilterType::Lanczos3
        } else {
            fr::FilterType::CatmullRom
        };
        
        let options = fr::ResizeOptions::new().resize_alg(fr::ResizeAlg::Convolution(filter));

        resizer.resize(&img, &mut dst_image, Some(&options))
            .map_err(|e| anyhow::anyhow!("Resize error: {:?}", e))?;

        let res = match pixel_type {
            fr::PixelType::U8x3 => {
                let buffer = ImageBuffer::<Rgb<u8>, _>::from_raw(width, height, dst_image.into_vec())
                    .ok_or_else(|| anyhow::anyhow!("Failed to create image buffer"))?;
                Ok(DynamicImage::ImageRgb8(buffer))
            }
            fr::PixelType::U8x4 => {
                let buffer = ImageBuffer::<image::Rgba<u8>, _>::from_raw(width, height, dst_image.into_vec())
                    .ok_or_else(|| anyhow::anyhow!("Failed to create image buffer"))?;
                Ok(DynamicImage::ImageRgba8(buffer))
            }
            _ => unreachable!()
        };
        res
    }
}





impl ImageProcessor for RustImageProcessor {
    fn generate_thumbnail(&self, photo: &Photo, output_path: &Path) -> anyhow::Result<()> {
        let mut img = self.load_image(Path::new(&photo.path))?;
        
        // Apply adjustments (orientation, exposure, crop, crop_angle)
        img = self.apply_adjustments(img, photo, true);
        
        let (w, h) = img.dimensions();
        let (tw, th) = if w > h {
            (400, (400 * h) / w)
        } else {
            ((400 * w) / h, 400)
        };

        let thumb = self.resize_image(img, tw, th, false)?;
        if let Some(parent) = output_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        thumb.save(output_path)?;
        Ok(())
    }

    fn generate_preview(&self, photo: &Photo, output_path: &Path, uncropped: bool) -> anyhow::Result<()> {
        let mut img = self.load_image(Path::new(&photo.path))?;
        
        // Apply adjustments (including crop if not uncropped)
        img = self.apply_adjustments(img, photo, !uncropped);
        
        let (w, h) = img.dimensions();
        let (pw, ph) = if w > h {
            (2048, (2048 * h) / w)
        } else {
            ((2048 * w) / h, 2048)
        };

        let preview = self.resize_image(img, pw, ph, true)?;
        if let Some(parent) = output_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        preview.save(output_path)?;
        Ok(())
    }

    fn process_image(
        &self,
        photo: &Photo,
        output_path: &Path,
        target_size: Option<(u32, u32)>,
    ) -> anyhow::Result<()> {
        let mut img = self.load_image(Path::new(&photo.path))?;
        img = self.apply_adjustments(img, photo, true);
        
        if let Some((w, h)) = target_size {
            img = self.resize_image(img, w, h, true)?;
        }
        
        if let Some(parent) = output_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        img.save(output_path)?;
        Ok(())
    }

    fn generate_perceptual_hash(&self, photo: &Photo) -> anyhow::Result<String> {
        let mut img = self.load_image(Path::new(&photo.path))?;
        
        // Normalize orientation for consistent hashing
        if !self.is_auto_rotated(Path::new(&photo.path)) {
            img = apply_orientation(img, photo.orientation);
        }
        
        let hasher = HasherConfig::new()
            .hash_alg(HashAlg::Gradient)
            .hash_size(8, 8)
            .to_hasher();
            
        let hash = hasher.hash_image(&img);
        Ok(hash.to_base64())
    }
}


