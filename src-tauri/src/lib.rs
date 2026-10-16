mod export;
mod files;
mod media;
mod tools;

use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let launch = files::project_arg(&args);

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // A second launch (e.g. double-clicking another .msproj) focuses the
        // running window and asks it to open the file.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(p) = files::project_arg(&argv) {
                let _ = app.emit("open-project", p);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(files::LaunchFile(Mutex::new(launch)))
        .manage(export::Exports::default())
        .invoke_handler(tauri::generate_handler![
            files::app_data_read,
            files::app_data_write,
            files::app_data_remove,
            files::read_text_file,
            files::write_text_file,
            files::get_launch_file,
            files::write_log,
            files::get_log_dir,
            files::open_devtools,
            files::selftest_output,
            files::selftest_exit,
            media::probe_media,
            media::make_thumbnail,
            media::make_proxy,
            media::audio_waveform,
            export::export_start,
            export::export_frame,
            export::export_finish,
            export::export_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MiniFX");
}
