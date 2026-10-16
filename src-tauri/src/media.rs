//! Media metadata (ffprobe), thumbnails, proxies and audio waveforms.
//! All heavy work runs on blocking worker threads, never on the UI thread.
use crate::files::cache_dir;
use crate::tools::{command, run};
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub kind: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub fps: f64,
    pub has_audio: bool,
    pub codec: String,
    pub size: u64,
}

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "svg"];

fn parse_rate(s: &str) -> f64 {
    let mut it = s.split('/');
    let n: f64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0.0);
    let d: f64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(1.0);
    if d == 0.0 { 0.0 } else { n / d }
}

/// Parse `ffprobe -print_format json -show_format -show_streams` output.
pub fn parse_probe(json: &str, path: &str) -> Result<MediaInfo, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("bad ffprobe output: {e}"))?;
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let video = streams.iter().find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"].as_i64().unwrap_or(0) == 0);
    let audio = streams.iter().find(|s| s["codec_type"] == "audio");
    let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let format_name = v["format"]["format_name"].as_str().unwrap_or("");
    let duration = v["format"]["duration"].as_str().and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0);
    let size = v["format"]["size"].as_str().and_then(|d| d.parse::<u64>().ok()).unwrap_or(0);
    let is_image = IMAGE_EXT.contains(&ext.as_str()) && ext != "gif" || format_name.contains("image2") || format_name.ends_with("_pipe");
    match video {
        Some(vs) => {
            let fps = parse_rate(vs["avg_frame_rate"].as_str().unwrap_or("0/1"));
            let fps = if fps > 0.0 { fps } else { parse_rate(vs["r_frame_rate"].as_str().unwrap_or("30/1")) };
            Ok(MediaInfo {
                kind: if is_image { "image".into() } else { "video".into() },
                width: vs["width"].as_u64().unwrap_or(0) as u32,
                height: vs["height"].as_u64().unwrap_or(0) as u32,
                duration: if is_image { 0.0 } else { duration },
                fps: if is_image { 0.0 } else { fps },
                has_audio: audio.is_some(),
                codec: vs["codec_name"].as_str().unwrap_or("?").to_string(),
                size,
            })
        }
        None => match audio {
            Some(a) => Ok(MediaInfo {
                kind: "audio".into(),
                width: 0,
                height: 0,
                duration,
                fps: 0.0,
                has_audio: true,
                codec: a["codec_name"].as_str().unwrap_or("?").to_string(),
                size,
            }),
            None => Err("file has no video or audio streams".into()),
        },
    }
}

pub fn probe_blocking(path: &str) -> Result<MediaInfo, String> {
    if !Path::new(path).exists() {
        return Err(format!("file not found: {path}"));
    }
    let out = run("ffprobe", &["-v".into(), "error".into(), "-print_format".into(), "json".into(), "-show_format".into(), "-show_streams".into(), path.into()])?;
    parse_probe(&String::from_utf8_lossy(&out), path)
}

#[tauri::command]
pub async fn probe_media(path: String) -> Result<MediaInfo, String> {
    tauri::async_runtime::spawn_blocking(move || probe_blocking(&path)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn make_thumbnail(app: AppHandle, path: String, id: String) -> Result<Option<String>, String> {
    let out = cache_dir(&app, "thumbs")?.join(format!("{}.jpg", id.replace(['/', '\\', '.'], "_")));
    let out_s = out.to_string_lossy().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        for seek in ["1", "0"] {
            let args: Vec<String> = vec!["-y".into(), "-v".into(), "error".into(), "-ss".into(), seek.into(), "-i".into(), path.clone(), "-frames:v".into(), "1".into(), "-vf".into(), "scale=320:-2".into(), out_s.clone()];
            if run("ffmpeg", &args).is_ok() && Path::new(&out_s).exists() {
                return Ok(Some(out_s));
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A horizontal strip of evenly spaced frames, shown on video clips in the timeline.
#[tauri::command]
pub async fn video_filmstrip(app: AppHandle, path: String, id: String, duration: f64, frames: u32) -> Result<Option<String>, String> {
    let frames = frames.clamp(4, 60);
    let out = cache_dir(&app, "filmstrips")?.join(format!("{}_{}.jpg", id.replace(['/', '\\', '.'], "_"), frames));
    let out_s = out.to_string_lossy().to_string();
    if out.exists() {
        return Ok(Some(out_s));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dur = if duration > 0.05 { duration } else { probe_blocking(&path).map(|m| m.duration).unwrap_or(1.0).max(0.05) };
        let rate = frames as f64 / dur;
        let vf = format!("fps={rate:.6},scale=-2:54,tile={frames}x1:padding=0");
        let args: Vec<String> = vec!["-y".into(), "-v".into(), "error".into(), "-i".into(), path.clone(), "-an".into(), "-vf".into(), vf, "-frames:v".into(), "1".into(), "-q:v".into(), "5".into(), out_s.clone()];
        if run("ffmpeg", &args).is_ok() && Path::new(&out_s).exists() {
            Ok(Some(out_s))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
struct ProxyProgress {
    id: String,
    progress: f64,
}

#[tauri::command]
pub async fn make_proxy(app: AppHandle, path: String, id: String, height: u32, crf: Option<u32>) -> Result<String, String> {
    // crf 26 = light editing proxy; ~18 = visually lossless "preview copy" for codecs the viewer cannot decode
    let crf = crf.unwrap_or(26).clamp(12, 35);
    let out = cache_dir(&app, "proxies")?.join(format!("{}_{}p_q{}.mp4", id.replace(['/', '\\', '.'], "_"), height, crf));
    let out_s = out.to_string_lossy().to_string();
    if out.exists() {
        return Ok(out_s);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let duration = probe_blocking(&path).map(|m| m.duration).unwrap_or(0.0);
        let tmp = format!("{out_s}.part.mp4");
        let mut child = command("ffmpeg")
            .args(["-y", "-v", "error", "-i", &path, "-vf", &format!("scale=-2:{height}"), "-c:v", "libx264", "-preset", "veryfast", "-crf", &crf.to_string(), "-pix_fmt", "yuv420p", "-g", "15", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", &tmp])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not start ffmpeg: {e}"))?;
        let mut stderr = child.stderr.take();
        let err_thread = std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(e) = stderr.as_mut() {
                let _ = e.read_to_string(&mut s);
            }
            s
        });
        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(us) = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms=")) {
                    if let Ok(v) = us.trim().parse::<f64>() {
                        if duration > 0.0 {
                            let p = (v / 1_000_000.0 / duration).clamp(0.0, 1.0);
                            let _ = app.emit("proxy-progress", ProxyProgress { id: id.clone(), progress: p });
                        }
                    }
                }
            }
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        let err = err_thread.join().unwrap_or_default();
        if !status.success() {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("proxy failed: {}", err.lines().last().unwrap_or("")));
        }
        std::fs::rename(&tmp, &out_s).map_err(|e| e.to_string())?;
        let _ = app.emit("proxy-progress", ProxyProgress { id, progress: 1.0 });
        Ok(out_s)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Peak envelope (0..1) of the audio in `buckets` slices, for timeline waveforms.
pub fn peaks(pcm: &[u8], buckets: usize) -> Vec<f32> {
    let samples: Vec<i16> = pcm.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
    if samples.is_empty() || buckets == 0 {
        return vec![0.0; buckets];
    }
    let per = (samples.len() as f64 / buckets as f64).max(1.0);
    (0..buckets)
        .map(|i| {
            let a = (i as f64 * per) as usize;
            let b = (((i + 1) as f64 * per) as usize).min(samples.len());
            samples[a.min(samples.len())..b].iter().map(|s| (*s as f32).abs() / 32768.0).fold(0.0, f32::max)
        })
        .collect()
}

#[tauri::command]
pub async fn audio_waveform(path: String, buckets: usize) -> Result<Vec<f32>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pcm = run("ffmpeg", &["-v".into(), "error".into(), "-i".into(), path, "-vn".into(), "-ac".into(), "1".into(), "-ar".into(), "8000".into(), "-f".into(), "s16le".into(), "-".into()])?;
        Ok(peaks(&pcm, buckets.clamp(1, 20_000)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_video_probe() {
        let json = r#"{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"avg_frame_rate":"30000/1001","disposition":{"attached_pic":0}},{"codec_type":"audio","codec_name":"aac"}],"format":{"format_name":"mov,mp4","duration":"12.5","size":"1000"}}"#;
        let m = parse_probe(json, "a.mp4").unwrap();
        assert_eq!(m.kind, "video");
        assert_eq!(m.width, 1920);
        assert!((m.fps - 29.97).abs() < 0.01);
        assert!(m.has_audio);
        assert_eq!(m.duration, 12.5);
    }

    #[test]
    fn parses_image_and_audio() {
        let img = r#"{"streams":[{"codec_type":"video","codec_name":"png","width":64,"height":32,"avg_frame_rate":"0/0","disposition":{"attached_pic":0}}],"format":{"format_name":"png_pipe","size":"10"}}"#;
        assert_eq!(parse_probe(img, "x.png").unwrap().kind, "image");
        let aud = r#"{"streams":[{"codec_type":"audio","codec_name":"mp3"}],"format":{"format_name":"mp3","duration":"3.0"}}"#;
        let a = parse_probe(aud, "x.mp3").unwrap();
        assert_eq!(a.kind, "audio");
        assert_eq!(a.duration, 3.0);
    }

    #[test]
    fn computes_peaks() {
        let mut pcm = Vec::new();
        for i in 0..100i16 {
            pcm.extend_from_slice(&(if i < 50 { 1000i16 } else { 16384i16 }).to_le_bytes());
        }
        let p = peaks(&pcm, 2);
        assert!(p[0] < 0.05 && p[1] > 0.49);
    }
}
