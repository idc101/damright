pub mod photo_commands;
pub mod source_commands;
pub mod system_commands;
pub mod icloud_commands;
pub mod sync_commands;

pub use photo_commands::*;
pub use source_commands::*;
pub use system_commands::*;
pub use icloud_commands::*;
pub use sync_commands::*;

#[macro_export]
macro_rules! handle_blocking {
    ($logic:expr) => {
        tauri::async_runtime::spawn_blocking(move || {
            $logic
        }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
    };
}
