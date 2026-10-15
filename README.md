# MiniFX

A lightweight, After Effects–style motion graphics and video effects editor for Windows,
built with **Tauri 2 (Rust) + React 18 + TypeScript + Vite**, PixiJS for GPU preview and
FFmpeg for export. Small installer, fast start, everything undoable.

See **[BUILD.md](BUILD.md)** to get the Windows `.exe` built in the cloud by GitHub Actions.

## Features (stages 1–10)

| Area | What's in |
| --- | --- |
| Shell | Frameless window with custom title bar, menu bar (File, Edit, Composition, Layer, Effect, Window, Help), start screen with recent projects and comp presets |
| Workspace | Dockable panels (drag, tab, split, float, maximize with double-click or <kbd>`</kbd>); workspaces Default / Animation / Effects / Minimal; save / reset; layout restored on launch |
| Projects | `.msproj` JSON with versioned schema + migrations; Open / Save / Save As / Recent; autosave every N minutes + crash-recovery prompt; `.msproj` file association |
| Media | Import via menu, <kbd>Ctrl+I</kbd> or drag-drop from Explorer; ffprobe metadata; background thumbnails and proxies (FFmpeg, in Rust); offline detection |
| Viewer | PixiJS render of layers with transforms, parenting, opacity, blend modes (normal/add/multiply/screen/overlay); zoom (fit, 25–400 %, Ctrl+wheel), pan (Space+drag / H), Full/Half/Quarter, transparency grid, title/action safe; click-select, drag-move, scale/rotate handles, anchor-point tool (Y) |
| Timeline | Virtualized rows; eye / audio / solo / lock / label / parent; ruler scrub, CTI, work area, markers; reorder; trim edges and Alt+[ / Alt+]; twirl Transform; stopwatch keyframes; click / shift / marquee select, drag, copy/paste, F9 easy ease, right-click linear/bezier/hold; graph editor (value & speed) with bezier influence handles; snapping (Shift inverts); J/K/L, Home/End, PgUp/PgDn, U/P/S/R/T/A |
| Effects | Gaussian Blur, Fast Box Blur, Glow, Drop Shadow, Brightness & Contrast, Hue/Saturation, Curves, Fill, Tint, Displacement, Gradient Ramp, Invert — all params keyframeable, drag-scrub numbers, reset/reorder/toggle; adjustment layers; animation presets |
| Content | Text layers (font, size, tracking, leading, fill, stroke, align; edit on canvas); shape layers (rect, ellipse, polygon, pen paths); masks (rect/ellipse, add/subtract, feather, opacity) |
| Editing | Command-pattern undo/redo (200 steps, drags merged into one step), History panel, customizable shortcuts, RAM preview + frame cache with memory limit and cache bar, Preferences (memory, autosave, proxies, accent, language) |
| Export | Render Queue (Ctrl+M): MP4 H.264/H.265, ProRes 422/4444 (alpha), WebM VP9 (alpha), GIF, PNG sequence; audio mixdown; progress, ETA, cancel, open folder, Windows notification; output validated with ffprobe; logs per job |
| AI | AI Assistant panel: audits the project and your prompt, then shows the exact undoable commands (Co-pilot) or runs them (Auto-pilot) |

## Project layout

```
src/app        shell: title bar, menus, actions/shortcuts, workspace, dialogs, playback
src/panels     Project, Composition, Timeline, Effect Controls, Effects & Presets, Character,
               Info, Preview, Render Queue, History, AI Assistant
src/engine     data model, keyframe interpolation, transforms, effects, PixiJS renderer, migrations
src/store      Zustand stores (project + history, UI, settings)
src/commands   every edit as an undoable command; animation presets
src/lib        backend bridge (Tauri / browser fallback), project I/O, exporter, perf
src/ai         offline prompt → audit → plan engine
src-tauri      Rust: ffprobe/ffmpeg sidecars, thumbnails, proxies, waveforms, export pipe, files, logs
tests, e2e     Vitest unit tests, Playwright smoke test
```
