import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/codex-local",
  timeout: 660_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "release-evidence/codex-local",
  use: { ...devices["Desktop Chrome"], channel: "chromium", baseURL: "http://127.0.0.1:3002", screenshot: "only-on-failure", trace: "off", viewport: { width: 1440, height: 1000 } },
});
