# Building and releasing MiniFX

MiniFX is a Tauri 2 desktop app (Rust backend + React/TypeScript frontend).
The Windows installer (`.exe`, NSIS) and `.msi` are built **in the cloud by
GitHub Actions** — you don't need Visual Studio or Rust on your own PC.

## Release a new version (cloud build)

1. Put the project in a GitHub repository (first time only):
   ```bash
   git init
   git add .
   git commit -m "MiniFX 0.1.0"
   git branch -M main
   git remote add origin https://github.com/<you>/minifx.git
   git push -u origin main
   ```
2. Set the version in `package.json` (`"version": "0.1.0"`). Tauri reads it from there.
3. Tag and push:
   ```bash
   git tag v0.1.0
   git push --tags
   ```
4. Open **GitHub › Actions › build-windows**. The workflow:
   - runs the unit tests (Vitest), the Rust tests (including a real FFmpeg export) and the UI smoke test (Playwright);
   - downloads a pinned FFmpeg build (`FFMPEG_VERSION` in the workflow) and bundles `ffmpeg.exe` + `ffprobe.exe` as sidecars;
   - builds `MiniFX_<version>_x64-setup.exe` (NSIS, installs per-user, **no admin needed**) and an `.msi`;
   - creates a **draft GitHub Release** with both installers attached.
5. Open **Releases**, check the draft, click **Publish**. Users download `MiniFX_<version>_x64-setup.exe`.

You can also run the workflow by hand: **Actions › build-windows › Run workflow**. Manual runs
upload the installers as a workflow artifact (`MiniFX-windows-installers`) instead of a release.

## Optional: code signing

Without a certificate, Windows SmartScreen shows "Windows protected your PC" on first install
(click *More info › Run anyway*). That is normal for unsigned apps. To sign:

| Secret | Value |
| --- | --- |
| `WINDOWS_CERTIFICATE` | your `.pfx` file, base64 encoded (`certutil -encode cert.pfx cert.txt`, copy the middle part) |
| `WINDOWS_CERTIFICATE_PASSWORD` | the `.pfx` password |

The workflow imports the certificate and passes its thumbprint to Tauri automatically.

## Optional: auto-updates

1. Generate an updater key pair once on any machine with Node:
   ```bash
   npx tauri signer generate -w minifx.key
   ```
2. Add repository secrets:
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `minifx.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose (if any)
   - `TAURI_UPDATER_PUBKEY` — contents of `minifx.key.pub`
3. Tag a release as above. The workflow then also builds signed update bundles and attaches
   `latest.json` to the release. Installed apps find updates with **Help › Check for Updates…**
   (the endpoint is `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`).

## Develop locally (optional)

Requirements: Node 20+, Rust stable, and on Windows the WebView2 runtime (preinstalled on Windows 11)
plus "Desktop development with C++" from Visual Studio Build Tools.

```bash
npm install
# put ffmpeg/ffprobe for your platform into src-tauri/binaries/ with the target-triple suffix, e.g.
#   src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
#   src-tauri/binaries/ffprobe-x86_64-pc-windows-msvc.exe
npm run tauri dev       # desktop app with hot reload
npm run dev             # UI only, in a browser (export disabled)
npm test                # unit tests
npx playwright test     # UI smoke test (after npm run build)
cd src-tauri && cargo test   # Rust tests, incl. a real FFmpeg export
```

## Notes

- **FFmpeg licence**: the bundled build from gyan.dev is GPL. Check the FFmpeg licence terms before
  selling the app; for a closed-source commercial product use an LGPL build and avoid GPL-only encoders.
- **WebView2**: the installer downloads the WebView2 bootstrapper if a machine doesn't have it (Windows 10).
- **File association**: installing registers `.msproj`, so double-clicking a project opens MiniFX
  (a second double-click reuses the running window).
- **Logs**: *Help › Open Log Folder*. Each export writes `export-<job>.log` with the exact FFmpeg command.
