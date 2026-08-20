import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "dist";
if (!existsSync(root)) throw new Error(`Production artifact directory does not exist: ${root}`);

const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) visit(path);
    else files.push(path);
  }
};
visit(root);

const forbiddenFiles = files.filter((path) => path.endsWith("/mockServiceWorker.js") || path.endsWith(".map"));
const forbiddenMarkers = [
  "devneya-mock-scenario",
  "MockAuthProvider",
  "mock-public-anon-key",
  "validation-public-anon-key",
  "test-public-anon-key",
  "sk-bf-mock",
  "mock-jwt-",
  "user-a@example.test",
  "user-b@example.test",
  "VITE_USE_MOCKS",
];
const textFiles = files.filter((path) => /\.(?:html|js|css|json|txt)$/.test(path));
const findings = [];
for (const path of textFiles) {
  const content = readFileSync(path, "utf8");
  for (const marker of forbiddenMarkers) if (content.includes(marker)) findings.push(`${path}: contains ${marker}`);
}

if (forbiddenFiles.length > 0 || findings.length > 0) {
  for (const finding of [...forbiddenFiles.map((path) => `${path}: forbidden production artifact`), ...findings]) console.error(finding);
  process.exitCode = 1;
} else {
  console.log(`Production artifact verified: ${files.length} files, no mock runtime or synthetic credentials.`);
}
