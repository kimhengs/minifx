# MiniFX — project guide for Claude Code

MiniFX is a lightweight desktop video editor + motion-graphics tool (After Effects / CapCut style)
for Windows. Tauri 2 (Rust) backend, React 18 + TypeScript (strict) frontend, PixiJS v8 (WebGL)
renderer, FFmpeg sidecars for decode/encode. The owner (GitHub: kimhengs) speaks Khmer: answer in
Khmer with English technical terms when talking to them.

## Commands
- `npm run dev` – Vite dev server (browser mode, port 1420). Desktop-only features fall back.
- `npm run tauri dev` – desktop app with hot reload (needs Rust + WebView2; on Windows needs MSVC build tools).
- `npm run typecheck` · `npm test` (Vitest, `tests/**/*.test.ts`) · `cd src-tauri && cargo test`
- `npx playwright test` – UI smoke test against `vite preview` (set `PW_CHROMIUM` to a Chrome path if Playwright browsers are missing).
- `npm run tauri build` – installers in `src-tauri/target/release/bundle/` (needs FFmpeg sidecars, see below).
- Headless desktop self-test: `MINIFX_SELFTEST_OUT=out.mp4 [MINIFX_SELFTEST_VIDEO=clip.mp4] <app exe>` builds a comp,
  exports through the real pipeline, writes `SELFTEST done…` to the log and exits.

Always run typecheck + tests before saying something works. For UI changes, also look at the result
(Playwright screenshot or the running app) — a passing build is not proof the UI renders.

## Layout
- `src/engine/` – pure model: `types.ts` (Project/Composition/Layer/Keyframe/Effect/Mask/MediaItem),
  `interpolation.ts` (keyframes, AE-style bezier influence), `evaluate.ts` (transforms, parenting, render order),
  `effects.ts` (effect registry), `factory.ts`, `migrations.ts` (SCHEMA_VERSION — bump + migrate on model changes),
  `renderer.ts` (CompRenderer: PixiJS scene from the model; also used offscreen for export), `mediaPool.ts`
  (one <video>/<audio> element per layer, textures, sync/seek).
- `src/store/` – Zustand + Immer. `projectStore.ts`: `execute(label, recipe)` records patches for undo/redo;
  property paths like `"transform.x"`, `"shape.size"`, `"fx.<effectId>.<param>"`. `uiStore.ts` is non-undoable UI state.
- `src/commands/` – every user edit goes through here (also used by the AI assistant). Add new edits here, not in panels.
- `src/panels/` – dockview panels (Timeline, Composition viewer, Project, Effect Controls, AI, small panels).
- `src/app/` – shell: App boot, actions/shortcuts registry (`actions.ts`), workspace layouts, dialogs, playback (J/K/L),
  RAM preview, diagnostics (error boundary, on-screen error banner, boot log).
- `src/lib/` – `backend.ts` (every Tauri `invoke` + browser fallbacks), `projectIO.ts` (new/open/save/import/autosave),
  `exporter.ts` (render queue → raw RGBA frames → Rust → ffmpeg stdin), `i18n.ts` (Khmer UI strings).
- `src/ai/assistant.ts` – offline prompt → audit → plan → commands. (Not yet an LLM.)
- `src-tauri/src/` – `lib.rs` (commands, plugins, close safety-net), `files.rs`, `media.rs` (probe, thumbnails,
  filmstrip, proxies, waveforms), `export.rs` (encoder process, arg building, validation), `tools.rs` (sidecar lookup).

## Rules that bite
- Performance: never subscribe a big component to `currentTime` or the whole `useUi()` store. Use narrow selectors
  (`useShallow`) and small leaf components for anything that changes per frame (see `PlayheadLine`, `TimeReadout`).
- Never read GPU pixels (`extract`, `createImageBitmap(canvas)`) during playback.
- Video textures start as 0×0: size sprites from `MediaItem.width/height` and `texture.width` only when > 1
  (dividing by a 0 size gives NaN and the layer silently disappears).
- WebView2 (Windows) and WebKitGTK (Linux) decode different codecs. `canDecode()` + auto H.264 conversion
  (`playablePath`) handles HEVC/ProRes/10-bit. Test with real phone footage.
- Tauri permissions live in `src-tauri/capabilities/default.json`; a missing permission fails silently from JS.
- Closing: the UI handles close (unsaved prompt) then calls `exit_app`; two close requests within 8 s force-quit.
- FFmpeg sidecars: `src-tauri/binaries/ffmpeg-<target-triple>.exe` / `ffprobe-…` (gitignored). CI downloads the
  pinned GyanD 7.1.1 build; the local NSIS script (`src-tauri/windows/installer.nsi`) downloads it at install time.
- Logs: `%LOCALAPPDATA%\com.minifx.app\logs\minifx.log` (Windows), `~/.local/share/com.minifx.app/logs/` (Linux).
  F12 opens WebView devtools.
- Commit messages: imperative, explain why. Don't commit `dist/`, `target/`, binaries, test-results.
