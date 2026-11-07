use anyhow::{anyhow, Result};
use reqwest::header::CONTENT_TYPE;
use reqwest::Client;
use std::time::Duration;
use crate::sync::config::ServerSyncConfig;

pub async fn test_damright_server_connection(server_url: &str) -> Result<bool> {
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;

    let base = server_url.trim_end_matches('/');
    let url = if base.contains("/api/") {
        base.to_string()
    } else {
        format!("{}/api/sources", base)
    };

    let res = client.get(&url).send().await?;
    if res.status().is_success() {
        Ok(true)
    } else {
        Err(anyhow!(
            "DamRight server test failed with HTTP status: {}",
            res.status()
        ))
    }
}

pub async fn resolve_working_server_url(endpoint: &str) -> String {
    let parsed_url = reqwest::Url::parse(endpoint);
    let (scheme, host, port) = if let Ok(ref u) = parsed_url {
        let h = u.host_str().unwrap_or("localhost").to_string();
        let s = u.scheme().to_string();
        let p = u.port().unwrap_or(8010);
        (s, h, p)
    } else {
        ("http".to_string(), "localhost".to_string(), 8010)
    };

    let primary_url = format!("{}://{}:{}", scheme, host, port);
    if test_damright_server_connection(&primary_url).await.unwrap_or(false) {
        return primary_url;
    }

    if port != 8010 {
        let fallback_url = format!("{}://{}:8010", scheme, host);
        if test_damright_server_connection(&fallback_url).await.unwrap_or(false) {
            println!("Server Client: Connection to '{}' failed; successfully connected to fallback port 8010 at '{}'", primary_url, fallback_url);
            return fallback_url;
        }
    }

    primary_url
}

pub async fn test_server_config(config: &ServerSyncConfig) -> Result<bool> {
    let server_url = resolve_working_server_url(&config.endpoint).await;
    test_damright_server_connection(&server_url).await
}

use std::path::Path;
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;
use futures_util::StreamExt;

pub async fn upload_file_from_path(
    server_url: &str,
    key: &str,
    file_path: &Path,
    mtime: i64,
) -> Result<()> {
    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .pool_max_idle_per_host(10)
        .build()?;

    let base = server_url.trim_end_matches('/');
    let mut url = reqwest::Url::parse(&format!("{}/api/sync/upload", base))?;
    url.query_pairs_mut()
        .append_pair("path", key)
        .append_pair("mtime", &mtime.to_string());

    let mut attempts = 0;
    let max_attempts = 3;

    loop {
        attempts += 1;
        let file = tokio::fs::File::open(file_path).await?;
        let stream = ReaderStream::new(file);
        let body = reqwest::Body::wrap_stream(stream);

        let res = client
            .post(url.clone())
            .header(CONTENT_TYPE, "application/octet-stream")
            .body(body)
            .send()
            .await;

        match res {
            Ok(resp) => {
                if resp.status().is_success() {
                    return Ok(());
                } else {
                    let status = resp.status();
                    let err_text = resp.text().await.unwrap_or_default();
                    if attempts >= max_attempts {
                        return Err(anyhow!(
                            "Failed to upload file '{}' to server (HTTP {}): {}",
                            key,
                            status,
                            err_text
                        ));
                    }
                }
            }
            Err(e) => {
                if attempts >= max_attempts {
                    return Err(anyhow!("Failed to upload file '{}' to server: {}", key, e));
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}


pub async fn notify_server_of_updates(
    server_endpoint: &str,
    updated_paths: &[String],
) -> Result<()> {
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    let url = format!("{}/api/sync/notify", server_endpoint.trim_end_matches('/'));
    let body = serde_json::json!({
        "updated_paths": updated_paths
    });

    let res = client.post(&url).json(&body).send().await?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(anyhow!("Server notification failed: HTTP {}", res.status()))
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ServerFileInfo {
    pub path: String,
    pub size: i64,
    pub mtime: i64,
}

pub async fn list_server_folder(
    server_url: &str,
    folder: &str,
) -> Result<Vec<ServerFileInfo>> {
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    let base = server_url.trim_end_matches('/');
    let mut url = reqwest::Url::parse(&format!("{}/api/sync/list", base))?;
    url.query_pairs_mut().append_pair("folder", folder);

    let res = client.get(url).send().await?;
    if res.status().is_success() {
        let items = res.json::<Vec<ServerFileInfo>>().await?;
        Ok(items)
    } else {
        Err(anyhow!("Failed to list server folder '{}': HTTP {}", folder, res.status()))
    }
}

pub async fn download_file_to_path(
    server_url: &str,
    key: &str,
    dest_path: &Path,
) -> Result<()> {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .pool_max_idle_per_host(10)
        .build()?;

    let base = server_url.trim_end_matches('/');
    let mut url = reqwest::Url::parse(&format!("{}/api/sync/download", base))?;
    url.query_pairs_mut().append_pair("path", key);

    let res = client.get(url).send().await?;
    if !res.status().is_success() {
        return Err(anyhow!("Failed to download file '{}' from server: HTTP {}", key, res.status()));
    }

    if let Some(parent) = dest_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let temp_dest = dest_path.with_extension(format!("tmp-dl-{}", uuid::Uuid::new_v4()));
    let mut file = tokio::fs::File::create(&temp_dest).await?;
    let mut stream = res.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| anyhow!("Download stream error for '{}': {}", key, e))?;
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    drop(file);

    tokio::fs::rename(&temp_dest, dest_path).await?;
    Ok(())
}


pub async fn delete_file_from_server(
    server_url: &str,
    key: &str,
) -> Result<()> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    let base = server_url.trim_end_matches('/');
    let mut url = reqwest::Url::parse(&format!("{}/api/sync/delete", base))?;
    url.query_pairs_mut().append_pair("path", key);

    let res = client.post(url).send().await?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(anyhow!("Failed to delete file '{}' from server: HTTP {}", key, res.status()))
    }
}

pub async fn move_folder_on_server(
    server_url: &str,
    src: &str,
    dest: &str,
) -> Result<()> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    let base = server_url.trim_end_matches('/');
    let url = format!("{}/api/sync/move", base);
    let body = serde_json::json!({
        "src": src,
        "dest": dest,
    });

    let res = client.post(&url).json(&body).send().await?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(anyhow!("Failed to move folder on server ({} -> {}): HTTP {}", src, dest, res.status()))
    }
}



#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_server_config_invalid_url() {
        let cfg = ServerSyncConfig {
            endpoint: "http://invalid-host-99999.local:8010".to_string(),
            enabled: true,
            debounce_minutes: 30,
            folder_rules: Default::default(),
        };
        assert!(test_server_config(&cfg).await.is_err());
    }
}
