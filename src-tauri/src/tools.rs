//! Locating and running the bundled FFmpeg / FFprobe sidecars.
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Tauri copies `externalBin` sidecars next to the main executable (without the
/// target-triple suffix). In development we also fall back to `binaries/` and PATH.
pub fn tool_path(name: &str) -> PathBuf {
    let exe_name = format!("{}{}", name, std::env::consts::EXE_SUFFIX);
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(&exe_name);
            if p.exists() {
                return p;
            }
        }
    }
    let triple = format!("{}-{}", name, target_triple());
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("{}{}", triple, std::env::consts::EXE_SUFFIX));
    if dev.exists() && std::fs::metadata(&dev).map(|m| m.len() > 1024).unwrap_or(false) {
        return dev;
    }
    PathBuf::from(exe_name)
}

fn target_triple() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else {
        "unknown"
    }
}

/// A Command with no console window flashing on Windows.
pub fn command(name: &str) -> Command {
    let mut c = Command::new(tool_path(name));
    c.stdin(Stdio::null());
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// Run a tool to completion and return stdout, or stderr as the error.
pub fn run(name: &str, args: &[String]) -> Result<Vec<u8>, String> {
    let out = command(name)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("could not start {name}: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let tail: String = err.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(format!("{name} failed: {tail}"));
    }
    Ok(out.stdout)
}
