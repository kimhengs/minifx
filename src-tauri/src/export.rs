//! Export pipeline: the frontend renders each frame with WebGL at full quality
//! and sends raw RGBA bytes here; we pipe them into FFmpeg's stdin, mix the
//! audio layers, then validate the result with ffprobe.
use crate::files::{append_log, log_dir};
use crate::tools::{command, run};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioClip {
    pub path: String,
    pub comp_start: f64,
    pub src_start: f64,
    pub duration: f64,
    pub volume_db: f64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSpec {
    pub output: String,
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub quality: u32,
    pub audio: Vec<AudioClip>,
    pub total_frames: u64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub frames: u64,
    pub duration: f64,
    pub path: String,
    pub log_path: String,
}

pub struct Encoder {
    child: Child,
    stdin: Option<ChildStdin>,
    stderr_thread: Option<JoinHandle<String>>,
    pub spec: ExportSpec,
    pub frames_written: u64,
    pub output: PathBuf,
    pub log_path: PathBuf,
}

/// Output path actually written (PNG sequences go into a folder of numbered files).
pub fn resolve_output(spec: &ExportSpec) -> PathBuf {
    let out = PathBuf::from(&spec.output);
    if spec.format == "png" {
        let stem = out.file_stem().and_then(|s| s.to_str()).unwrap_or("frames").to_string();
        let dir = out.parent().unwrap_or(Path::new(".")).join(format!("{stem}_frames"));
        return dir.join(format!("{stem}_%05d.png"));
    }
    out
}

pub fn build_args(spec: &ExportSpec, output: &Path) -> Vec<String> {
    let mut a: Vec<String> = vec!["-y", "-hide_banner", "-loglevel", "warning", "-f", "rawvideo", "-pix_fmt", "rgba", "-s"].into_iter().map(String::from).collect();
    a.push(format!("{}x{}", spec.width, spec.height));
    a.push("-r".into());
    a.push(format!("{}", spec.fps));
    a.push("-i".into());
    a.push("pipe:0".into());

    let with_audio = !spec.audio.is_empty() && !matches!(spec.format.as_str(), "gif" | "png");
    if with_audio {
        for c in &spec.audio {
            a.extend(["-ss".into(), format!("{:.3}", c.src_start.max(0.0)), "-t".into(), format!("{:.3}", c.duration.max(0.01)), "-i".into(), c.path.clone()]);
        }
    }
    let total_secs = spec.total_frames as f64 / spec.fps.max(1.0);

    let mut filters: Vec<String> = Vec::new();
    if spec.format == "gif" {
        filters.push("[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a[v]".into());
    }
    if with_audio {
        let mut labels = String::new();
        for (i, c) in spec.audio.iter().enumerate() {
            let delay = (c.comp_start.max(0.0) * 1000.0).round() as i64;
            filters.push(format!("[{}:a]aresample=48000,adelay={delay}|{delay},volume={:.2}dB[a{i}]", i + 1, c.volume_db));
            labels.push_str(&format!("[a{i}]"));
        }
        filters.push(format!("{labels}amix=inputs={}:normalize=0:dropout_transition=0,apad,atrim=0:{total_secs:.3}[aout]", spec.audio.len()));
    }
    if !filters.is_empty() {
        a.push("-filter_complex".into());
        a.push(filters.join(";"));
    }
    a.push("-map".into());
    a.push(if spec.format == "gif" { "[v]".into() } else { "0:v".into() });
    if with_audio {
        a.push("-map".into());
        a.push("[aout]".into());
    }

    let q = spec.quality.to_string();
    let push = |a: &mut Vec<String>, xs: &[&str]| a.extend(xs.iter().map(|s| s.to_string()));
    match spec.format.as_str() {
        "h265" => push(&mut a, &["-c:v", "libx265", "-preset", "medium", "-crf", &q, "-pix_fmt", "yuv420p", "-tag:v", "hvc1", "-movflags", "+faststart"]),
        "prores422" => push(&mut a, &["-c:v", "prores_ks", "-profile:v", "2", "-pix_fmt", "yuv422p10le", "-vendor", "apl0"]),
        "prores4444" => push(&mut a, &["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-alpha_bits", "16", "-vendor", "apl0"]),
        "vp9" => push(&mut a, &["-c:v", "libvpx-vp9", "-crf", &q, "-b:v", "0", "-pix_fmt", "yuva420p", "-row-mt", "1", "-auto-alt-ref", "0"]),
        "gif" => push(&mut a, &["-loop", "0"]),
        "png" => push(&mut a, &["-c:v", "png", "-pix_fmt", "rgba", "-f", "image2", "-start_number", "0"]),
        _ => push(&mut a, &["-c:v", "libx264", "-preset", "medium", "-crf", &q, "-pix_fmt", "yuv420p", "-movflags", "+faststart"]),
    }
    if with_audio {
        match spec.format.as_str() {
            "prores422" | "prores4444" => push(&mut a, &["-c:a", "pcm_s16le"]),
            "vp9" => push(&mut a, &["-c:a", "libopus", "-b:a", "160k"]),
            _ => push(&mut a, &["-c:a", "aac", "-b:a", "192k"]),
        }
        a.push("-shortest".into());
    }
    a.push(output.to_string_lossy().to_string());
    a
}

impl Encoder {
    pub fn start(spec: ExportSpec, log_path: PathBuf) -> Result<Encoder, String> {
        if spec.width == 0 || spec.height == 0 || spec.width % 2 == 1 || spec.height % 2 == 1 {
            return Err("width and height must be even and non-zero".into());
        }
        let output = resolve_output(&spec);
        if let Some(dir) = output.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("cannot create output folder: {e}"))?;
        }
        let args = build_args(&spec, &output);
        let _ = fs::write(&log_path, format!("ffmpeg {}\n\n", args.join(" ")));
        let mut child = command("ffmpeg")
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not start ffmpeg: {e}"))?;
        let stdin = child.stdin.take();
        let mut stderr = child.stderr.take();
        // drain stderr continuously so ffmpeg never blocks on a full pipe
        let lp = log_path.clone();
        let stderr_thread = std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(e) = stderr.as_mut() {
                let _ = e.read_to_string(&mut s);
            }
            if let Ok(mut f) = fs::OpenOptions::new().append(true).open(&lp) {
                let _ = f.write_all(s.as_bytes());
            }
            s
        });
        Ok(Encoder { child, stdin, stderr_thread: Some(stderr_thread), spec, frames_written: 0, output, log_path })
    }

    pub fn push(&mut self, rgba: &[u8]) -> Result<(), String> {
        let expected = self.spec.width as usize * self.spec.height as usize * 4;
        if rgba.len() != expected {
            return Err(format!("frame has {} bytes, expected {expected}", rgba.len()));
        }
        let stdin = self.stdin.as_mut().ok_or("encoder already finished")?;
        stdin.write_all(rgba).map_err(|e| format!("ffmpeg stopped accepting frames ({e}). See log: {}", self.log_path.display()))?;
        self.frames_written += 1;
        Ok(())
    }

    pub fn finish(mut self) -> Result<ExportResult, String> {
        drop(self.stdin.take()); // EOF tells ffmpeg we're done
        let status = self.child.wait().map_err(|e| e.to_string())?;
        let err = self.stderr_thread.take().and_then(|t| t.join().ok()).unwrap_or_default();
        if !status.success() {
            return Err(format!("ffmpeg failed: {}", err.lines().last().unwrap_or("unknown error")));
        }
        validate(&self.spec, &self.output, &self.log_path)
    }

    pub fn cancel(mut self) {
        drop(self.stdin.take());
        let _ = self.child.kill();
        let _ = self.child.wait();
        if self.spec.format != "png" {
            let _ = fs::remove_file(&self.output);
        }
    }
}

/// Count frames / duration in the written file to make sure the export is complete.
pub fn validate(spec: &ExportSpec, output: &Path, log_path: &Path) -> Result<ExportResult, String> {
    let log = log_path.to_string_lossy().to_string();
    if spec.format == "png" {
        let dir = output.parent().unwrap_or(Path::new("."));
        let n = fs::read_dir(dir).map(|r| r.filter_map(Result::ok).filter(|e| e.path().extension().map(|x| x == "png").unwrap_or(false)).count()).unwrap_or(0) as u64;
        if n != spec.total_frames {
            return Err(format!("expected {} PNG files, found {n}", spec.total_frames));
        }
        return Ok(ExportResult { frames: n, duration: n as f64 / spec.fps, path: dir.to_string_lossy().to_string(), log_path: log });
    }
    let out = run(
        "ffprobe",
        &["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets:format=duration", "-of", "json", &output.to_string_lossy()]
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>(),
    )?;
    let v: Value = serde_json::from_slice(&out).map_err(|e| e.to_string())?;
    let frames = v["streams"][0]["nb_read_packets"].as_str().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let duration = v["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    if frames == 0 {
        return Err(format!("output has no video frames. See log: {log}"));
    }
    Ok(ExportResult { frames, duration, path: output.to_string_lossy().to_string(), log_path: log })
}

// ---------------- Tauri commands ----------------
#[derive(Default)]
pub struct Exports {
    jobs: Mutex<HashMap<String, Arc<Mutex<Option<Encoder>>>>>,
    counter: AtomicU64,
}

fn job(state: &Exports, id: &str) -> Result<Arc<Mutex<Option<Encoder>>>, String> {
    state.jobs.lock().map_err(|e| e.to_string())?.get(id).cloned().ok_or_else(|| format!("unknown export job {id}"))
}

#[tauri::command]
pub async fn export_start(app: AppHandle, state: State<'_, Exports>, spec: ExportSpec) -> Result<String, String> {
    let n = state.counter.fetch_add(1, Ordering::SeqCst);
    let id = format!("job{n}_{}", std::process::id());
    let log_path = log_dir(&app)?.join(format!("export-{id}.log"));
    let enc = tauri::async_runtime::spawn_blocking(move || Encoder::start(spec, log_path)).await.map_err(|e| e.to_string())??;
    state.jobs.lock().map_err(|e| e.to_string())?.insert(id.clone(), Arc::new(Mutex::new(Some(enc))));
    Ok(id)
}

#[tauri::command]
pub async fn export_frame(state: State<'_, Exports>, request: Request<'_>) -> Result<(), String> {
    let id = request.headers().get("x-job-id").and_then(|v| v.to_str().ok()).ok_or("missing x-job-id header")?.to_string();
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(_) => return Err("expected raw frame bytes".into()),
    };
    let slot = job(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut g = slot.lock().map_err(|e| e.to_string())?;
        g.as_mut().ok_or("job finished")?.push(&bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_finish(app: AppHandle, state: State<'_, Exports>, job_id: String) -> Result<ExportResult, String> {
    let slot = job(&state, &job_id)?;
    state.jobs.lock().map_err(|e| e.to_string())?.remove(&job_id);
    let res = tauri::async_runtime::spawn_blocking(move || {
        let enc = slot.lock().map_err(|e| e.to_string())?.take().ok_or("job already finished")?;
        enc.finish()
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Err(e) = &res {
        append_log(&app, "minifx.log", &format!("export {job_id} failed: {e}"));
    }
    res
}

#[tauri::command]
pub async fn export_cancel(state: State<'_, Exports>, job_id: String) -> Result<(), String> {
    let slot = match job(&state, &job_id) {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    state.jobs.lock().map_err(|e| e.to_string())?.remove(&job_id);
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(mut g) = slot.lock() {
            if let Some(enc) = g.take() {
                enc.cancel();
            }
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(format: &str, out: &Path, frames: u64) -> ExportSpec {
        ExportSpec { output: out.to_string_lossy().to_string(), format: format.into(), width: 64, height: 36, fps: 30.0, quality: 23, audio: vec![], total_frames: frames }
    }

    fn frame(i: u64) -> Vec<u8> {
        let mut v = vec![0u8; 64 * 36 * 4];
        for (n, px) in v.chunks_exact_mut(4).enumerate() {
            px[0] = ((n as u64 + i * 7) % 255) as u8;
            px[1] = (i * 9 % 255) as u8;
            px[2] = 128;
            px[3] = 255;
        }
        v
    }

    #[test]
    fn args_contain_codec_and_alpha() {
        let out = Path::new("out.mov");
        let a = build_args(&spec("prores4444", out, 10), out).join(" ");
        assert!(a.contains("prores_ks") && a.contains("yuva444p10le") && a.contains("64x36"));
        let g = build_args(&spec("gif", Path::new("o.gif"), 10), Path::new("o.gif")).join(" ");
        assert!(g.contains("palettegen"));
    }

    /// End-to-end: pipe 60 raw frames into the real ffmpeg and validate the file.
    /// Skipped automatically when ffmpeg is not installed.
    #[test]
    fn exports_two_seconds_of_h264() {
        if run("ffmpeg", &["-version".to_string()]).is_err() {
            eprintln!("ffmpeg not found, skipping");
            return;
        }
        let dir = std::env::temp_dir().join(format!("minifx-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        for fmt in ["h264", "vp9", "gif", "png"] {
            let ext = match fmt { "vp9" => "webm", "gif" => "gif", "png" => "png", _ => "mp4" };
            let out = dir.join(format!("test.{ext}"));
            let s = spec(fmt, &out, 60);
            let mut enc = Encoder::start(s, dir.join(format!("{fmt}.log"))).unwrap();
            for i in 0..60 {
                enc.push(&frame(i)).unwrap();
            }
            let r = enc.finish().unwrap_or_else(|e| panic!("{fmt}: {e}"));
            assert!((r.frames as i64 - 60).abs() <= 1, "{fmt}: got {} frames", r.frames);
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
