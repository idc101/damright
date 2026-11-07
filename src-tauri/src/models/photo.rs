use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Face {
    pub name: String,
    pub area_x: Option<f64>,
    pub area_y: Option<f64>,
    pub area_w: Option<f64>,
    pub area_h: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Photo {
    pub id: String,
    pub path: String,
    pub thumb_path: String,
    pub exposure: f32,
    pub rating: u8,
    pub rejected: bool,
    pub tags: String,
    pub orientation: u8,
    pub mime_type: String,
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
    #[serde(default)]
    pub faces: Vec<Face>,
    pub crop_top: Option<f64>,
    pub crop_left: Option<f64>,
    pub crop_bottom: Option<f64>,
    pub crop_right: Option<f64>,
    pub crop_angle: Option<f64>,
    pub perceptual_hash: Option<String>,
    pub portrait_blur: Option<f64>,
    #[serde(default = "default_validation_is_valid")]
    pub validation_is_valid: bool,
    #[serde(default)]
    pub validation_issues: String,
    #[serde(default)]
    pub in_quick_collection: bool,
    #[serde(default = "default_rank_score")]
    pub rank_score: f64,
    #[serde(default)]
    pub match_count: u32,
    #[serde(default)]
    pub suggested_rating: u8,
}

fn default_rank_score() -> f64 {
    1500.0
}

fn default_validation_is_valid() -> bool {
    true
}

impl Photo {
    pub fn default_for_test() -> Self {
        Self {
            id: String::new(),
            path: String::new(),
            thumb_path: String::new(),
            exposure: 0.0,
            rating: 0,
            rejected: false,
            tags: String::new(),
            orientation: 1,
            mime_type: "image/jpeg".to_string(),
            width: None,
            height: None,
            file_size: None,
            camera_make: None,
            camera_model: None,
            latitude: None,
            longitude: None,
            capture_time: None,
            city: None,
            state: None,
            country: None,
            location_name: None,
            title: None,
            description: None,
            event: None,
            faces: Vec::new(),
            crop_top: None,
            crop_left: None,
            crop_bottom: None,
            crop_right: None,
            crop_angle: None,
            perceptual_hash: None,
            portrait_blur: None,
            validation_is_valid: true,
            validation_issues: String::new(),
            in_quick_collection: false,
            rank_score: 1500.0,
            match_count: 0,
            suggested_rating: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TagWithCount {
    pub name: String,
    pub count: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PersonWithCount {
    pub name: String,
    pub count: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RankingPair {
    pub photo_a: Photo,
    pub photo_b: Photo,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RankingQuad {
    pub photos: Vec<Photo>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PhotoScoreUpdate {
    pub id: String,
    pub new_score: f64,
    pub new_suggested_rating: u8,
    pub is_winner: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RankingStats {
    pub total_photos: u32,
    pub total_matches: u32,
    pub progress: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RankingMatchResult {
    pub winner_id: String,
    pub winner_score: f64,
    pub winner_suggested_rating: u8,
    pub loser_id: String,
    pub loser_score: f64,
    pub loser_suggested_rating: u8,
}

