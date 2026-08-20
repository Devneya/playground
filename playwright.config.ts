import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYGROUND_E2E_BASE_URL;
const mode = process.env.E2E_MODE ?? "real";
const mockMode = mode === "mock" || mode === "evidence";
const browserMatrix = process.env.E2E_BROWSER_MATRIX === "true";
const evidenceDir = process.env.EVIDENCE_DIR;
const buildCommand = mockMode ? "npm run build:mock" : "npm run build:prod";
const previewMode = mockMode ? "mock" : "production";
const realMode = !mockMode;
if (realMode && !externalBaseUrl) throw new Error("Real-server E2E requires PLAYGROUND_E2E_BASE_URL; mock-backed tests use E2E_MODE=mock.");

export default defineConfig({
  testDir: mockMode ? "./tests/browser-integration" : "./tests/e2e",
  fullyParallel: true,
  failOnFlakyTests: true,
  forbidOnly: Boolean(process.env.CI),
  retries: realMode ? 0 : (process.env.CI ? 2 : 0),
  reporter: process.env.CI ? "github" : [["list"], ["html", { outputFolder: evidenceDir ? `${evidenceDir}/playwright-report` : "playwright-report", open: "never" }]],
  outputDir: evidenceDir ? `${evidenceDir}/test-results` : "test-results",
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:3001",
    trace: realMode ? "off" : "retain-on-failure",
    screenshot: realMode ? "off" : "only-on-failure",
    video: realMode ? "off" : "retain-on-failure",
  },
  projects: browserMatrix ? [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ] : [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: externalBaseUrl ? undefined : {
    command: `${buildCommand} && npm run preview -- --mode ${previewMode} --host 127.0.0.1 --port 3001`,
    url: "http://127.0.0.1:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
