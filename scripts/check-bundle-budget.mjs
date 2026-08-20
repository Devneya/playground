import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { join } from "node:path";

const root = process.argv[2] ?? "dist";
if (!existsSync(root)) throw new Error(`Bundle directory does not exist: ${root}`);
const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) visit(path);
    else files.push(path);
  }
};
visit(root);
const js = files.filter((path) => path.endsWith(".js"));
const css = files.filter((path) => path.endsWith(".css"));
const bytes = (path) => readFileSync(path);
const total = (paths) => paths.reduce((sum, path) => sum + bytes(path).byteLength, 0);
const compressed = (paths, fn) => paths.reduce((sum, path) => sum + fn(bytes(path)).byteLength, 0);
const largest = (paths) => paths.reduce((current, path) => {
  const size = bytes(path).byteLength;
  return !current || size > current.size ? { path, size } : current;
}, null);
const jsRaw = total(js);
const jsGzip = compressed(js, gzipSync);
const jsBrotli = compressed(js, brotliCompressSync);
const cssRaw = total(css);
const largestJs = largest(js);
const mockArtifact = files.some((path) => path.endsWith("/mockServiceWorker.js"));
// The mock build intentionally carries MSW's browser runtime; production keeps the tighter budget.
const budgets = { totalJsRaw: 1_200_000, totalJsGzip: mockArtifact ? 400_000 : 350_000, largestJsRaw: 600_000, totalCssRaw: 180_000 };
console.log(JSON.stringify({ mode: mockArtifact ? "mock" : "production", budgets, files: js.length, totalJsRaw: jsRaw, totalJsGzip: jsGzip, totalJsBrotli: jsBrotli, largestJs, totalCssRaw: cssRaw }, null, 2));
const failures = [];
if (jsRaw > budgets.totalJsRaw) failures.push(`total JavaScript is ${jsRaw} bytes, over ${budgets.totalJsRaw}`);
if (jsGzip > budgets.totalJsGzip) failures.push(`gzipped JavaScript is ${jsGzip} bytes, over ${budgets.totalJsGzip}`);
if (largestJs?.size > budgets.largestJsRaw) failures.push(`largest JavaScript chunk is ${largestJs.size} bytes, over ${budgets.largestJsRaw}: ${largestJs.path}`);
if (cssRaw > budgets.totalCssRaw) failures.push(`CSS is ${cssRaw} bytes, over ${budgets.totalCssRaw}`);
if (failures.length) { for (const failure of failures) console.error(failure); process.exitCode = 1; }
