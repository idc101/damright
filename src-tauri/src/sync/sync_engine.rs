use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use anyhow::{anyhow, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::db::init_db;
use crate::db::source_repo::get_all as get_all_sources;
use crate::db::sync_state_repo::{get_all_sync_states, remove_sync_state, set_sync_states_batch, SyncStateRecord};
use crate::sync::config::AppConfig;
use crate::sync::server_client::{
    delete_file_from_server, download_file_to_path, list_server_folder, notify_server_of_updates,
    upload_file_from_path,
};

pub fn is_ignored_path(path: &std::path::Path) -> bool {
    if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
        if filename.starts_with('.') {
            return true;
        }
        let lower = filename.to_lowercase();
        if lower == ".ds_store"
            || lower == "thumbs.db"
            || lower == "desktop.ini"
            || lower == "node_modules"
            || lower == "__pycache__"
            || lower == "target"
            || lower == "dist"
            || lower == "build"
            || lower.ends_with(".tmp")
            || lower.ends_with(".bak")
        {
            return true;
        }
    }
    false
}

pub fn normalize_path_str(path: &std::path::Path) -> String {
    let s = path.to_string_lossy();
    s.trim_end_matches('/')
        .trim_end_matches('\\')
        .replace('\\', "/")
        .to_lowercase()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SyncStateStatus {
    Idle,
    Debouncing { remaining_secs: u64 },
    Scanning {
        #[serde(default)]
        current_step: String,
        #[serde(default)]
        files_scanned: usize,
        #[serde(default)]
        current_folder: String,
    },
    Syncing {
        files_done: usize,
        total_files: usize,
        bytes_done: u64,
        total_bytes: u64,
        #[serde(default)]
        bytes_per_sec: u64,
        current_file: String,
    },
    Success {
        last_sync_time: String,
        files_synced: usize,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEngineStatus {
    pub stage: SyncStateStatus,
    pub enabled: bool,
    pub debounce_minutes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleDiagnostic {
    pub name: String,
    pub path: String,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncDiagnostics {
    pub total_files: usize,
    pub total_bytes: u64,
    pub rules_breakdown: Vec<RuleDiagnostic>,
    pub extension_counts: Vec<(String, usize)>,
    pub sample_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PullTask {
    pub node_name: String,
    pub server_path: String,
    pub size: i64,
    pub mtime: i64,
    pub local_target: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PushTask {
    pub abs_path: PathBuf,
    pub rel_path: String,
    pub file_size: i64,
    pub mtime: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeleteTask {
    pub rel_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SyncPlan {
    pub server_url: String,
    pub pull_tasks: Vec<PullTask>,
    pub push_tasks: Vec<PushTask>,
    pub delete_tasks: Vec<DeleteTask>,
    pub pulled_source_paths: Vec<String>,
    pub total_files: usize,
    pub total_bytes: u64,
}

pub struct SyncEngine {
    app_dir: PathBuf,
    config: Arc<Mutex<AppConfig>>,
    status: Arc<Mutex<SyncStateStatus>>,
    is_syncing: Arc<std::sync::atomic::AtomicBool>,
    remaining_secs: Arc<std::sync::atomic::AtomicU64>,
}

impl SyncEngine {
    pub fn new(app_dir: PathBuf, config: AppConfig) -> Self {
        let initial_debounce_secs = config
            .server_sync
            .as_ref()
            .map(|s| s.debounce_minutes.max(1) * 60)
            .unwrap_or(1800);

        let engine = Self {
            app_dir,
            config: Arc::new(Mutex::new(config)),
            status: Arc::new(Mutex::new(SyncStateStatus::Idle)),
            is_syncing: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            remaining_secs: Arc::new(std::sync::atomic::AtomicU64::new(initial_debounce_secs)),
        };

        engine.spawn_background_worker();
        engine
    }

    fn spawn_background_worker(&self) {
        if tokio::runtime::Handle::try_current().is_err() {
            return;
        }

        let config_arc = self.config.clone();
        let status_arc = self.status.clone();
        let is_syncing_arc = self.is_syncing.clone();
        let remaining_secs_arc = self.remaining_secs.clone();
        let app_dir = self.app_dir.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
            // First tick completes immediately
            interval.tick().await;

            loop {
                interval.tick().await;

                let (enabled, debounce_minutes) = {
                    let cfg = config_arc.lock().unwrap();
                    if let Some(ref s) = cfg.server_sync {
                        (s.enabled, s.debounce_minutes)
                    } else {
                        (false, 30)
                    }
                };

                if !enabled {
                    let mut st = status_arc.lock().unwrap();
                    if matches!(*st, SyncStateStatus::Debouncing { .. }) {
                        *st = SyncStateStatus::Idle;
                    }
                    continue;
                }

                if is_syncing_arc.load(std::sync::atomic::Ordering::SeqCst) {
                    continue;
                }

                let cur_rem = remaining_secs_arc.load(std::sync::atomic::Ordering::SeqCst);
                if cur_rem > 1 {
                    let new_rem = cur_rem - 1;
                    remaining_secs_arc.store(new_rem, std::sync::atomic::Ordering::SeqCst);
                    let mut st = status_arc.lock().unwrap();
                    *st = SyncStateStatus::Debouncing { remaining_secs: new_rem };
                } else if cur_rem <= 1 {
                    let full_debounce_secs = debounce_minutes.max(1) * 60;
                    remaining_secs_arc.store(full_debounce_secs, std::sync::atomic::Ordering::SeqCst);

                    let sub_engine = SyncEngine {
                        app_dir: app_dir.clone(),
                        config: config_arc.clone(),
                        status: status_arc.clone(),
                        is_syncing: is_syncing_arc.clone(),
                        remaining_secs: remaining_secs_arc.clone(),
                    };

                    tokio::spawn(async move {
                        let _ = sub_engine.run_sync_now().await;
                    });
                }
            }
        });
    }

    pub fn get_status(&self) -> SyncEngineStatus {
        let cfg = self.config.lock().unwrap();
        let (enabled, debounce_minutes) = if let Some(ref s) = cfg.server_sync {
            (s.enabled, s.debounce_minutes)
        } else {
            (false, 30)
        };

        SyncEngineStatus {
            stage: self.status.lock().unwrap().clone(),
            enabled,
            debounce_minutes,
        }
    }

    pub fn update_config(&self, new_config: AppConfig) {
        let debounce_secs = new_config
            .server_sync
            .as_ref()
            .map(|s| s.debounce_minutes.max(1) * 60)
            .unwrap_or(1800);
        self.remaining_secs.store(debounce_secs, std::sync::atomic::Ordering::SeqCst);
        let mut cfg = self.config.lock().unwrap();
        *cfg = new_config;
    }

    pub fn get_diagnostics(&self, db_state: &crate::DbState) -> Result<SyncDiagnostics> {
        let conn = db_state.0.lock().unwrap();
        let sources = get_all_sources(&conn)?;

        let mut rules_breakdown = Vec::new();
        let mut ext_map: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        let mut sample_files = Vec::new();
        let mut total_files = 0;
        let mut total_bytes = 0u64;

        for src in &sources {
            let src_path = PathBuf::from(&src.path);
            let mode = src.sync_mode.as_str();

            if mode == "pull" {
                rules_breakdown.push(RuleDiagnostic {
                    name: format!("{} (Pull)", src.name),
                    path: src.path.clone(),
                    file_count: 0,
                    total_bytes: 0,
                });
                continue;
            }

            if mode != "push" {
                rules_breakdown.push(RuleDiagnostic {
                    name: format!("{} (Local)", src.name),
                    path: src.path.clone(),
                    file_count: 0,
                    total_bytes: 0,
                });
                continue;
            }

            if !src_path.exists() {
                continue;
            }

            let mut count = 0;
            let mut source_bytes = 0u64;

            for entry in WalkDir::new(&src_path)
                .into_iter()
                .filter_entry(|e| !is_ignored_path(e.path()))
                .filter_map(|e| e.ok())
            {
                let path = entry.path();
                if path.is_file() && !is_ignored_path(path) {
                    let len = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                    count += 1;
                    source_bytes += len;
                    total_files += 1;
                    total_bytes += len;

                    let ext = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_lowercase())
                        .unwrap_or_else(|| "no_ext".to_string());
                    *ext_map.entry(ext).or_insert(0) += 1;

                    if sample_files.len() < 20 {
                        if let Ok(rel) = path.strip_prefix(&src_path) {
                            sample_files.push(format!("{}/{}", src.name, rel.display()));
                        }
                    }
                }
            }

            rules_breakdown.push(RuleDiagnostic {
                name: format!("{} (Push)", src.name),
                path: src.path.clone(),
                file_count: count,
                total_bytes: source_bytes,
            });
        }

        let mut extension_counts: Vec<(String, usize)> = ext_map.into_iter().collect();
        extension_counts.sort_by(|a, b| b.1.cmp(&a.1));

        Ok(SyncDiagnostics {
            total_files,
            total_bytes,
            rules_breakdown,
            extension_counts,
            sample_files,
        })
    }

    pub async fn run_sync_now(&self) -> Result<usize> {
        self.run_sync_now_with_options(false).await
    }

    pub async fn run_sync_now_with_options(&self, force_rescan: bool) -> Result<usize> {
        if self.is_syncing.compare_exchange(false, true, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst).is_err() {
            println!("Sync Engine: Sync is already in progress, skipping concurrent run.");
            return Ok(0);
        }

        let plan_res = self.plan_sync(force_rescan).await;
        let result = match plan_res {
            Ok(plan) => self.execute_plan(&plan).await,
            Err(e) => {
                let mut st = self.status.lock().unwrap();
                *st = SyncStateStatus::Error {
                    message: e.to_string(),
                };
                Err(e)
            }
        };

        self.is_syncing.store(false, std::sync::atomic::Ordering::SeqCst);

        let debounce_secs = {
            let cfg = self.config.lock().unwrap();
            cfg.server_sync.as_ref().map(|s| s.debounce_minutes.max(1) * 60).unwrap_or(1800)
        };
        self.remaining_secs.store(debounce_secs, std::sync::atomic::Ordering::SeqCst);

        result
    }

    pub async fn run_sync_dry_run(&self, force_rescan: bool) -> Result<SyncPlan> {
        self.plan_sync(force_rescan).await
    }

    pub async fn plan_sync(&self, force_rescan: bool) -> Result<SyncPlan> {
        let config = self.config.lock().unwrap().clone();
        let server_cfg = config
            .server_sync
            .as_ref()
            .ok_or_else(|| anyhow!("Home server sync is not configured"))?;

        if !server_cfg.enabled {
            println!("Sync Engine: Server sync is disabled in config");
            return Err(anyhow!("Home server sync is disabled in config"));
        }

        {
            let mut st = self.status.lock().unwrap();
            *st = SyncStateStatus::Scanning {
                current_step: "Initializing library scan...".to_string(),
                files_scanned: 0,
                current_folder: "".to_string(),
            };
        }

        let conn = init_db(&self.app_dir)?;
        let sources = get_all_sources(&conn)?;

        // Pre-load all sync states into memory to eliminate N database queries during scan loops
        let all_states_vec = get_all_sync_states(&conn).unwrap_or_default();
        let sync_state_map: std::collections::HashMap<String, crate::db::sync_state_repo::SyncStateRecord> =
            all_states_vec.into_iter().map(|rec| (rec.relative_path.replace('\\', "/").to_lowercase(), rec)).collect();

        // Determine server URL from config endpoint (or fallback to working port/local)
        let server_url = crate::sync::server_client::resolve_working_server_url(&server_cfg.endpoint).await;

        let mut pull_tasks: Vec<PullTask> = Vec::new();
        let mut delete_tasks: Vec<DeleteTask> = Vec::new();
        let mut total_scanned = 0;
        let mut pulled_source_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

        // 1. Pull Server Inbox files for sources configured with mode == "pull"
        for src in &sources {
            if src.sync_mode != "pull" {
                continue;
            }

            let server_folder = src.server_path.as_deref().unwrap_or(src.name.as_str());
            let clean_server_folder = server_folder.trim_matches('/');
            let local_inbox_path = PathBuf::from(&src.path);

            {
                let mut st = self.status.lock().unwrap();
                *st = SyncStateStatus::Scanning {
                    current_step: format!("Checking server inbox ({})", clean_server_folder),
                    files_scanned: total_scanned,
                    current_folder: clean_server_folder.to_string(),
                };
            }

            match list_server_folder(&server_url, clean_server_folder).await {
                Ok(server_inbox_files) => {
                    for item in server_inbox_files {
                        total_scanned += 1;
                        if total_scanned % 50 == 0 || total_scanned == 1 {
                            let mut st = self.status.lock().unwrap();
                            *st = SyncStateStatus::Scanning {
                                current_step: format!("Checking server inbox ({})", clean_server_folder),
                                files_scanned: total_scanned,
                                current_folder: clean_server_folder.to_string(),
                            };
                        }

                        if is_ignored_path(std::path::Path::new(&item.path)) {
                            continue;
                        }

                        let item_key_norm = item.path.replace('\\', "/").to_lowercase();

                        // Fast in-memory check if file was sorted or deleted locally on laptop
                        if let Some(state_rec) = sync_state_map.get(&item_key_norm) {
                            if state_rec.status == "sorted" || state_rec.status == "deleted" {
                                delete_tasks.push(DeleteTask {
                                    rel_path: item.path.clone(),
                                    reason: format!("Server Inbox file was {} locally", state_rec.status),
                                });
                                continue;
                            }
                        }

                        let prefix = format!("{}/", clean_server_folder);
                        let rel_subpath = if item.path.starts_with(&prefix) {
                            &item.path[prefix.len()..]
                        } else if item.path == clean_server_folder {
                            ""
                        } else {
                            &item.path
                        };

                        if rel_subpath.is_empty() {
                            continue;
                        }

                        let local_target = local_inbox_path.join(rel_subpath);

                        // If the file was previously pulled, but no longer exists in local inbox,
                        // it was sorted or deleted on the laptop -> delete it from server inbox.
                        if let Some(state_rec) = sync_state_map.get(&item_key_norm) {
                            if state_rec.status == "pulled" && !local_target.exists() {
                                delete_tasks.push(DeleteTask {
                                    rel_path: item.path.clone(),
                                    reason: "Server Inbox file was already pulled and sorted/removed locally".to_string(),
                                });
                                continue;
                            }
                        }

                        let needs_pull = if local_target.exists() {
                            let meta = fs::metadata(&local_target).ok();
                            let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
                            let mtime = meta
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs() as i64)
                                .unwrap_or(0);
                            size != item.size || (item.mtime > 0 && mtime != item.mtime)
                        } else {
                            true
                        };

                        if needs_pull {
                            pull_tasks.push(PullTask {
                                node_name: src.name.clone(),
                                server_path: item.path,
                                size: item.size,
                                mtime: item.mtime,
                                local_target,
                            });
                            pulled_source_paths.insert(src.path.clone());
                        }
                    }
                }
                Err(e) => {
                    let err_msg = format!("Failed to list server folder '{}' at {}: {}", clean_server_folder, server_url, e);
                    eprintln!("Sync Engine error: {}", err_msg);
                    let mut st = self.status.lock().unwrap();
                    *st = SyncStateStatus::Error {
                        message: err_msg.clone(),
                    };
                    return Err(anyhow::anyhow!(err_msg));
                }
            }
        }

        // 2. Push local non-Inbox files for sources configured with mode == "push"
        let mut push_tasks: Vec<PushTask> = Vec::new();

        for src in &sources {
            if src.sync_mode != "push" {
                continue;
            }

            let src_path = PathBuf::from(&src.path);
            if !src_path.exists() {
                continue;
            }

            let server_prefix = src.server_path.as_deref().unwrap_or(src.name.as_str());

            {
                let mut st = self.status.lock().unwrap();
                *st = SyncStateStatus::Scanning {
                    current_step: format!("Scanning local folder '{}'", src.name),
                    files_scanned: total_scanned,
                    current_folder: src.name.clone(),
                };
            }

            let paths_to_check: Vec<PathBuf> = if force_rescan {
                WalkDir::new(&src_path)
                    .into_iter()
                    .filter_entry(|e| !is_ignored_path(e.path()))
                    .filter_map(|e| e.ok())
                    .map(|e| e.path().to_path_buf())
                    .collect()
            } else {
                get_indexed_paths_for_source(&conn, &src.id, &src_path)
            };

            for path in &paths_to_check {
                if path.is_file() && !is_ignored_path(path) {
                    total_scanned += 1;
                    if total_scanned % 50 == 0 || total_scanned == 1 {
                        let mut st = self.status.lock().unwrap();
                        *st = SyncStateStatus::Scanning {
                            current_step: format!("Scanning local folder '{}'", src.name),
                            files_scanned: total_scanned,
                            current_folder: src.name.clone(),
                        };
                    }

                    let rel_path = match path.strip_prefix(&src_path) {
                        Ok(p) => p.to_string_lossy().replace('\\', "/"),
                        Err(_) => continue,
                    };

                    if rel_path.is_empty() {
                        continue;
                    }

                    let remote_key = format!("{}/{}", server_prefix, rel_path);

                    let metadata = match fs::metadata(path) {
                        Ok(m) => m,
                        Err(_) => continue,
                    };

                    let file_size = metadata.len() as i64;
                    let mtime = metadata
                        .modified()
                        .unwrap_or_else(|_| SystemTime::now())
                        .duration_since(SystemTime::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);

                    let remote_key_norm = remote_key.replace('\\', "/").to_lowercase();
                    let existing_state = sync_state_map.get(&remote_key_norm);

                    let needs_sync = match existing_state {
                        Some(rec) => rec.file_size != file_size || rec.mtime != mtime,
                        None => true,
                    };

                    if needs_sync {
                        push_tasks.push(PushTask {
                            abs_path: path.clone(),
                            rel_path: remote_key,
                            file_size,
                            mtime,
                        });
                    }
                }
            }
        }

        // 3. Detect deleted local files for sources configured with mode == "push"
        for src in &sources {
            if src.sync_mode != "push" {
                continue;
            }

            let src_path = PathBuf::from(&src.path);
            let server_prefix = src.server_path.as_deref().unwrap_or(src.name.as_str());

            {
                let mut st = self.status.lock().unwrap();
                *st = SyncStateStatus::Scanning {
                    current_step: format!("Checking remote deletions for '{}'", src.name),
                    files_scanned: total_scanned,
                    current_folder: src.name.clone(),
                };
            }

            // Only delete remote files that were PREVIOUSLY tracked in sync_state_map
            // (meaning this client has synced them before) AND are now deleted on the local filesystem.
            let prefix_str = format!("{}/", server_prefix.replace('\\', "/").to_lowercase());
            for (rel_path_norm, state_rec) in &sync_state_map {
                if rel_path_norm.starts_with(&prefix_str) && (state_rec.status == "synced" || state_rec.status == "pulled") {
                    let rel_subpath = &state_rec.relative_path[prefix_str.len()..];
                    let local_target = src_path.join(rel_subpath);
                    if !is_ignored_path(std::path::Path::new(&state_rec.relative_path)) && !local_target.exists() {
                        if !delete_tasks.iter().any(|t| t.rel_path.eq_ignore_ascii_case(&state_rec.relative_path)) {
                            delete_tasks.push(DeleteTask {
                                rel_path: state_rec.relative_path.clone(),
                                reason: "File was deleted locally from push source".to_string(),
                            });
                        }
                    }
                }
            }
        }

        let total_files = pull_tasks.len() + push_tasks.len();
        let total_bytes: u64 = pull_tasks.iter().map(|t| t.size as u64).sum::<u64>()
            + push_tasks.iter().map(|t| t.file_size as u64).sum::<u64>();

        Ok(SyncPlan {
            server_url,
            pull_tasks,
            push_tasks,
            delete_tasks,
            pulled_source_paths: pulled_source_paths.into_iter().collect(),
            total_files,
            total_bytes,
        })
    }

    pub async fn execute_plan(&self, plan: &SyncPlan) -> Result<usize> {
        let conn = init_db(&self.app_dir)?;

        // 1. Process Delete Tasks
        let has_deletions = !plan.delete_tasks.is_empty();
        for task in &plan.delete_tasks {
            println!("Sync Engine: Deleting remote file '{}' ({})", task.rel_path, task.reason);
            let _ = delete_file_from_server(&plan.server_url, &task.rel_path).await;
            let _ = remove_sync_state(&conn, &task.rel_path);
        }
        if has_deletions {
            let _ = notify_server_of_updates(&plan.server_url, &[]).await;
        }

        if plan.total_files == 0 {
            let mut st = self.status.lock().unwrap();
            *st = SyncStateStatus::Success {
                last_sync_time: Utc::now().to_rfc3339(),
                files_synced: 0,
            };
            return Ok(0);
        }

        let sync_start_time = std::time::Instant::now();
        let concurrency_limit = 6;
        let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency_limit));
        let files_done_counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let bytes_done_counter = Arc::new(std::sync::atomic::AtomicU64::new(0));

        // 2. Process Pull Tasks with Parallel Workers using streaming downloads
        let mut pulled_records = Vec::new();
        if !plan.pull_tasks.is_empty() {
            let mut join_set = tokio::task::JoinSet::new();

            for task in &plan.pull_tasks {
                let sem = semaphore.clone();
                let server_url = plan.server_url.clone();
                let files_done_counter = files_done_counter.clone();
                let bytes_done_counter = bytes_done_counter.clone();
                let sync_status_mutex = self.status.clone();
                let total_files = plan.total_files;
                let total_bytes = plan.total_bytes;
                let task_clone = task.clone();

                join_set.spawn(async move {
                    let _permit = sem.acquire().await.map_err(|e| anyhow::anyhow!(e))?;

                    println!("Sync Engine: Pulling remote file '{}'", task_clone.server_path);

                    if let Some(parent) = task_clone.local_target.parent() {
                        let _ = fs::create_dir_all(parent);
                    }

                    download_file_to_path(&server_url, &task_clone.server_path, &task_clone.local_target).await?;

                    let ft = filetime::FileTime::from_unix_time(task_clone.mtime, 0);
                    let _ = filetime::set_file_mtime(&task_clone.local_target, ft);

                    let record = SyncStateRecord {
                        relative_path: task_clone.server_path.clone(),
                        file_size: task_clone.size,
                        mtime: task_clone.mtime,
                        hash: None,
                        last_synced_at: Utc::now().to_rfc3339(),
                        status: "pulled".to_string(),
                    };

                    let f_done = files_done_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    let b_done = bytes_done_counter.fetch_add(task_clone.size as u64, std::sync::atomic::Ordering::SeqCst) + task_clone.size as u64;

                    let elapsed_secs = sync_start_time.elapsed().as_secs_f64();
                    let bytes_per_sec = if elapsed_secs > 0.05 {
                        (b_done as f64 / elapsed_secs).round() as u64
                    } else {
                        0
                    };

                    {
                        let mut st = sync_status_mutex.lock().unwrap();
                        *st = SyncStateStatus::Syncing {
                            files_done: f_done,
                            total_files,
                            bytes_done: b_done,
                            total_bytes,
                            bytes_per_sec,
                            current_file: format!("⬇ Pulling {}: {}", task_clone.node_name, task_clone.server_path),
                        };
                    }

                    Ok::<SyncStateRecord, anyhow::Error>(record)
                });
            }

            while let Some(res) = join_set.join_next().await {
                match res {
                    Ok(Ok(record)) => {
                        pulled_records.push(record);
                    }
                    Ok(Err(e)) => {
                        let err_msg = format!("Sync download error: {}", e);
                        let mut st = self.status.lock().unwrap();
                        *st = SyncStateStatus::Error {
                            message: err_msg.clone(),
                        };
                        return Err(e);
                    }
                    Err(join_err) => {
                        let err_msg = format!("Join error during download: {}", join_err);
                        let mut st = self.status.lock().unwrap();
                        *st = SyncStateStatus::Error {
                            message: err_msg.clone(),
                        };
                        return Err(anyhow::anyhow!(join_err));
                    }
                }
            }

            let _ = set_sync_states_batch(&conn, &pulled_records);
        }

        // Post-pull indexing into local database in background thread
        if !plan.pulled_source_paths.is_empty() {
            let f_done = files_done_counter.load(std::sync::atomic::Ordering::SeqCst);
            let b_done = bytes_done_counter.load(std::sync::atomic::Ordering::SeqCst);
            {
                let mut st = self.status.lock().unwrap();
                *st = SyncStateStatus::Syncing {
                    files_done: f_done,
                    total_files: plan.total_files,
                    bytes_done: b_done,
                    total_bytes: plan.total_bytes,
                    bytes_per_sec: 0,
                    current_file: "Indexing downloaded files into library...".to_string(),
                };
            }

            let pulled_sources = plan.pulled_source_paths.clone();
            let db_path = self.app_dir.join("damright.db");
            let cache_dir = self.app_dir.join("cache");

            tokio::task::spawn_blocking(move || {
                for src_path in &pulled_sources {
                    let _ = crate::processing::import_folder_headless(src_path, &cache_dir, &db_path);
                }
            })
            .await
            .map_err(|e| anyhow::anyhow!("Background import task failed: {}", e))?;
        }

        // 3. Process Push Tasks with Parallel Workers (6 concurrent transfers) using streaming uploads
        let uploaded_paths = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let mut pushed_records = Vec::new();

        if !plan.push_tasks.is_empty() {
            let mut join_set = tokio::task::JoinSet::new();

            for task in &plan.push_tasks {
                let sem = semaphore.clone();
                let server_url = plan.server_url.clone();
                let files_done_counter = files_done_counter.clone();
                let bytes_done_counter = bytes_done_counter.clone();
                let uploaded_paths = uploaded_paths.clone();
                let sync_status_mutex = self.status.clone();
                let total_files = plan.total_files;
                let total_bytes = plan.total_bytes;
                let task_clone = task.clone();

                join_set.spawn(async move {
                    let _permit = sem.acquire().await.map_err(|e| anyhow::anyhow!(e))?;

                    println!("Sync Engine: Pushing file '{}'", task_clone.rel_path);

                    upload_file_from_path(&server_url, &task_clone.rel_path, &task_clone.abs_path, task_clone.mtime).await?;

                    let record = SyncStateRecord {
                        relative_path: task_clone.rel_path.clone(),
                        file_size: task_clone.file_size,
                        mtime: task_clone.mtime,
                        hash: None,
                        last_synced_at: Utc::now().to_rfc3339(),
                        status: "synced".to_string(),
                    };

                    let f_done = files_done_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    let b_done = bytes_done_counter.fetch_add(task_clone.file_size as u64, std::sync::atomic::Ordering::SeqCst) + task_clone.file_size as u64;

                    let elapsed_secs = sync_start_time.elapsed().as_secs_f64();
                    let bytes_per_sec = if elapsed_secs > 0.05 {
                        (b_done as f64 / elapsed_secs).round() as u64
                    } else {
                        0
                    };

                    uploaded_paths.lock().unwrap().push(task_clone.rel_path.clone());

                    {
                        let mut st = sync_status_mutex.lock().unwrap();
                        *st = SyncStateStatus::Syncing {
                            files_done: f_done,
                            total_files,
                            bytes_done: b_done,
                            total_bytes,
                            bytes_per_sec,
                            current_file: format!("⬆ Pushed: {}", task_clone.rel_path),
                        };
                    }

                    Ok::<SyncStateRecord, anyhow::Error>(record)
                });
            }

            while let Some(res) = join_set.join_next().await {
                match res {
                    Ok(Ok(record)) => {
                        pushed_records.push(record);
                    }
                    Ok(Err(e)) => {
                        let err_msg = format!("Sync error: {}", e);
                        let mut st = self.status.lock().unwrap();
                        *st = SyncStateStatus::Error {
                            message: err_msg.clone(),
                        };
                        return Err(e);
                    }
                    Err(join_err) => {
                        let err_msg = format!("Join error: {}", join_err);
                        let mut st = self.status.lock().unwrap();
                        *st = SyncStateStatus::Error {
                            message: err_msg.clone(),
                        };
                        return Err(anyhow::anyhow!(join_err));
                    }
                }
            }

            let _ = set_sync_states_batch(&conn, &pushed_records);
        }

        let uploaded_paths_vec = uploaded_paths.lock().unwrap().clone();
        if !uploaded_paths_vec.is_empty() {
            let _ = notify_server_of_updates(&plan.server_url, &uploaded_paths_vec).await;
        }

        let sync_count = plan.total_files;
        {
            let mut st = self.status.lock().unwrap();
            *st = SyncStateStatus::Success {
                last_sync_time: Utc::now().to_rfc3339(),
                files_synced: sync_count,
            };
        }

        let _ = crate::badge::update_inbox_badge(&conn);

        Ok(sync_count)
    }
}

fn get_indexed_paths_for_source(conn: &rusqlite::Connection, source_id: &str, src_path: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut stmt = match conn.prepare("SELECT path FROM photos WHERE source_id = ?") {
        Ok(s) => s,
        Err(_) => return paths,
    };

    let photo_rel_paths: Vec<String> = stmt
        .query_map([source_id], |row| row.get(0))
        .ok()
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    for rel in photo_rel_paths {
        let abs_photo = if Path::new(&rel).is_absolute() {
            PathBuf::from(&rel)
        } else {
            src_path.join(&rel)
        };

        if abs_photo.exists() {
            paths.push(abs_photo.clone());
        }

        let rel_path_obj = Path::new(&rel);

        // Check standard .xmp sidecar (e.g. photo.xmp)
        let abs_xmp_std = if rel_path_obj.is_absolute() {
            rel_path_obj.with_extension("xmp")
        } else {
            src_path.join(rel_path_obj.with_extension("xmp"))
        };
        if abs_xmp_std.exists() {
            paths.push(abs_xmp_std.clone());
        }

        // Check compound .ext.xmp sidecar (e.g. photo.jpg.xmp)
        let xmp_rel_compound = format!("{}.xmp", rel);
        let abs_xmp_compound = if rel_path_obj.is_absolute() {
            PathBuf::from(&xmp_rel_compound)
        } else {
            src_path.join(&xmp_rel_compound)
        };
        if abs_xmp_compound.exists() && abs_xmp_compound != abs_xmp_std {
            paths.push(abs_xmp_compound);
        }
    }

    paths
}

pub async fn try_server_folder_move(
    db_path: PathBuf,
    server_endpoint: &str,
    src_path_str: &str,
    dest_path_str: &str,
) -> anyhow::Result<()> {
    let norm_src = src_path_str.replace('\\', "/").trim_end_matches('/').to_string();
    let norm_dest = dest_path_str.replace('\\', "/").trim_end_matches('/').to_string();

    let db_path_clone = db_path.clone();
    let norm_src_clone = norm_src.clone();
    let norm_dest_clone = norm_dest.clone();
    let rel_info: Option<(String, String)> = tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path_clone).ok()?;
        let sources = crate::db::source_repo::get_all(&conn).ok()?;
        for src in &sources {
            if src.sync_mode != "push" {
                continue;
            }
            let norm_s = src.path.replace('\\', "/").trim_end_matches('/').to_string();
            let prefix = format!("{}/", norm_s);
            if norm_src_clone.starts_with(&prefix) && norm_dest_clone.starts_with(&prefix) {
                let server_prefix = src.server_path.as_deref().unwrap_or(src.name.as_str()).trim_matches('/');
                let rel_src = format!("{}/{}", server_prefix, &norm_src_clone[norm_s.len() + 1..]);
                let rel_dest = format!("{}/{}", server_prefix, &norm_dest_clone[norm_s.len() + 1..]);
                return Some((rel_src, rel_dest));
            }
        }
        None
    }).await.unwrap_or(None);

    let Some((rel_src, rel_dest)) = rel_info else {
        return Ok(());
    };

    println!("Sync Engine: Attempting server folder move from '{}' to '{}'", rel_src, rel_dest);
    match crate::sync::server_client::move_folder_on_server(server_endpoint, &rel_src, &rel_dest).await {
        Ok(_) => {
            println!("Sync Engine: Server folder move succeeded. Updating sync_state records.");
            let rel_src_prefix = format!("{}/", rel_src);
            let rel_dest_prefix = format!("{}/", rel_dest);
            let db_path_clone = db_path.clone();

            tokio::task::spawn_blocking(move || {
                if let Ok(conn) = rusqlite::Connection::open(&db_path_clone) {
                    let pattern = format!("{}%", rel_src_prefix);
                    let mut stmt = conn.prepare("SELECT relative_path FROM sync_state WHERE relative_path LIKE ? OR relative_path = ?").ok();
                    if let Some(ref mut st) = stmt {
                        let paths: Vec<String> = st.query_map(rusqlite::params![pattern, rel_src], |row| row.get(0))
                            .ok()
                            .into_iter()
                            .flat_map(|iter| iter.filter_map(|r| r.ok()))
                            .collect();

                        for old_rel in paths {
                            let new_rel = if old_rel == rel_src {
                                rel_dest.clone()
                            } else if old_rel.starts_with(&rel_src_prefix) {
                                format!("{}{}", rel_dest_prefix, &old_rel[rel_src_prefix.len()..])
                            } else {
                                continue;
                            };

                            let _ = conn.execute(
                                "UPDATE sync_state SET relative_path = ? WHERE relative_path = ?",
                                rusqlite::params![new_rel, old_rel],
                            );
                        }
                    }
                }
            }).await.unwrap_or(());

            let _ = crate::sync::server_client::notify_server_of_updates(server_endpoint, &[]).await;
            Ok(())
        }
        Err(e) => {
            println!("Sync Engine: Server folder move failed or server offline: {}. Will be handled by standard sync engine.", e);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_sync_engine_initial_status() {
        let engine = SyncEngine::new(PathBuf::from("/tmp"), AppConfig::default());
        let st = engine.get_status();
        assert_eq!(st.stage, SyncStateStatus::Idle);
        assert!(!st.enabled);
    }

    #[test]
    fn test_syncing_status_serialization() {
        let status = SyncStateStatus::Syncing {
            files_done: 2,
            total_files: 5,
            bytes_done: 2048,
            total_bytes: 5120,
            bytes_per_sec: 1048576,
            current_file: "⬆ Pushing: test.jpg".to_string(),
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"files_done\":2"));
        assert!(json.contains("\"total_files\":5"));
        assert!(json.contains("\"bytes_done\":2048"));
        assert!(json.contains("\"total_bytes\":5120"));
        assert!(json.contains("\"bytes_per_sec\":1048576"));

        let deserialized: SyncStateStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, status);
    }

    #[tokio::test]
    async fn test_pull_sync_subfolder_files() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app");
        let inbox_dir = tmp_dir.path().join("local_inbox");
        let server_storage_dir = tmp_dir.path().join("server_storage");
        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&inbox_dir).unwrap();
        fs::create_dir_all(&server_storage_dir).unwrap();

        // Put a file in Inbox/Alice's iPhone/IMG_0001.JPG on the server
        let phone_dir = server_storage_dir.join("Inbox").join("Alice's iPhone");
        fs::create_dir_all(&phone_dir).unwrap();
        let server_file = phone_dir.join("IMG_0001.JPG");
        fs::write(&server_file, b"photo content from alice's iphone").unwrap();

        // Init DB and register source
        let conn = crate::db::init_db(&app_dir).unwrap();
        let source = crate::models::Source {
            id: "src_inbox".to_string(),
            path: inbox_dir.to_str().unwrap().to_string(),
            name: "Inbox".to_string(),
            sync_mode: "pull".to_string(),
            server_path: Some("Inbox".to_string()),
            archive_prefix: None,
            rating_enabled: false,
        };
        crate::db::source_repo::insert(&conn, &source).unwrap();
        drop(conn);

        // Start local axum server for testing web_server handlers
        let conn2 = crate::db::init_db(&app_dir).unwrap();
        let db_arc = Arc::new(Mutex::new(conn2));
        let cache_dir = app_dir.join("cache");
        fs::create_dir_all(&cache_dir).unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let state = Arc::new(crate::web_server::WebState {
            db: db_arc,
            cache_dir,
            storage_dir: server_storage_dir,
        });

        let app = axum::Router::new()
            .route("/api/sync/list", axum::routing::get(crate::web_server::handle_list))
            .route("/api/sync/download", axum::routing::get(crate::web_server::handle_download))
            .with_state(state);

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut cfg = AppConfig::default();
        cfg.server_sync = Some(crate::sync::config::ServerSyncConfig {
            endpoint: format!("http://{}", addr),
            enabled: true,
            debounce_minutes: 30,
            folder_rules: Default::default(),
        });

        let engine = SyncEngine::new(app_dir.clone(), cfg);
        let synced_count = engine.run_sync_now().await.unwrap();
        assert_eq!(synced_count, 1);

        let local_pulled_file = inbox_dir.join("Alice's iPhone").join("IMG_0001.JPG");
        assert!(local_pulled_file.exists(), "Pulled file should exist at local inbox path");
        assert_eq!(fs::read_to_string(&local_pulled_file).unwrap(), "photo content from alice's iphone");

        // Verify sync_state record
        let conn_check = crate::db::init_db(&app_dir).unwrap();
        let st = crate::db::sync_state_repo::get_sync_state(&conn_check, "Inbox/Alice's iPhone/IMG_0001.JPG").unwrap();
        assert!(st.is_some());
        assert_eq!(st.unwrap().status, "pulled");
    }

    #[tokio::test]
    async fn test_pull_sync_multiple_concurrent_files() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app");
        let inbox_dir = tmp_dir.path().join("local_inbox");
        let server_storage_dir = tmp_dir.path().join("server_storage");
        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&inbox_dir).unwrap();
        fs::create_dir_all(&server_storage_dir).unwrap();

        // Create 10 files on server in Inbox
        let server_inbox = server_storage_dir.join("Inbox");
        fs::create_dir_all(&server_inbox).unwrap();
        for i in 1..=10 {
            let file = server_inbox.join(format!("IMG_{:04}.JPG", i));
            fs::write(&file, format!("content for file {}", i).as_bytes()).unwrap();
        }

        let conn = crate::db::init_db(&app_dir).unwrap();
        let source = crate::models::Source {
            id: "src_inbox".to_string(),
            path: inbox_dir.to_str().unwrap().to_string(),
            name: "Inbox".to_string(),
            sync_mode: "pull".to_string(),
            server_path: Some("Inbox".to_string()),
            archive_prefix: None,
            rating_enabled: false,
        };
        crate::db::source_repo::insert(&conn, &source).unwrap();
        drop(conn);

        let conn2 = crate::db::init_db(&app_dir).unwrap();
        let db_arc = Arc::new(Mutex::new(conn2));
        let cache_dir = app_dir.join("cache");
        fs::create_dir_all(&cache_dir).unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let state = Arc::new(crate::web_server::WebState {
            db: db_arc,
            cache_dir,
            storage_dir: server_storage_dir,
        });

        let app = axum::Router::new()
            .route("/api/sync/list", axum::routing::get(crate::web_server::handle_list))
            .route("/api/sync/download", axum::routing::get(crate::web_server::handle_download))
            .with_state(state);

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut cfg = AppConfig::default();
        cfg.server_sync = Some(crate::sync::config::ServerSyncConfig {
            endpoint: format!("http://{}", addr),
            enabled: true,
            debounce_minutes: 30,
            folder_rules: Default::default(),
        });

        let engine = SyncEngine::new(app_dir.clone(), cfg);
        let synced_count = engine.run_sync_now().await.unwrap();
        assert_eq!(synced_count, 10);

        for i in 1..=10 {
            let local_file = inbox_dir.join(format!("IMG_{:04}.JPG", i));
            assert!(local_file.exists());
            assert_eq!(fs::read_to_string(&local_file).unwrap(), format!("content for file {}", i));
        }

        let st = engine.get_status();
        assert_eq!(st.debounce_minutes, 30);
    }

    #[test]
    fn test_scanning_status_serialization() {
        let status = SyncStateStatus::Scanning {
            current_step: "Scanning local folder 'Library'".to_string(),
            files_scanned: 1420,
            current_folder: "Library".to_string(),
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"current_step\":\"Scanning local folder 'Library'\""));
        assert!(json.contains("\"files_scanned\":1420"));

        let deserialized: SyncStateStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, status);
    }

    #[tokio::test]
    async fn test_push_sync_files_and_xmp() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app");
        let server_app_dir = tmp_dir.path().join("server_app");
        let library_dir = tmp_dir.path().join("local_library");
        let server_storage_dir = tmp_dir.path().join("server_storage");
        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&server_app_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();
        fs::create_dir_all(&server_storage_dir).unwrap();

        // Create a local photo and XMP sidecar
        let local_photo = library_dir.join("20260804-abc.jpg");
        fs::write(&local_photo, b"jpeg content").unwrap();
        let local_xmp = library_dir.join("20260804-abc.jpg.xmp");
        fs::write(&local_xmp, b"<xmp>sidecar</xmp>").unwrap();

        // Init DB and register source & photo on the client
        let conn = crate::db::init_db(&app_dir).unwrap();
        let source = crate::models::Source {
            id: "src_lib".to_string(),
            path: library_dir.to_str().unwrap().to_string(),
            name: "Library".to_string(),
            sync_mode: "push".to_string(),
            server_path: Some("Library".to_string()),
            archive_prefix: None,
            rating_enabled: true,
        };
        crate::db::source_repo::insert(&conn, &source).unwrap();

        let photo = crate::models::Photo {
            id: "p1".to_string(),
            path: local_photo.to_str().unwrap().to_string(),
            ..crate::models::Photo::default_for_test()
        };
        crate::db::photo_repo::insert(&conn, &photo).unwrap();
        drop(conn);

        // Axum server for mock server endpoints with isolated server_app_dir
        let server_conn = crate::db::init_db(&server_app_dir).unwrap();
        let db_arc = Arc::new(Mutex::new(server_conn));
        let cache_dir = server_app_dir.join("cache");
        fs::create_dir_all(&cache_dir).unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let state = Arc::new(crate::web_server::WebState {
            db: db_arc,
            cache_dir,
            storage_dir: server_storage_dir.clone(),
        });

        let app = axum::Router::new()
            .route("/api/sources", axum::routing::get(crate::web_server::get_sources))
            .route("/api/sync/upload", axum::routing::post(crate::web_server::handle_upload))
            .route("/api/sync/notify", axum::routing::post(crate::web_server::handle_notify))
            .route("/api/sync/delete", axum::routing::post(crate::web_server::handle_delete))
            .with_state(state);

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut cfg = AppConfig::default();
        cfg.server_sync = Some(crate::sync::config::ServerSyncConfig {
            endpoint: format!("http://{}", addr),
            enabled: true,
            debounce_minutes: 30,
            folder_rules: Default::default(),
        });

        let engine = SyncEngine::new(app_dir.clone(), cfg);
        let synced_count = engine.run_sync_now().await.unwrap();
        assert_eq!(synced_count, 2); // 1 photo + 1 XMP sidecar

        // Verify files uploaded to server
        let uploaded_photo = server_storage_dir.join("Library").join("20260804-abc.jpg");
        assert!(uploaded_photo.exists(), "Photo should be pushed to server storage");
        assert_eq!(fs::read_to_string(&uploaded_photo).unwrap(), "jpeg content");

        let uploaded_xmp = server_storage_dir.join("Library").join("20260804-abc.jpg.xmp");
        assert!(uploaded_xmp.exists(), "XMP sidecar should be pushed to server storage");

        // Verify sync_state table
        let conn_check = crate::db::init_db(&app_dir).unwrap();
        let st = crate::db::sync_state_repo::get_sync_state(&conn_check, "Library/20260804-abc.jpg").unwrap();
        assert!(st.is_some());
        assert_eq!(st.unwrap().status, "synced");
    }

    #[tokio::test]
    async fn test_safe_remote_deletion() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app");
        let server_app_dir = tmp_dir.path().join("server_app");
        let library_dir = tmp_dir.path().join("local_library");
        let server_storage_dir = tmp_dir.path().join("server_storage");
        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&server_app_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();
        fs::create_dir_all(&server_storage_dir.join("Library")).unwrap();

        // 1. Untracked file on server (should NOT be deleted)
        let untracked_server_file = server_storage_dir.join("Library").join("keep_untracked.jpg");
        fs::write(&untracked_server_file, b"untracked photo").unwrap();

        // 2. Previously tracked file on server (was synced, now deleted locally on client)
        let previously_synced_server_file = server_storage_dir.join("Library").join("deleted_locally.jpg");
        fs::write(&previously_synced_server_file, b"old deleted photo").unwrap();

        // Init DB with source and sync_state record for deleted_locally.jpg
        let conn = crate::db::init_db(&app_dir).unwrap();
        let source = crate::models::Source {
            id: "src_lib".to_string(),
            path: library_dir.to_str().unwrap().to_string(),
            name: "Library".to_string(),
            sync_mode: "push".to_string(),
            server_path: Some("Library".to_string()),
            archive_prefix: None,
            rating_enabled: true,
        };
        crate::db::source_repo::insert(&conn, &source).unwrap();

        let sync_rec = crate::db::sync_state_repo::SyncStateRecord {
            relative_path: "Library/deleted_locally.jpg".to_string(),
            file_size: 100,
            mtime: 1000,
            hash: None,
            last_synced_at: "2026-08-01T00:00:00Z".to_string(),
            status: "synced".to_string(),
        };
        crate::db::sync_state_repo::set_sync_state(&conn, &sync_rec).unwrap();
        drop(conn);

        // Axum server for mock server endpoints with isolated server_app_dir
        let server_conn = crate::db::init_db(&server_app_dir).unwrap();
        let db_arc = Arc::new(Mutex::new(server_conn));
        let cache_dir = server_app_dir.join("cache");
        fs::create_dir_all(&cache_dir).unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let state = Arc::new(crate::web_server::WebState {
            db: db_arc,
            cache_dir,
            storage_dir: server_storage_dir.clone(),
        });

        let app = axum::Router::new()
            .route("/api/sources", axum::routing::get(crate::web_server::get_sources))
            .route("/api/sync/delete", axum::routing::post(crate::web_server::handle_delete))
            .route("/api/sync/notify", axum::routing::post(crate::web_server::handle_notify))
            .with_state(state);

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut cfg = AppConfig::default();
        cfg.server_sync = Some(crate::sync::config::ServerSyncConfig {
            endpoint: format!("http://{}", addr),
            enabled: true,
            debounce_minutes: 30,
            folder_rules: Default::default(),
        });

        let engine = SyncEngine::new(app_dir.clone(), cfg);
        let _ = engine.run_sync_now().await.unwrap();

        // Verify: untracked file was preserved
        assert!(untracked_server_file.exists(), "Untracked remote file must NOT be deleted");

        // Verify: previously synced file was safely deleted
        assert!(!previously_synced_server_file.exists(), "Tracked deleted file should be removed from server");

        // Verify: sync_state record was removed
        let conn_check = crate::db::init_db(&app_dir).unwrap();
        let st = crate::db::sync_state_repo::get_sync_state(&conn_check, "Library/deleted_locally.jpg").unwrap();
        assert!(st.is_none(), "Sync state record should be cleaned up after deletion");
    }

    #[tokio::test]
    async fn test_sync_engine_debouncing_lifecycle() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let mut cfg = AppConfig::default();
        cfg.server_sync = Some(crate::sync::config::ServerSyncConfig {
            endpoint: "http://127.0.0.1:8010".to_string(),
            enabled: true,
            debounce_minutes: 5,
            folder_rules: Default::default(),
        });

        let engine = SyncEngine::new(tmp_dir.path().to_path_buf(), cfg);
        
        // Wait for background worker interval to tick
        tokio::time::sleep(tokio::time::Duration::from_millis(1200)).await;
        let st = engine.get_status();
        assert!(st.enabled);
        assert_eq!(st.debounce_minutes, 5);
        if let SyncStateStatus::Debouncing { remaining_secs } = st.stage {
            assert!(remaining_secs <= 300 && remaining_secs >= 295);
        } else {
            panic!("Expected Debouncing stage, got: {:?}", st.stage);
        }
    }

    #[tokio::test]
    async fn test_dry_run_sync_plan() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app");
        let server_app_dir = tmp_dir.path().join("server_app");
        let inbox_dir = tmp_dir.path().join("local_inbox");
        let library_dir = tmp_dir.path().join("local_library");
        let server_storage_dir = tmp_dir.path().join("server_storage");
        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&server_app_dir).unwrap();
        fs::create_dir_all(&inbox_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();
        fs::create_dir_all(&server_storage_dir).unwrap();

        // 1. File on server waiting to be pulled
        let server_inbox_dir = server_storage_dir.join("Inbox");
        fs::create_dir_all(&server_inbox_dir).unwrap();
        let server_file = server_inbox_dir.join("IMG_0001.JPG");
        fs::write(&server_file, b"remote inbox content").unwrap();

        // 2. File in local library waiting to be pushed
        let local_photo = library_dir.join("20260804-dry.jpg");
        fs::write(&local_photo, b"local library content").unwrap();

        // Init DB and register sources & photo on client
        let conn = crate::db::init_db(&app_dir).unwrap();
        let source_pull = crate::models::Source {
            id: "src_inbox".to_string(),
            path: inbox_dir.to_str().unwrap().to_string(),
            name: "Inbox".to_string(),
            sync_mode: "pull".to_string(),
            server_path: Some("Inbox".to_string()),
            archive_prefix: None,
            rating_enabled: false,
        };
        crate::db::source_repo::insert(&conn, &source_pull).unwrap();

        let source_push = crate::models::Source {
            id: "src_lib".to_string(),
            path: library_dir.to_str().unwrap().to_string(),
            name: "Library".to_string(),
            sync_mode: "push".to_string(),
            server_path: Some("Library".to_string()),
            archive_prefix: None,
            rating_enabled: true,
        };
        crate::db::source_repo::insert(&conn, &source_push).unwrap();

        let photo = crate::models::Photo {
            id: "p_dry".to_string(),
            path: local_photo.to_str().unwrap().to_string(),
            ..crate::models::Photo::default_for_test()
        };
        crate::db::photo_repo::insert(&conn, &photo).unwrap();
        drop(conn);

        // Axum server for mock server endpoints
        let server_conn = crate::db::init_db(&server_app_dir).unwrap();
        let db_arc = Arc::new(Mutex::new(server_conn));
        let cache_dir = server_app_dir.join("cache");
        fs::create_dir_all(&cache_dir).unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let state = Arc::new(crate::web_server::WebState {
            db: db_arc,
            cache_dir,
            storage_dir: server_storage_dir.clone(),
        });

        let app = axum::Router::new()
            .route("/api/sources", axum::routing::get(crate::web_server::get_sources))
            .route("/api/sync/list", axum::routing::get(crate::web_server::handle_list))
            .with_state(state);

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let mut cfg = AppConfig::default();
        cfg.server_sync = Some(crate::sync::config::ServerSyncConfig {
            endpoint: format!("http://{}", addr),
            enabled: true,
            debounce_minutes: 30,
            folder_rules: Default::default(),
        });

        let engine = SyncEngine::new(app_dir.clone(), cfg);
        let plan = engine.run_sync_dry_run(false).await.unwrap();

        // Check plan
        assert_eq!(plan.pull_tasks.len(), 1, "Should plan 1 pull task");
        assert_eq!(plan.pull_tasks[0].server_path, "Inbox/IMG_0001.JPG");
        assert_eq!(plan.push_tasks.len(), 1, "Should plan 1 push task");
        assert_eq!(plan.push_tasks[0].rel_path, "Library/20260804-dry.jpg");
        assert_eq!(plan.total_files, 2);
        assert_eq!(plan.delete_tasks.len(), 0);

        // Verify that NO files were actually downloaded or uploaded in dry run
        let local_pulled_file = inbox_dir.join("IMG_0001.JPG");
        assert!(!local_pulled_file.exists(), "Dry run must NOT download files");

        let remote_pushed_file = server_storage_dir.join("Library").join("20260804-dry.jpg");
        assert!(!remote_pushed_file.exists(), "Dry run must NOT upload files");

        // Verify DB was NOT mutated
        let conn_check = crate::db::init_db(&app_dir).unwrap();
        let st_pull = crate::db::sync_state_repo::get_sync_state(&conn_check, "Inbox/IMG_0001.JPG").unwrap();
        assert!(st_pull.is_none(), "Dry run must NOT write sync_state records");
    }

    #[tokio::test]
    async fn test_sync_engine_includes_xmp_sidecars() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let app_dir = tmp_dir.path().join("app");
        let library_dir = tmp_dir.path().join("local_library");
        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();

        // Photo with standard .xmp sidecar (foo.xmp)
        let photo1 = library_dir.join("photo1.jpg");
        let xmp1 = library_dir.join("photo1.xmp");
        fs::write(&photo1, b"photo 1 image data").unwrap();
        fs::write(&xmp1, b"<xmp>rating=5</xmp>").unwrap();

        // Photo with compound .ext.xmp sidecar (photo2.raw.xmp)
        let photo2 = library_dir.join("photo2.raw");
        let xmp2 = library_dir.join("photo2.raw.xmp");
        fs::write(&photo2, b"photo 2 raw data").unwrap();
        fs::write(&xmp2, b"<xmp>rating=4</xmp>").unwrap();

        let conn = crate::db::init_db(&app_dir).unwrap();
        let source_push = crate::models::Source {
            id: "src_lib".to_string(),
            path: library_dir.to_str().unwrap().to_string(),
            name: "Library".to_string(),
            sync_mode: "push".to_string(),
            server_path: Some("Library".to_string()),
            archive_prefix: None,
            rating_enabled: true,
        };
        crate::db::source_repo::insert(&conn, &source_push).unwrap();

        let p1 = crate::models::Photo {
            id: "p1".to_string(),
            path: photo1.to_str().unwrap().to_string(),
            ..crate::models::Photo::default_for_test()
        };
        let p2 = crate::models::Photo {
            id: "p2".to_string(),
            path: photo2.to_str().unwrap().to_string(),
            ..crate::models::Photo::default_for_test()
        };
        crate::db::photo_repo::insert(&conn, &p1).unwrap();
        crate::db::photo_repo::insert(&conn, &p2).unwrap();

        // Test get_indexed_paths_for_source directly
        let paths = get_indexed_paths_for_source(&conn, "src_lib", &library_dir);
        assert_eq!(paths.len(), 4, "Should find both photos and both XMP sidecars");
        assert!(paths.contains(&photo1));
        assert!(paths.contains(&xmp1), "Must include standard photo1.xmp sidecar");
        assert!(paths.contains(&photo2));
        assert!(paths.contains(&xmp2), "Must include compound photo2.raw.xmp sidecar");
    }
}

