//! Small file helpers: app-data storage (settings, layout, autosave), project
//! files, launch arguments and the error log.
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

pub struct LaunchFile(pub Mutex<Option<String>>);

fn safe_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err("invalid file name".into());
    }
    Ok(name)
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn cache_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join(sub);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Write via a temp file + rename so a crash never leaves a half-written file.
pub fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp-write");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
        f.write_all(content).map_err(|e| e.to_string())?;
        f.sync_all().ok();
    }
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

fn allowed_project_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if ext != "msproj" && ext != "json" {
        return Err("only .msproj and .json files can be read or written".into());
    }
    Ok(p)
}

#[tauri::command]
pub fn app_data_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let p = app_data_dir(&app)?.join(safe_name(&name)?);
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_data_write(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let p = app_data_dir(&app)?.join(safe_name(&name)?);
    atomic_write(&p, content.as_bytes())
}

#[tauri::command]
pub fn app_data_remove(app: AppHandle, name: String) -> Result<(), String> {
    let p = app_data_dir(&app)?.join(safe_name(&name)?);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let p = allowed_project_path(&path)?;
    fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = allowed_project_path(&path)?;
    atomic_write(&p, content.as_bytes())
}

#[tauri::command]
pub fn get_launch_file(state: State<'_, LaunchFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

pub fn append_log(app: &AppHandle, file: &str, line: &str) {
    if let Ok(dir) = log_dir(app) {
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join(file)) {
            let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let _ = writeln!(f, "[{ts}] {line}");
        }
    }
}

#[tauri::command]
pub fn write_log(app: AppHandle, line: String) {
    append_log(&app, "minifx.log", &line);
}

/// First command-line argument that looks like a project file (file association).
pub fn project_arg(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| a.to_ascii_lowercase().ends_with(".msproj") && Path::new(a).exists()).cloned()
}

#[tauri::command]
pub fn get_log_dir(app: AppHandle) -> Result<String, String> {
    Ok(log_dir(&app)?.join("minifx.log").to_string_lossy().to_string())
}

/// Optional video to include in the headless self-test (developers/CI only).
#[tauri::command]
pub fn selftest_video() -> Option<String> {
    std::env::var("MINIFX_SELFTEST_VIDEO").ok().filter(|s| !s.is_empty())
}

/// Path for the headless self-test export (only set by developers/CI).
#[tauri::command]
pub fn selftest_output() -> Option<String> {
    std::env::var("MINIFX_SELFTEST_OUT").ok().filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn selftest_exit(app: AppHandle) {
    if std::env::var("MINIFX_SELFTEST_OUT").is_ok() {
        app.exit(0);
    }
}

/// F12 in the app: opens the WebView developer tools (for diagnosing user reports).
#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

/// Quit the app (called by the UI after it has dealt with unsaved changes).
#[tauri::command]
pub fn exit_app(app: AppHandle) {
    append_log(&app, "minifx.log", "exit requested by UI");
    app.exit(0);
}
