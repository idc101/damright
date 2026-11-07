use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct Source {
    pub id: String,
    pub path: String,
    pub name: String,
    #[serde(default = "default_sync_mode")]
    pub sync_mode: String,
    #[serde(default)]
    pub server_path: Option<String>,
    #[serde(default)]
    pub archive_prefix: Option<String>,
    #[serde(default = "default_rating_enabled")]
    pub rating_enabled: bool,
}

fn default_sync_mode() -> String {
    "none".to_string()
}

fn default_rating_enabled() -> bool {
    true
}
