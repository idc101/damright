pub mod image;
pub mod metadata;
pub mod import;
pub mod file_ops;
pub mod audit;
pub mod export;
pub mod storage;
pub mod ranking;

pub use self::image::*;
pub use metadata::*;
pub use import::*;
pub use file_ops::*;
pub use audit::*;
pub use export::*;
pub use storage::*;
pub use ranking::*;

#[derive(serde::Serialize, Clone)]
pub struct ProgressPayload {
    pub message: String,
    pub current: usize,
    pub total: usize,
}

#[cfg(test)]
mod tests;

pub fn run_command_with_timeout(
    cmd: &mut std::process::Command,
    timeout: std::time::Duration,
) -> anyhow::Result<std::process::Output> {
    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    let start = std::time::Instant::now();
    loop {
        match child.try_wait()? {
            Some(_status) => {
                let output = child.wait_with_output()?;
                return Ok(output);
            }
            None => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    // Read partial output if any was written before process was killed
                    let output = child.wait_with_output().ok();
                    let stdout = output.as_ref().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
                    let stderr = output.as_ref().map(|o| String::from_utf8_lossy(&o.stderr).to_string()).unwrap_or_default();
                    anyhow::bail!(
                        "Command timed out after {:?}. stdout: '{}', stderr: '{}'",
                        timeout,
                        stdout,
                        stderr
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }
}
