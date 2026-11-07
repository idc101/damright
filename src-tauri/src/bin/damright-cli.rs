use std::env;
use std::process::exit;
use serde::{Deserialize, Serialize};
use damright_lib::cli::{
    list_tags, search_photos, find_target_photos, edit_photos,
    format_tags_table, format_photo_summary, format_photos_list, format_edit_output,
    EditOptions, PhotoSummary,
};
use damright_lib::db::photo_repo;

#[derive(Debug, Serialize, Deserialize)]
struct CliDryRunSummary {
    files_to_pull: usize,
    bytes_to_pull: u64,
    files_to_push: usize,
    bytes_to_push: u64,
    files_to_delete: usize,
    total_files: usize,
    total_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct CliDryRunOutput {
    dry_run: bool,
    server_url: String,
    summary: CliDryRunSummary,
    pull_tasks: Vec<damright_lib::sync::sync_engine::PullTask>,
    push_tasks: Vec<damright_lib::sync::sync_engine::PushTask>,
    delete_tasks: Vec<damright_lib::sync::sync_engine::DeleteTask>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CliSyncOutput {
    dry_run: bool,
    success: bool,
    files_synced: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct CliStatusOutput {
    enabled: bool,
    debounce_minutes: u64,
    stage: damright_lib::sync::sync_engine::SyncStateStatus,
}

fn format_bytes(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else if bytes < 1024 * 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    }
}

fn open_db() -> rusqlite::Connection {
    let app_dir = damright_lib::resolve_app_dir();
    if let Err(e) = std::fs::create_dir_all(&app_dir) {
        eprintln!("Error creating app directory {:?}: {}", app_dir, e);
        exit(1);
    }
    match damright_lib::db::init_db(&app_dir) {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("Error opening database at {:?}: {}", app_dir, e);
            exit(1);
        }
    }
}

fn print_help() {
    println!(
        "DamRight CLI - Personal Digital Asset Manager CLI

USAGE:
    damright-cli <SUBCOMMAND> [OPTIONS]

SUBCOMMANDS:
    tags        List all tags and photo counts
    photos      List and filter photos (by tag, title, description, camera, etc.)
    search      Quick search photos by query string
    show        Show full metadata for a photo (by ID or path)
    edit        Edit tags, description, title, or rating for photo(s)
    sync        Synchronize photos with home server
    status      Check sync engine status and server configuration
    help        Print this help message

OPTIONS FOR 'tags':
    --sort <count|name>   Sort by count (default) or name
    --min-count <N>       Only show tags with at least N photos
    --json                Output results in JSON format

OPTIONS FOR 'photos' / 'search':
    --query, -q <QUERY>   Filter query (supports tag:, title:, desc:, make:, model:, etc.)
    --camera-title        Filter photos whose title matches camera make/model
    --tag <TAG>           Filter by tag
    --title <TEXT>        Filter by title containing TEXT
    --desc <TEXT>         Filter by description containing TEXT
    --has-title           Only photos with a title set
    --no-title            Only photos without a title
    --has-desc            Only photos with a description set
    --no-desc             Only photos without a description
    --limit <N>           Limit results (default: 50; 0 for unlimited)
    --all                 Return all results (no limit)
    --json                Output results in JSON format

OPTIONS FOR 'show':
    <ID_OR_PATH>          Photo ID or file path
    --json                Output photo metadata in JSON format

OPTIONS FOR 'edit':
  Target selection (at least one required):
    <ID_OR_PATH>          Target photo ID or file path (positional)
    --id <ID>             Target photo by ID (repeatable or comma-separated)
    --path <PATH>         Target photo by file path (repeatable)
    --query, -q <QUERY>   Target all photos matching search query
    --camera-title        Target all photos where title matches camera make/model
    --all                 Target all photos

  Modifications:
    --title <TITLE>       Set photo title
    --clear-title         Remove / clear title
    --desc <DESC>         Set photo description
    --clear-desc          Remove / clear description
    --add-tag <TAG>       Add tag(s) (repeatable or comma-separated)
    --remove-tag <TAG>    Remove tag(s) (repeatable or comma-separated)
    --set-tags <TAGS>     Set all tags to comma-separated list
    --clear-tags          Remove all tags
    --rating <0-5>        Set photo rating

  Options:
    --dry-run, -n         Preview changes without modifying DB or XMP sidecars
    --json                Output results in JSON format

OPTIONS FOR 'sync':
    --dry-run, -n         Simulate sync without uploading, downloading, or mutating DB
    --force-rescan        Force full directory scan instead of index-assisted scan
    --json                Output results in JSON format
"
    );
}

#[tokio::main]
async fn main() {
    let raw_args: Vec<String> = env::args().collect();
    if raw_args.len() < 2 {
        print_help();
        exit(1);
    }

    // Check for global --data-dir flag
    let mut args = Vec::new();
    let mut i = 0;
    while i < raw_args.len() {
        if raw_args[i] == "--data-dir" && i + 1 < raw_args.len() {
            env::set_var("DAMRIGHT_DATA_DIR", &raw_args[i + 1]);
            i += 2;
        } else {
            args.push(raw_args[i].clone());
            i += 1;
        }
    }

    if args.len() < 2 {
        print_help();
        exit(1);
    }

    let subcommand = args[1].as_str();
    let sub_args = &args[2..];

    match subcommand {
        "sync" => {
            let dry_run = sub_args.iter().any(|a| a == "--dry-run" || a == "-n");
            let force_rescan = sub_args.iter().any(|a| a == "--force-rescan");
            let json_output = sub_args.iter().any(|a| a == "--json");

            handle_sync(dry_run, force_rescan, json_output).await;
        }
        "status" => {
            let json_output = sub_args.iter().any(|a| a == "--json");
            handle_status(json_output).await;
        }
        "tags" | "tag" => {
            handle_tags(sub_args);
        }
        "photos" | "list" => {
            handle_photos(sub_args);
        }
        "search" => {
            handle_search(sub_args);
        }
        "show" | "info" => {
            handle_show(sub_args);
        }
        "edit" | "update" => {
            handle_edit(sub_args);
        }
        "help" | "--help" | "-h" => {
            print_help();
        }
        unknown => {
            eprintln!("Error: Unknown subcommand '{}'. Run 'damright-cli help' for usage.", unknown);
            exit(1);
        }
    }
}

fn handle_tags(args: &[String]) {
    let conn = open_db();
    let json_output = args.iter().any(|a| a == "--json");
    let mut sort_by_name = args.iter().any(|a| a == "--sort-name");
    let mut min_count: u32 = 1;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--sort" => {
                if i + 1 < args.len() {
                    sort_by_name = args[i + 1].to_lowercase() == "name";
                    i += 1;
                }
            }
            "--min-count" => {
                if i + 1 < args.len() {
                    if let Ok(n) = args[i + 1].parse::<u32>() {
                        min_count = n;
                    }
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }

    match list_tags(&conn, sort_by_name, min_count) {
        Ok(tags) => {
            if json_output {
                println!("{}", serde_json::to_string_pretty(&tags).unwrap());
            } else {
                print!("{}", format_tags_table(&tags));
            }
        }
        Err(e) => {
            if json_output {
                println!(r#"{{"error": "{}"}}"#, e);
            } else {
                eprintln!("Error listing tags: {}", e);
            }
            exit(1);
        }
    }
}

fn handle_photos(args: &[String]) {
    let conn = open_db();
    let json_output = args.iter().any(|a| a == "--json");
    let camera_title = args.iter().any(|a| a == "--camera-title");
    let all = args.iter().any(|a| a == "--all");

    let mut query_parts = Vec::new();
    let mut limit: Option<usize> = if all { None } else { Some(50) };

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--query" | "-q" => {
                if i + 1 < args.len() {
                    query_parts.push(args[i + 1].clone());
                    i += 1;
                }
            }
            "--tag" => {
                if i + 1 < args.len() {
                    query_parts.push(format!("tag:\"{}\"", args[i + 1]));
                    i += 1;
                }
            }
            "--title" => {
                if i + 1 < args.len() {
                    query_parts.push(format!("title:\"{}\"", args[i + 1]));
                    i += 1;
                }
            }
            "--desc" | "--description" => {
                if i + 1 < args.len() {
                    query_parts.push(format!("desc:\"{}\"", args[i + 1]));
                    i += 1;
                }
            }
            "--has-title" => {
                query_parts.push("has:title".to_string());
            }
            "--no-title" => {
                query_parts.push("-has:title".to_string());
            }
            "--has-desc" => {
                query_parts.push("has:desc".to_string());
            }
            "--no-desc" => {
                query_parts.push("-has:desc".to_string());
            }
            "--has-tags" => {
                query_parts.push("has:tags".to_string());
            }
            "--no-tags" => {
                query_parts.push("-has:tags".to_string());
            }
            "--limit" => {
                if i + 1 < args.len() {
                    if let Ok(l) = args[i + 1].parse::<usize>() {
                        limit = if l == 0 { None } else { Some(l) };
                    }
                    i += 1;
                }
            }
            "--camera-title" | "--all" | "--json" => {}
            other => {
                if !other.starts_with('-') {
                    query_parts.push(other.to_string());
                }
            }
        }
        i += 1;
    }

    let final_query = if query_parts.is_empty() {
        None
    } else {
        Some(query_parts.join(" "))
    };

    match search_photos(&conn, final_query.as_deref(), camera_title, limit) {
        Ok(photos) => {
            if json_output {
                println!("{}", serde_json::to_string_pretty(&photos).unwrap());
            } else {
                print!("{}", format_photos_list(&photos));
            }
        }
        Err(e) => {
            if json_output {
                println!(r#"{{"error": "{}"}}"#, e);
            } else {
                eprintln!("Error searching photos: {}", e);
            }
            exit(1);
        }
    }
}

fn handle_search(args: &[String]) {
    let conn = open_db();
    let json_output = args.iter().any(|a| a == "--json");
    let camera_title = args.iter().any(|a| a == "--camera-title");
    let all = args.iter().any(|a| a == "--all");

    let mut query_parts = Vec::new();
    let mut limit: Option<usize> = if all { None } else { Some(50) };

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--query" | "-q" => {
                if i + 1 < args.len() {
                    query_parts.push(args[i + 1].clone());
                    i += 1;
                }
            }
            "--limit" => {
                if i + 1 < args.len() {
                    if let Ok(l) = args[i + 1].parse::<usize>() {
                        limit = if l == 0 { None } else { Some(l) };
                    }
                    i += 1;
                }
            }
            "--camera-title" | "--all" | "--json" => {}
            other => {
                if !other.starts_with('-') {
                    query_parts.push(other.to_string());
                }
            }
        }
        i += 1;
    }

    let final_query = if query_parts.is_empty() {
        None
    } else {
        Some(query_parts.join(" "))
    };

    match search_photos(&conn, final_query.as_deref(), camera_title, limit) {
        Ok(photos) => {
            if json_output {
                println!("{}", serde_json::to_string_pretty(&photos).unwrap());
            } else {
                print!("{}", format_photos_list(&photos));
            }
        }
        Err(e) => {
            if json_output {
                println!(r#"{{"error": "{}"}}"#, e);
            } else {
                eprintln!("Error searching photos: {}", e);
            }
            exit(1);
        }
    }
}

fn handle_show(args: &[String]) {
    let conn = open_db();
    let json_output = args.iter().any(|a| a == "--json");
    let target = args.iter().find(|a| !a.starts_with('-'));

    let Some(id_or_path) = target else {
        eprintln!("Error: Missing photo ID or path. Usage: damright-cli show <ID_OR_PATH> [--json]");
        exit(1);
    };

    match photo_repo::find_photo(&conn, id_or_path) {
        Ok(Some(photo)) => {
            let summary = PhotoSummary::from(&photo);
            if json_output {
                println!("{}", serde_json::to_string_pretty(&summary).unwrap());
            } else {
                print!("{}", format_photo_summary(&summary));
            }
        }
        Ok(None) => {
            if json_output {
                println!(r#"{{"error": "Photo not found: {}"}}"#, id_or_path);
            } else {
                eprintln!("Error: Photo not found: {}", id_or_path);
            }
            exit(1);
        }
        Err(e) => {
            if json_output {
                println!(r#"{{"error": "{}"}}"#, e);
            } else {
                eprintln!("Error fetching photo: {}", e);
            }
            exit(1);
        }
    }
}

fn handle_edit(args: &[String]) {
    let conn = open_db();
    let json_output = args.iter().any(|a| a == "--json");
    let dry_run = args.iter().any(|a| a == "--dry-run" || a == "-n");

    let mut ids = Vec::new();
    let mut paths = Vec::new();
    let mut query: Option<String> = None;
    let mut camera_title = false;
    let mut all = false;

    let mut opts = EditOptions::default();

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--id" => {
                if i + 1 < args.len() {
                    ids.push(args[i + 1].clone());
                    i += 1;
                }
            }
            "--path" => {
                if i + 1 < args.len() {
                    paths.push(args[i + 1].clone());
                    i += 1;
                }
            }
            "--query" | "-q" => {
                if i + 1 < args.len() {
                    query = Some(args[i + 1].clone());
                    i += 1;
                }
            }
            "--camera-title" => {
                camera_title = true;
            }
            "--all" => {
                all = true;
            }
            "--title" => {
                if i + 1 < args.len() {
                    opts.set_title = Some(args[i + 1].clone());
                    i += 1;
                }
            }
            "--clear-title" | "--remove-title" => {
                opts.clear_title = true;
            }
            "--desc" | "--description" => {
                if i + 1 < args.len() {
                    opts.set_description = Some(args[i + 1].clone());
                    i += 1;
                }
            }
            "--clear-desc" | "--clear-description" => {
                opts.clear_description = true;
            }
            "--add-tag" | "--add-tags" => {
                if i + 1 < args.len() {
                    opts.add_tags.push(args[i + 1].clone());
                    i += 1;
                }
            }
            "--remove-tag" | "--remove-tags" => {
                if i + 1 < args.len() {
                    opts.remove_tags.push(args[i + 1].clone());
                    i += 1;
                }
            }
            "--set-tags" => {
                if i + 1 < args.len() {
                    let tags: Vec<String> = args[i + 1]
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    opts.set_tags = Some(tags);
                    i += 1;
                }
            }
            "--clear-tags" => {
                opts.clear_tags = true;
            }
            "--rating" => {
                if i + 1 < args.len() {
                    if let Ok(r) = args[i + 1].parse::<u8>() {
                        opts.set_rating = Some(r);
                    }
                    i += 1;
                }
            }
            "--dry-run" | "-n" | "--json" => {}
            other => {
                if !other.starts_with('-') {
                    // Positional target (ID or path)
                    ids.push(other.to_string());
                }
            }
        }
        i += 1;
    }

    // Validate that at least one target is provided
    if ids.is_empty() && paths.is_empty() && query.is_none() && !camera_title && !all {
        let msg = "Error: No target photos specified. Use --id <ID>, --path <PATH>, --query <QUERY>, --camera-title, or --all.";
        if json_output {
            println!(r#"{{"error": "{}"}}"#, msg);
        } else {
            eprintln!("{}", msg);
        }
        exit(1);
    }

    // Validate that at least one edit action is provided
    let has_action = opts.set_title.is_some()
        || opts.clear_title
        || opts.set_description.is_some()
        || opts.clear_description
        || !opts.add_tags.is_empty()
        || !opts.remove_tags.is_empty()
        || opts.set_tags.is_some()
        || opts.clear_tags
        || opts.set_rating.is_some();

    if !has_action {
        let msg = "Error: No edit modifications specified. Use --title, --clear-title, --desc, --clear-desc, --add-tag, --remove-tag, --set-tags, or --clear-tags.";
        if json_output {
            println!(r#"{{"error": "{}"}}"#, msg);
        } else {
            eprintln!("{}", msg);
        }
        exit(1);
    }

    let targets = match find_target_photos(&conn, &ids, &paths, query.as_deref(), camera_title, all) {
        Ok(t) => t,
        Err(e) => {
            if json_output {
                println!(r#"{{"error": "Failed to resolve targets: {}"}}"#, e);
            } else {
                eprintln!("Failed to resolve target photos: {}", e);
            }
            exit(1);
        }
    };

    match edit_photos(&conn, &targets, &opts, dry_run) {
        Ok(output) => {
            if json_output {
                println!("{}", serde_json::to_string_pretty(&output).unwrap());
            } else {
                print!("{}", format_edit_output(&output));
            }
        }
        Err(e) => {
            if json_output {
                println!(r#"{{"error": "Edit failed: {}"}}"#, e);
            } else {
                eprintln!("Edit failed: {}", e);
            }
            exit(1);
        }
    }
}

async fn handle_status(json_output: bool) {
    let app_dir = damright_lib::resolve_app_dir();
    let config = damright_lib::sync::config::load_config().unwrap_or_default();
    let engine = damright_lib::sync::sync_engine::SyncEngine::new(app_dir, config.clone());
    let status = engine.get_status();

    if json_output {
        let out = CliStatusOutput {
            enabled: status.enabled,
            debounce_minutes: status.debounce_minutes,
            stage: status.stage,
        };
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    } else {
        println!("=== DamRight Sync Status ===");
        println!("App Directory: {:?}", damright_lib::resolve_app_dir());
        if let Some(ref s) = config.server_sync {
            println!("Server Endpoint: {}", s.endpoint);
            println!("Sync Enabled:    {}", s.enabled);
            println!("Debounce Period: {} minutes", s.debounce_minutes);
        } else {
            println!("Server Sync: Not configured");
        }
        println!("Current Stage:   {:?}", status.stage);
    }
}

async fn handle_sync(dry_run: bool, force_rescan: bool, json_output: bool) {
    let app_dir = damright_lib::resolve_app_dir();
    let config = match damright_lib::sync::config::load_config() {
        Ok(c) => c,
        Err(e) => {
            if json_output {
                println!(r#"{{"error": "Failed to load config: {}"}}"#, e);
            } else {
                eprintln!("Error: Failed to load config: {}", e);
            }
            exit(1);
        }
    };

    let engine = damright_lib::sync::sync_engine::SyncEngine::new(app_dir, config);

    if dry_run {
        match engine.plan_sync(force_rescan).await {
            Ok(plan) => {
                let bytes_to_pull: u64 = plan.pull_tasks.iter().map(|t| t.size as u64).sum();
                let bytes_to_push: u64 = plan.push_tasks.iter().map(|t| t.file_size as u64).sum();

                if json_output {
                    let out = CliDryRunOutput {
                        dry_run: true,
                        server_url: plan.server_url.clone(),
                        summary: CliDryRunSummary {
                            files_to_pull: plan.pull_tasks.len(),
                            bytes_to_pull,
                            files_to_push: plan.push_tasks.len(),
                            bytes_to_push,
                            files_to_delete: plan.delete_tasks.len(),
                            total_files: plan.total_files,
                            total_bytes: plan.total_bytes,
                        },
                        pull_tasks: plan.pull_tasks,
                        push_tasks: plan.push_tasks,
                        delete_tasks: plan.delete_tasks,
                    };
                    println!("{}", serde_json::to_string_pretty(&out).unwrap());
                } else {
                    println!("=== DamRight Sync Plan (Dry Run) ===");
                    println!("Server Endpoint: {}", plan.server_url);
                    println!();
                    println!("Summary:");
                    println!("  Files to pull:    {} ({})", plan.pull_tasks.len(), format_bytes(bytes_to_pull));
                    println!("  Files to push:    {} ({})", plan.push_tasks.len(), format_bytes(bytes_to_push));
                    println!("  Files to delete:  {}", plan.delete_tasks.len());
                    println!("  Total operations: {} files ({})", plan.total_files, format_bytes(plan.total_bytes));
                    println!();

                    if !plan.pull_tasks.is_empty() {
                        println!("Pull Tasks (Download from Server):");
                        for t in &plan.pull_tasks {
                            println!("  ⬇ [{}] {} -> {} ({})", t.node_name, t.server_path, t.local_target.display(), format_bytes(t.size as u64));
                        }
                        println!();
                    }

                    if !plan.push_tasks.is_empty() {
                        println!("Push Tasks (Upload to Server):");
                        for t in &plan.push_tasks {
                            println!("  ⬆ [{}] -> {} ({})", t.rel_path, t.abs_path.display(), format_bytes(t.file_size as u64));
                        }
                        println!();
                    }

                    if !plan.delete_tasks.is_empty() {
                        println!("Delete Tasks (Remote Server Cleanup):");
                        for t in &plan.delete_tasks {
                            println!("  ✕ {} ({})", t.rel_path, t.reason);
                        }
                        println!();
                    }

                    println!("Dry run complete. No files were transferred and no database changes were made.");
                }
            }
            Err(e) => {
                if json_output {
                    println!(r#"{{"error": "{}"}}"#, e);
                } else {
                    eprintln!("Sync Plan failed: {}", e);
                }
                exit(1);
            }
        }
    } else {
        if !json_output {
            println!("=== Starting DamRight Sync ===");
        }

        match engine.run_sync_now_with_options(force_rescan).await {
            Ok(count) => {
                if json_output {
                    let out = CliSyncOutput {
                        dry_run: false,
                        success: true,
                        files_synced: count,
                    };
                    println!("{}", serde_json::to_string_pretty(&out).unwrap());
                } else {
                    println!("Sync completed successfully. {} files synchronized.", count);
                }
            }
            Err(e) => {
                if json_output {
                    println!(r#"{{"error": "{}"}}"#, e);
                } else {
                    eprintln!("Sync execution failed: {}", e);
                }
                exit(1);
            }
        }
    }
}
