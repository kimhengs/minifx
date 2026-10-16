# MiniFX — Prompts សម្រាប់ Claude Code

## របៀបប្រើ (អានមុន)

1. **ដំណើរការ Claude Code នៅលើកុំព្យូទ័រ Windows របស់អ្នក** មិនមែននៅលើ Cloud ទេ។ ហេតុផល៖ App ប្រើ WebView2 ដែលមានតែលើ Windows ប៉ុណ្ណោះ។ ពេលដំណើរការនៅលើម៉ាស៊ីនអ្នក Claude អាចបើក App សាក និងមើល Error ដោយផ្ទាល់ នេះហើយជាមូលហេតុធំបំផុតដែលធ្វើឲ្យលទ្ធផលល្អជាង។
   ```powershell
   git clone https://github.com/kimhengs/minifx
   cd minifx
   claude
   ```
2. **មួយ Stage ក្នុងមួយ Session។** Copy Prompt មួយ Stage ទៅដាក់ក្នុង Claude Code។ ពេលចប់ ពិនិត្យលទ្ធផល ហើយ Commit រួចវាយ `/clear` មុននឹងចាប់ផ្តើម Stage បន្ទាប់។
3. **ប្រើ Plan mode សម្រាប់ Stage ធំៗ** (ចុច Shift+Tab ពីរដង)។ ឲ្យ Claude សរសេរផែនការសិន អ្នកអានហើយយល់ព្រម ទើបវាចាប់ផ្តើមសរសេរកូដ។
4. **តេស្តខ្លួនឯងរាល់ Stage**៖ បើក App, Import វីដេអូពិតពីទូរស័ព្ទ, ចាក់, កាត់ និង Export។ បើមានបញ្ហា Copy Error ឬ Screenshot ផ្ញើទៅ Claude វិញ។
5. ក្នុង Repo មាន File `CLAUDE.md` រួចហើយ ហើយ Claude Code អានវាដោយស្វ័យប្រវត្តិ។ ដូច្នេះវាយល់ពី Project, Command និងកំហុសដែលធ្លាប់កើតឡើងរួចហើយ។

> ចំណាំអំពី "Support file Adobe"៖ **PSD** ធ្វើបាន (Stage 8)។ **Premiere XML / FCPXML / EDL** ក៏ធ្វើបានដែរ។ ប៉ុន្តែ **.aep (After Effects project) និង .prproj** ជា Format បិទរបស់ Adobe ដែលគ្មានឯកសារពន្យល់ជាសាធារណៈ ដូច្នេះមិនអាចបើកបានត្រឹមត្រូវទេ។ ជំនួសវិញ យើងប្រើ XML ដែល Premiere/AE អាច Export ចេញបាន។

---

## Stage 0 — Windows setup + audit (ធ្វើមុនគេ)

```
Read CLAUDE.md first. Then set this repo up to build and run on this Windows machine:
- Check/install prerequisites (Node 20+, Rust stable MSVC toolchain, VS Build Tools C++ workload, WebView2).
  Tell me exactly what to install if something is missing instead of guessing.
- Download the pinned FFmpeg 7.1.1 (GyanD essentials) and place the sidecars at
  src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe and ffprobe-x86_64-pc-windows-msvc.exe (script it: scripts/get-ffmpeg.ps1).
- Run typecheck, vitest, cargo test, then `npm run tauri dev`.
Then do a real audit on Windows: import a phone video (H.264 and HEVC), play it, scrub, trim, add text + an effect,
export MP4. Read %LOCALAPPDATA%\com.minifx.app\logs\minifx.log and the devtools console (F12).
Write every bug you find to docs/AUDIT.md (steps, expected, actual, severity), fix the critical ones,
and re-test each fix in the running app. Don't claim something works without having seen it work.
```

---

## Stage 1 — Timeline ដូច Video Editor ពិតប្រាកដ

```
Goal: editing a video in MiniFX should feel like Premiere Pro / CapCut, while keeping the AE-style layer + keyframe
model for motion graphics.

Build an "Edit" timeline mode (toggle with the existing AE layer view):
- Tracks: V1..Vn and A1..An, add/remove/rename/lock/mute/solo/hide tracks, adjustable track height
  (tall video tracks show the filmstrip, audio tracks show the waveform).
- Magnetic main track (optional, like CapCut) + free placement on other tracks.
- Tools/shortcuts: Selection (V), Razor (C) and Split at playhead (Ctrl+K / S), Ripple delete (Shift+Delete),
  Ripple trim (Q/W), Roll, Slip (Y), Slide (U), Track select forward (A), Lift/Extract, Insert/Overwrite (, and .).
- Linked video+audio clips (unlink with Alt-drag; J-cut / L-cut), snapping to clip edges/playhead/markers with a visible snap line.
- Multi-select, marquee, copy/paste/duplicate, nudge by frame (Alt+←/→), clip speed (%, reverse, freeze frame),
  clip volume, enable/disable clip, color labels.
- Zoom (Ctrl+wheel, = / -, \ to fit), smooth horizontal scroll, playhead follow while playing.
- Everything goes through src/commands so undo/redo and the AI can use it. Bump SCHEMA_VERSION + write a migration.
Performance budget: 300 clips on 10 tracks scroll and zoom at 60 fps (virtualize, no per-frame re-render of rows).
Add unit tests for split/ripple/trim/slip math and a Playwright test that imports 3 clips, splits, ripple-deletes,
and checks the final clip positions. Show me a screenshot of the finished timeline.
```

---

## Stage 2 — Playback រលូន 60fps (Engine ថ្មី)

```
Goal: smooth, frame-accurate playback and scrubbing like a professional editor.
Today each layer drives an HTMLVideoElement (seek-based). Replace the hot path with a real decode engine:
- Use WebCodecs VideoDecoder (available in WebView2) with a demuxer (mp4box.js for MP4/MOV, a WebM demuxer),
  keep a per-clip decoded-frame ring buffer (VideoFrame → GPU texture), pre-roll the next clip before cuts,
  decode ahead while playing, and close frames to avoid leaks. Fall back to the current element path for
  unsupported containers, and to H.264 proxies (src-tauri make_proxy) for heavy codecs.
- Audio: Web Audio API graph per track (gain, pan, mute/solo), the audio clock is the master clock;
  video follows it. No drift after 10 minutes of playback.
- Scrubbing: show the nearest keyframe instantly, refine to the exact frame within ~100 ms. J/K/L shuttle with
  audio scrubbing.
- Playback resolution (Full/Half/Quarter) and automatic drop-to-half when the frame budget is missed.
- Add a perf overlay (decode ms, render ms, dropped frames) and a benchmark script: 3 layers of 1080p H.264
  + text + glow must hold 60 fps on an integrated-GPU laptop; 4K must play with proxies.
Measure before and after and report the numbers.
```

---

## Stage 3 — Transitions

```
Add a transitions system: Cross Dissolve, Dip to Black/White, Wipe (4 directions), Slide, Push, Zoom, Spin, Blur,
Glitch, Light Leak, plus "smooth zoom" and whip-pan style. Drag a transition onto a cut (or Ctrl+D for default),
resize it on the timeline, edit duration/easing/direction in Effect Controls. Implement as GPU shaders that
blend the outgoing and incoming frames (needs handles: if clips lack extra media, offer to trim). Show animated
thumbnails in the Effects & Presets panel. Export must match preview frame-for-frame (add a test comparing an
exported frame with the preview render).
```

---

## Stage 4 — Text, Titles និង Subtitle

```
Make text professional:
- Rich text layer: font picker with system fonts + bundled Khmer fonts (Kantumruy Pro, Battambang, Moul),
  correct Khmer shaping (test with complex clusters like "ព្រះរាជាណាចក្រ"), fill/stroke/shadow/background box,
  per-character tracking/leading, alignment, paragraph box with auto-wrap.
- Text animators like AE: per-character / per-word / per-line range selector with offset, opacity, position,
  scale, rotation, blur; 30+ presets (typewriter, pop, bounce, wave, slide-up, blur-in, karaoke highlight).
- Title templates: lower thirds, call-outs, subscribe button, end cards, editable via a few exposed fields.
- Subtitle track: import/export SRT/VTT, style presets, burn-in on export or export as sidecar file.
```

---

## Stage 5 — Effects, Color Grading, Keying

```
Grow the effect library to 40+ GPU effects with keyframable parameters and per-effect reset:
Color: Lumetri-style panel (exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance,
saturation), RGB curves + Hue-vs-Sat curves, color wheels (lift/gamma/gain), .cube LUT import (3D LUT on GPU),
scopes (waveform, vectorscope, histogram) computed on the GPU.
Keying: Chroma key (green/blue) with spill suppression + matte choke/soften, Luma key, track matte.
Blur/Distort: Gaussian, directional, radial, lens blur, sharpen, wave warp, turbulent displace, mirror, transform,
corner pin, lens distortion. Stylize: glow, VHS, film grain, chromatic aberration, vignette, pixelate, posterize.
Time: echo/trails, posterize time. Stabilizer (ffmpeg vidstab in Rust, applied as a transform track).
Effects are GLSL filters in one registry so plugins (Stage 9) can add more the same way. Effect stack drag-reorder,
enable toggle, copy/paste effects, save effect presets.
```

---

## Stage 6 — Audio

```
Add an audio mixer panel (per-track faders, pan, meters with peak hold, master bus), clip gain + volume keyframes
(rubber band on the clip), fade handles on clip corners, crossfades, normalize to -14 LUFS (ffmpeg loudnorm),
noise reduction (afftdn / arnndn), voice enhance preset, music auto-ducking under dialogue (sidechain),
beat detection markers for music (to cut on the beat). Recording a voice-over from the microphone onto a new track.
```

---

## Stage 7 — AI ពិតប្រាកដ (Claude API) — "Auto-pilot edit"

```
Replace the offline rule-based assistant (src/ai/assistant.ts) with a real agent using the Anthropic Messages API
and tool use:
- Settings: user pastes their Anthropic API key; store it in the OS keychain (Rust `keyring` crate), never in
  project files or logs. Call the API from Rust (reqwest) so the key never touches the webview.
- Expose MiniFX edits as tools generated from src/commands (add_clip, split, ripple_delete, set_keyframe,
  add_effect, add_text, add_transition, set_speed, color_grade, add_subtitles, export, …) with JSON schemas.
- "Audit" step before editing: probe all footage (ffprobe), scene-change detection, silence detection, loudness,
  a few downscaled frames per clip sent as images so the model can see the content, and the transcript (below).
  Show the audit to the user.
- The model returns a plan; show it as a readable checklist + a timeline diff preview; the user can approve all,
  approve some, or edit the prompt. Applying the plan = one undo step.
- Transcription: bundle whisper.cpp as a sidecar (Khmer + English models, download on first use) for auto
  subtitles, "cut the silences", "remove ums", text-based editing (delete words in the transcript → cuts).
- Prompts to support out of the box (test each one end-to-end): "make a 30s TikTok from these clips with
  captions and music on the beat", "remove silences", "add Khmer subtitles", "color grade warm cinematic",
  "add a title at the start and a subscribe end card".
Stream progress in the AI panel, handle errors/rate limits, and log token usage per request.
```

---

## Stage 8 — PSD + ការផ្លាស់ប្តូរ File ជាមួយ Adobe

```
- PSD import with ag-psd: choose "merged" or "layers as composition"; each PSD layer becomes a MiniFX layer with
  position, opacity, blend mode, visibility, groups → precomps, text layers kept editable when possible,
  layer masks. Re-import when the PSD changes on disk (file watcher).
- Also import: PNG sequences, SVG (as shape layers), GIF, Lottie JSON (playback as a layer).
- Interop: import/export Final Cut Pro XML (FCPXML) and Premiere-compatible XML (xmeml) and CMX3600 EDL for
  cuts/tracks/transitions/markers, so projects can move to/from Premiere/Resolve. Explain in the UI that .aep/.prproj
  are closed formats and point users to XML export.
Test with real PSDs that have groups, masks and text, and with an XML exported from Premiere/Resolve.
```

---

## Stage 9 — Plugin System (ដូច After Effects)

```
Design a plugin system:
- A plugin is a folder (or .minifxplugin zip) in %APPDATA%\MiniFX\plugins with manifest.json (id, name, version,
  type, params schema, permissions).
- Types: (1) GLSL effect plugins (fragment shader + params → appear in Effects & Presets, keyframable),
  (2) preset packs (animation/text/transition presets as JSON), (3) script plugins (JS running in a sandboxed
  Web Worker with a small, versioned API: read/modify the project through commands, add panels via declarative UI).
- Plugin manager panel: install from file, enable/disable, remove, show errors. A crashing plugin must never
  crash the app.
- Write 3 example plugins + docs/PLUGINS.md with the API reference.
```

---

## Stage 10 — Export លឿន + Presets

```
- Export presets: TikTok/Reels/Shorts 1080×1920, YouTube 1080p/4K, Instagram square, ProRes 422 (mov), GIF,
  PNG sequence, audio only (mp3/wav), transparent (ProRes 4444 / WebM alpha).
- Hardware encoding: detect NVENC / Intel QSV / AMD AMF in ffmpeg at startup and use them when available
  (fallback libx264), show the encoder used.
- Faster pipeline: render in an OffscreenCanvas worker, async GPU readback (PBO / readPixels into a pool),
  pipeline rendering and encoding in parallel, send frames to Rust without copies. Target: 1080p30 with
  2 video layers + text exports faster than real time on a mid laptop. Background export while editing,
  queue, ETA, notification when done, "Smart render" passthrough for untouched H.264 segments.
Report export speed before/after.
```

---

## Stage 11 — UI ស្អាត និងងាយប្រើ

```
Polish the UI to feel like a professional editor:
- Consistent design system (spacing, type scale, icons, focus states, hover/pressed states), dark theme like
  Premiere/CapCut, crisp at 100/125/150% Windows scaling.
- Workspaces: Editing, Motion Graphics, Color, Audio, AI — one click switch.
- Welcome screen with recent projects + templates; first-run tour; empty states that tell the user what to do.
- Media browser with thumbnails/hover-scrub, bins/folders, search, favorites.
- Full keyboard map compatible with Premiere shortcuts (with a visual keyboard shortcut editor).
- Full Khmer + English UI (all strings through i18n), Khmer-friendly fonts.
- Undo history panel, autosave + crash recovery verified, helpful error messages (no raw stack traces for users).
Take screenshots of every panel and fix anything misaligned or clipped.
```

---

## Stage 12 — Release ពេញលេញ

```
- Installer: bundle FFmpeg inside the installer (full offline install, no download step), per-user install,
  file associations, desktop/start menu shortcuts, clean uninstall.
- Make the GitHub Actions Windows build green (tests → build → draft release with setup.exe + msi).
- Auto-update with the Tauri updater (signed update manifest on GitHub Releases).
- Optional code signing (document how to buy/use a certificate) so SmartScreen stops warning.
- Crash/diagnostic report: "Help › Report a problem" zips the log + system info for the user to send.
- Version 1.0.0 checklist in docs/RELEASE.md and run it.
```

---

## Prompt ជំនួយ (ប្រើពេលណាក៏បាន)

**ពេលមាន Bug៖**
```
Here is what I did, what I expected and what happened: <...>. Screenshot/log attached.
Reproduce it first (write a failing test or a Playwright script), then fix the root cause, then show me the test passing
and re-check it in the running app.
```

**ពេលចង់ឲ្យលឿនជាងនេះ៖**
```
Playback/export feels slow when <...>. Profile it (Chrome devtools performance trace in the webview, Rust timing logs),
find the top 3 bottlenecks with numbers, fix them, and show before/after measurements.
```

**ពេលចង់ពិនិត្យគុណភាពកូដ៖**
```
Review the changes since <commit> like a senior engineer: correctness bugs, race conditions, memory leaks (video frames,
textures, listeners), missing undo support, missing tests. Fix what you find and list what you changed.
```
