use std::path::Path;
use crate::models::Photo;

pub trait ImageProcessor: Send + Sync {
    /// Generate a thumbnail for a photo.
    /// Typically small (e.g. 400px) and might skip some high-quality adjustments for speed.
    fn generate_thumbnail(&self, photo: &Photo, output_path: &Path) -> anyhow::Result<()>;

    /// Generate a preview for a photo.
    /// Typically medium (e.g. 2048px) and should include basic adjustments.
    fn generate_preview(&self, photo: &Photo, output_path: &Path, uncropped: bool) -> anyhow::Result<()>;

    /// Full processing of an image with all adjustments applied (exposure, orientation, crop).
    /// Used for export or high-quality viewing.
    fn process_image(
        &self,
        photo: &Photo,
        output_path: &Path,
        target_size: Option<(u32, u32)>,
    ) -> anyhow::Result<()>;

    /// Generate a perceptual hash for a photo.
    fn generate_perceptual_hash(&self, photo: &Photo) -> anyhow::Result<String>;
}
