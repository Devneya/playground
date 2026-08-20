import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";

const mode = process.argv[2] ?? "mock";
if (!new Set(["mock", "real"]).has(mode)) throw new Error("Evidence mode must be mock or real.");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = resolve("release-evidence", commit, timestamp);
mkdirSync(evidenceDir, { recursive: true });
const startedAt = new Date().toISOString();
const metadataPath = join(evidenceDir, "test-metadata.json");
const metadata = {
  mode,
  commit,
  startedAt,
  baseUrl: process.env.PLAYGROUND_E2E_BASE_URL ?? null,
  model: process.env.E2E_TEST_MODEL ?? null,
  accountMode: mode === "real" ? "autonomous-disposable-mailbox-and-dodo-test-checkout" : "mock",
  browserMatrix: process.env.E2E_BROWSER_MATRIX === "true",
  node: process.version,
  npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
  evidenceDir,
};
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

let exitCode = 0;
try {
  execFileSync("npx", ["playwright", "test"], {
    stdio: "inherit",
    env: { ...process.env, E2E_MODE: mode, EVIDENCE_DIR: evidenceDir },
  });
} catch (error) {
  exitCode = typeof error?.status === "number" ? error.status : 1;
}

metadata.finishedAt = new Date().toISOString();
metadata.result = exitCode === 0 ? "passed" : "failed";
metadata.exitCode = exitCode;
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (path !== join(evidenceDir, "SHA256SUMS")) files.push(path);
  }
};
visit(evidenceDir);
const observations = files.filter((path) => path.includes("/observations/") && path.endsWith(".json")).map((path) => JSON.parse(readFileSync(path, "utf8")));
const evidenceSummaryPath = join(evidenceDir, "evidence-summary.json");
writeFileSync(evidenceSummaryPath, `${JSON.stringify({ mode, commit, result: metadata.result, testCount: observations.length, passedCount: observations.filter((item) => item.status === "passed").length, failedCount: observations.filter((item) => item.status !== "passed").length, screenshotCount: observations.filter((item) => item.screenshot).length, visualReview: "pending", observations }, null, 2)}\n`);
files.push(evidenceSummaryPath);
const manifest = files.sort().map((path) => `${createHash("sha256").update(readFileSync(path)).digest("hex")}  ${relative(evidenceDir, path)}`).join("\n");
writeFileSync(join(evidenceDir, "SHA256SUMS"), `${manifest}\n`);
console.log(`Local ${mode} evidence: ${evidenceDir}`);
if (exitCode !== 0) process.exitCode = exitCode;
