#[cfg(target_os = "macos")]
use std::process::Command;
use std::path::Path;
use crate::models::Photo;
use crate::processing::image::traits::ImageProcessor;
use crate::processing::image::rust_processor::RustImageProcessor;

pub struct SipsImageProcessor;

impl ImageProcessor for SipsImageProcessor {
    fn generate_thumbnail(&self, photo: &Photo, output_path: &Path) -> anyhow::Result<()> {
        #[cfg(target_os = "macos")]
        {
            let status = Command::new("sips")
                .arg("-Z")
                .arg("400")
                .arg("-s")
                .arg("format")
                .arg("jpeg")
                .arg(&photo.path)
                .arg("--out")
                .arg(output_path)
                .status()?;
            
            if status.success() {
                return Ok(());
            }
        }
        anyhow::bail!("Sips thumbnail generation failed or not supported on this OS")
    }

    fn generate_preview(&self, photo: &Photo, output_path: &Path, _uncropped: bool) -> anyhow::Result<()> {
        #[cfg(target_os = "macos")]
        {
            let status = Command::new("sips")
                .arg("-Z")
                .arg("2048")
                .arg("-s")
                .arg("format")
                .arg("jpeg")
                .arg(&photo.path)
                .arg("--out")
                .arg(output_path)
                .status()?;
            
            if status.success() {
                return Ok(());
            }
        }
        anyhow::bail!("Sips preview generation failed or not supported on this OS")
    }

    fn process_image(
        &self,
        _photo: &Photo,
        _output_path: &Path,
        _target_size: Option<(u32, u32)>,
    ) -> anyhow::Result<()> {
        // Sips is less flexible for full processing with adjustments
        anyhow::bail!("Sips full processing not implemented")
    }

    fn generate_perceptual_hash(&self, photo: &Photo) -> anyhow::Result<String> {
        // Delegate to RustImageProcessor for hashing as sips doesn't support it
        RustImageProcessor.generate_perceptual_hash(photo)
    }
}
