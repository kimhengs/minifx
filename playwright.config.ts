import { defineConfig } from "@playwright/test";

// Smoke test of the UI in browser mode (vite preview). The desktop-only parts
// (FFmpeg export, file dialogs) are covered by the Rust integration tests.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] } : { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
