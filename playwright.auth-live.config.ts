import { defineConfig } from "@playwright/test";

// Failed-test DOM snapshots can include disposable credentials even with tracing off.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: "./tests/auth-live",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 600_000,
  forbidOnly: true,
  reporter: "list",
  outputDir: process.env.PLAYGROUND_AUTH_EVIDENCE_DIR
    ? `${process.env.PLAYGROUND_AUTH_EVIDENCE_DIR}/test-output`
    : "test-results/auth-live",
  use: { trace: "off", screenshot: "off", video: "off" },
});
