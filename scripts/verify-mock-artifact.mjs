import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "dist";
if (!existsSync(root)) throw new Error(`Mock artifact directory does not exist: ${root}`);
const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) visit(path);
    else files.push(path);
  }
};
visit(root);
if (!files.some((path) => path.endsWith("/mockServiceWorker.js"))) throw new Error("Mock artifact is missing mockServiceWorker.js.");
const textFiles = files.filter((path) => /\.(?:html|js|css|json|txt)$/.test(path));
const forbidden = [/sk-bf-(?!mock-key-for-tests-only)[A-Za-z0-9_-]{12,}/g, /192\.168\.10\.14/g];
const findings = [];
for (const path of textFiles) {
  const content = readFileSync(path, "utf8");
  for (const pattern of forbidden) { pattern.lastIndex = 0; if (pattern.test(content)) findings.push(`${path}: matches ${pattern}`); }
}
if (findings.length) { for (const finding of findings) console.error(finding); process.exitCode = 1; }
else console.log(`Mock artifact verified: ${files.length} files, synthetic test runtime only.`);
