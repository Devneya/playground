import { existsSync, readFileSync } from "node:fs";

const coveragePath = process.argv[2] ?? "coverage/coverage-final.json";
if (!existsSync(coveragePath)) throw new Error(`Coverage data does not exist: ${coveragePath}`);

const files = JSON.parse(readFileSync(coveragePath, "utf8"));
const groups = {
  domain: { prefixes: ["src/domain/"], statements: 90, branches: 90 },
  api: { prefixes: ["src/api/"], statements: 90, branches: 90 },
  persistence: { prefixes: ["src/persistence/"], statements: 90, branches: 90 },
  "auth-workspace-execution": { prefixes: ["src/auth/", "src/features/workspace/", "src/features/execution/"], statements: 85, branches: 85 },
  whole: { prefixes: ["src/domain/", "src/api/", "src/persistence/", "src/auth/", "src/features/execution/", "src/features/workspace/"], statements: 80, branches: 80, functions: 80, lines: 80 },
};

const relative = (path) => path.replace(`${process.cwd()}/`, "");
const metric = (entries) => {
  let total = 0;
  let hit = 0;
  for (const value of entries) {
    total += 1;
    if (value > 0) hit += 1;
  }
  return { total, hit, percentage: total === 0 ? 100 : (hit / total) * 100 };
};
const lineMetric = (entries) => {
  const lines = new Map();
  for (const entry of entries) {
    const line = entry.map?.start?.line;
    if (line) lines.set(line, Math.max(lines.get(line) ?? 0, entry.hits));
  }
  return metric(lines.values());
};
const report = {};
let failed = false;
for (const [name, definition] of Object.entries(groups)) {
  const selected = Object.entries(files).filter(([path]) => definition.prefixes.some((prefix) => relative(path).startsWith(prefix)));
  if (selected.length === 0) throw new Error(`Coverage group has no files: ${name}`);
  const statements = metric(selected.flatMap(([, file]) => Object.values(file.s ?? {})));
  const branches = metric(selected.flatMap(([, file]) => Object.values(file.b ?? {}).flat()));
  const functions = metric(selected.flatMap(([, file]) => Object.values(file.f ?? {})));
  const lines = lineMetric(selected.flatMap(([, file]) => Object.entries(file.s ?? {}).map(([id, hits]) => ({ map: file.statementMap?.[id], hits }))));
  report[name] = { statements: statements.percentage, branches: branches.percentage, functions: functions.percentage, lines: lines.percentage };
  for (const metricName of ["statements", "branches", "functions", "lines"]) {
    const required = definition[metricName];
    if (required !== undefined && report[name][metricName] < required) {
      failed = true;
      console.error(`${name} ${metricName}: ${report[name][metricName].toFixed(2)}% < ${required}%`);
    }
  }
}
for (const [name, values] of Object.entries(report)) console.log(`${name}: ${Object.entries(values).map(([key, value]) => `${key}=${value.toFixed(2)}%`).join(" ")}`);
if (failed) process.exitCode = 1;
