use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use anyhow::Result;

use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FolderSyncRule {
    pub mode: String,
    #[serde(default)]
    pub archive_prefix: Option<String>,
    #[serde(default)]
    pub client_path: Option<String>,
    #[serde(default)]
    pub server_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerSyncConfig {
    pub endpoint: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_debounce_minutes")]
    pub debounce_minutes: u64,
    #[serde(default = "default_folder_rules")]
    pub folder_rules: HashMap<String, FolderSyncRule>,
}

impl Default for ServerSyncConfig {
    fn default() -> Self {
        Self {
            endpoint: "http://localhost:8010".to_string(),
            enabled: false,
            debounce_minutes: 30,
            folder_rules: default_folder_rules(),
        }
    }
}

fn default_enabled() -> bool {
    false
}
fn default_debounce_minutes() -> u64 {
    30
}

pub fn default_folder_rules() -> HashMap<String, FolderSyncRule> {
    let mut rules = HashMap::new();

    let pictures_dir = dirs::picture_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.join("Pictures"))
            .unwrap_or_else(|| PathBuf::from("Pictures"))
    });

    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let onedrive_pics = home_dir.join("OneDrive/Pictures");
    let base_sync_dir = if onedrive_pics.exists() {
        onedrive_pics
    } else {
        pictures_dir.clone()
    };

    let inbox_path = pictures_dir.join("Inbox").to_string_lossy().to_string();
    let library_path = base_sync_dir.join("Library").to_string_lossy().to_string();
    let docs_path = base_sync_dir.join("Documents").to_string_lossy().to_string();
    let history_path = base_sync_dir.join("History").to_string_lossy().to_string();

    rules.insert(
        "Inbox".to_string(),
        FolderSyncRule {
            mode: "pull".to_string(),
            archive_prefix: Some("Inbox/archive".to_string()),
            client_path: Some(inbox_path),
            server_path: Some("Inbox".to_string()),
        },
    );
    rules.insert(
        "Library".to_string(),
        FolderSyncRule {
            mode: "push".to_string(),
            archive_prefix: None,
            client_path: Some(library_path),
            server_path: Some("Library".to_string()),
        },
    );
    rules.insert(
        "Documents".to_string(),
        FolderSyncRule {
            mode: "push".to_string(),
            archive_prefix: None,
            client_path: Some(docs_path),
            server_path: Some("Documents".to_string()),
        },
    );
    rules.insert(
        "History".to_string(),
        FolderSyncRule {
            mode: "push".to_string(),
            archive_prefix: None,
            client_path: Some(history_path),
            server_path: Some("History".to_string()),
        },
    );
    rules
}

pub fn ensure_configured_sources(conn: &rusqlite::Connection, config: &AppConfig) -> Result<()> {
    if let Some(ref server_cfg) = config.server_sync {
        let existing_sources = crate::db::source_repo::get_all(conn)?;
        for (node_name, rule) in &server_cfg.folder_rules {
            if let Some(ref client_path_str) = rule.client_path {
                if client_path_str.trim().is_empty() {
                    continue;
                }
                let path = Path::new(client_path_str);
                let _ = fs::create_dir_all(path);

                let already_exists = existing_sources.iter().any(|s| s.path == *client_path_str);
                if !already_exists {
                    let is_inbox = rule.mode == "pull" || node_name.to_lowercase().contains("inbox") || client_path_str.to_lowercase().contains("inbox");
                    let source = crate::models::Source {
                        id: uuid::Uuid::new_v4().to_string(),
                        path: client_path_str.clone(),
                        name: node_name.clone(),
                        sync_mode: rule.mode.clone(),
                        server_path: rule.server_path.clone(),
                        archive_prefix: rule.archive_prefix.clone(),
                        rating_enabled: !is_inbox,
                    };
                    let _ = crate::db::source_repo::insert(conn, &source);
                }
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalConfig {
    #[serde(default)]
    pub library_path: Option<String>,
    #[serde(default)]
    pub cache_path: Option<String>,
    #[serde(default = "default_web_port")]
    pub web_port: u16,
}

impl Default for LocalConfig {
    fn default() -> Self {
        Self {
            library_path: None,
            cache_path: None,
            web_port: 8010,
        }
    }
}

fn default_web_port() -> u16 {
    8010
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AppConfig {
    #[serde(default, alias = "library_s3")]
    pub server_sync: Option<ServerSyncConfig>,
    #[serde(default)]
    pub local: LocalConfig,
}

pub fn get_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("damright")
}

pub fn get_config_path() -> PathBuf {
    get_config_dir().join("config.json")
}

pub fn load_config_from_path(path: &Path) -> Result<AppConfig> {
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(path)?;
    let config: AppConfig = serde_json::from_str(&content)?;
    Ok(config)
}

pub fn load_config() -> Result<AppConfig> {
    load_config_from_path(&get_config_path())
}

pub fn save_config_to_path(config: &AppConfig, path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)?;
    fs::write(path, content)?;
    Ok(())
}

pub fn save_config(config: &AppConfig) -> Result<()> {
    save_config_to_path(config, &get_config_path())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_config_save_load() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("config.json");

        let mut config = AppConfig::default();
        config.server_sync = Some(ServerSyncConfig {
            endpoint: "http://192.168.1.100:8010".to_string(),
            enabled: true,
            debounce_minutes: 15,
            folder_rules: default_folder_rules(),
        });

        save_config_to_path(&config, &file_path).unwrap();

        let loaded = load_config_from_path(&file_path).unwrap();
        assert_eq!(config, loaded);
        assert_eq!(loaded.server_sync.unwrap().debounce_minutes, 15);
    }

    #[test]
    fn test_ensure_configured_sources() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE sources (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                sync_mode TEXT NOT NULL DEFAULT 'none',
                server_path TEXT,
                archive_prefix TEXT,
                rating_enabled INTEGER NOT NULL DEFAULT 1
            )",
            [],
        ).unwrap();

        let mut config = AppConfig::default();
        let inbox_dir = dir.path().join("Inbox");
        let mut rules = HashMap::new();
        rules.insert(
            "Inbox".to_string(),
            FolderSyncRule {
                mode: "pull".to_string(),
                archive_prefix: Some("Inbox/archive".to_string()),
                client_path: Some(inbox_dir.to_string_lossy().to_string()),
                server_path: Some("Inbox".to_string()),
            },
        );
        config.server_sync = Some(ServerSyncConfig {
            endpoint: "http://localhost:8010".to_string(),
            enabled: true,
            debounce_minutes: 30,
            folder_rules: rules,
        });

        ensure_configured_sources(&conn, &config).unwrap();

        let sources = crate::db::source_repo::get_all(&conn).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].name, "Inbox");
        assert_eq!(sources[0].path, inbox_dir.to_string_lossy().to_string());
        assert!(inbox_dir.exists());
    }
}
