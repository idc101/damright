use std::sync::{Arc, Mutex};
use std::path::PathBuf;

#[tokio::main]
async fn main() {
    println!("Starting DamRight Home Server...");
    
    let app_dir = damright_lib::resolve_app_dir();
    run_server(app_dir).await;
}

async fn run_server(app_dir: PathBuf) {
    println!("App Directory: {:?}", app_dir);
    std::fs::create_dir_all(&app_dir).expect("Could not create app directory");
    
    let conn = damright_lib::db::init_db(&app_dir).expect("Could not initialize database");
    let shared_conn = Arc::new(Mutex::new(conn));
    let cache_dir = app_dir.join("cache");
    std::fs::create_dir_all(&cache_dir).expect("Could not create cache directory");

    println!("Starting Axum server from database snapshot...");
    damright_lib::web_server::start_server(shared_conn, cache_dir).await;
}
