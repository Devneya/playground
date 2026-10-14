import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  PRODUCTION_URL, MODEL, MODELS_URL, COMPLETIONS_URL, LiveTestFailure,
  assertLocalEnvironment, resolveLocalPlatformKey, safeFailure,
  inspectRequest, containsSecret, createReleaseAllowance, requireSuccessfulStatus, installRedirectGuard,
  parseLiveArguments, checkProductionCors, assertCorsResult, prepareLiveRun,
} from "../src/api/openai-live.node.mjs";

const INVALID_KEY = "invalid-openai-key-for-release-test";
const FIRST_PROMPT = "Reply with exactly OPENAI_SETUP_OK.";
const FOLLOWUP_PROMPT = "What exact marker did you return in your previous answer? Reply with that marker only.";
const SETUP_TIMEOUT = 30_000;
const COMPLETION_TIMEOUT = 130_000;

async function verifyRelease(sha) {
  try {
    const http = await fetch("http://playground.devneya.com/", { redirect: "manual", signal: AbortSignal.timeout(SETUP_TIMEOUT) });
    const location = new URL(http.headers.get("location") ?? "", "http://playground.devneya.com/");
    if (![301, 302, 307, 308].includes(http.status) || location.origin !== PRODUCTION_URL) throw new LiveTestFailure("https_required");
    const response = await fetch(`${PRODUCTION_URL}/release.json?release_check=${Date.now()}`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(SETUP_TIMEOUT) });
    if (!response.ok) throw new LiveTestFailure("release_unavailable");
    const metadata = await response.json();
    if (Object.keys(metadata).length !== 1 || metadata.commit !== sha) throw new LiveTestFailure("release_mismatch");
  } catch (error) {
    if (error instanceof LiveTestFailure) throw error;
    throw new LiveTestFailure("release_unavailable");
  }
}

async function openAllowance() {
  // One initial and one corrective run across SHAs, not a fresh allowance per
  // deployed commit. Keep this ignored ledger when correcting and republishing.
  const root = resolve("release-evidence");
  await mkdir(root, { recursive: true });
  const lockPath = join(root, ".openai-provider-setup.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); } catch { throw new LiveTestFailure("budget_state"); }
  const ledgerPath = join(root, "openai-provider-setup-budget.json");
  try {
    let state;
    try { state = JSON.parse(await readFile(ledgerPath, "utf8")); }
    catch (error) { if (error?.code !== "ENOENT") throw new LiveTestFailure("budget_state"); }
    const allowance = createReleaseAllowance(state, (value) => {
      writeFileSync(`${ledgerPath}.tmp`, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      renameSync(`${ledgerPath}.tmp`, ledgerPath);
    });
    return { allowance, close: async () => { await lock.close(); await unlink(lockPath); } };
  } catch {
    await lock.close(); await unlink(lockPath);
    throw new LiveTestFailure("budget_state");
  }
}

async function main() {
  assertLocalEnvironment(process.env);
  const mode = parseLiveArguments(process.argv.slice(2));
  if (mode === "cors") {
    const directory = resolve("release-evidence", "openai-cors", new Date().toISOString().replace(/[:.]/g, "-"));
    const cors = await recordCors(directory);
    assertCorsResult(cors);
    console.log("Genuine browser CORS passed: observed upstream OPTIONS and readable synthetic 401 responses for models and chat/completions; context and browser closed. No Platform credential was read or paid request sent.");
    return;
  }
  if (mode === "preflight") {
    await resolveLocalPlatformKey();
    console.log("Local OpenAI Platform key is available; no browser or API request was made.");
    return;
  }
  const startedAt = new Date().toISOString();
  const evidenceFor = (sha) => resolve("release-evidence", sha, startedAt.replace(/[:.]/g, "-"), "openai-live");
  const { credential: { key }, sha, cors, budget } = await prepareLiveRun({
    env: process.env, selectCredential: resolveLocalPlatformKey, verifyRelease,
    checkCors: (sha) => recordCors(evidenceFor(sha)), openAllowance,
  });
  const { allowance } = budget;
  const evidenceDir = evidenceFor(sha);
  let browser, context, page;
  let catalogKey = null, expectedMessages = null, failure = null, rejectStop, cleaning = false;
  let completionSuccesses = 0, catalogRequests = 0;
  const responseWork = new Set();
  const completions = new Map();
  const catalogs = new Map();
  const scenarios = [];
  const requests = [];
  const diagnostics = { corsObserved: false, requestFailed: false, httpResponseAvailable: false, applicationError: false };
  const cleanup = { disconnected: false, storageCleared: false, browserClosed: false };
  const stop = new Promise((_, reject) => { rejectStop = reject; });
  stop.catch(() => {});
  const fail = (error) => {
    if (!failure) { failure = error instanceof LiveTestFailure ? error : new LiveTestFailure("application"); rejectStop(failure); }
  };
  const guarded = (operation) => Promise.race([operation, stop]);
  const scenario = async (name, operation) => {
    const start = Date.now();
    const result = { name, status: "running", durationMs: 0 };
    scenarios.push(result);
    console.log(`OpenAI release scenario: ${name}`);
    try { await guarded(operation()); result.status = "passed"; }
    catch (error) { result.status = "failed"; throw error; }
    finally { result.durationMs = Date.now() - start; }
  };
  let summaryFailure;
  try {
    allowance.begin();
    // Import only after refusing debug/CI and resolving credentials. Direct
    // Playwright use has no test reporter, trace, video, or failure screenshot.
    const { chromium } = await import("playwright");
    const { expect } = await import("@playwright/test");
    const browserEnv = { ...process.env };
    delete browserEnv.OPENAI_API_KEY;
    browser = await chromium.launch({ channel: "chromium", headless: true, env: browserEnv });
    context = await browser.newContext({ serviceWorkers: "block", ignoreHTTPSErrors: false, acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
    context.setDefaultTimeout(SETUP_TIMEOUT);
    context.setDefaultNavigationTimeout(SETUP_TIMEOUT);
    page = await context.newPage();
    await installRedirectGuard(context, page, (error) => { if (!cleaning) fail(error); });
    await context.routeWebSocket("**/*", async (socket) => {
      fail(new LiveTestFailure("security"));
      await socket.close({ code: 1008, reason: "Release verification permits static HTTPS and OpenAI HTTP requests only." }).catch(() => {});
    });
    page.on("console", (message) => { if (/CORS|Access-Control|cross-origin.*blocked/i.test(message.text())) diagnostics.corsObserved = true; });
    page.on("pageerror", () => { diagnostics.applicationError = true; fail(new LiveTestFailure("application")); });
    page.on("requestfailed", (request) => {
      if ([MODELS_URL, COMPLETIONS_URL].includes(request.url())) {
        diagnostics.requestFailed = true;
        const item = completions.get(request);
        if (item) { item.requestFailed = true; item.durationMs = Date.now() - item.started; }
        fail(new LiveTestFailure(diagnostics.corsObserved ? "cors" : "network"));
      }
    });
    // Inspect every outgoing browser request; never replace network responses.
    await context.route("**/*", async (route) => {
      try {
        const request = route.request();
        const inspected = inspectRequest({ url: request.url(), method: request.method(), headers: await request.allHeaders(), body: request.postData() ?? "", key, catalogKey, expectedMessages, resourceType: request.resourceType() });
        if ((failure || cleaning) && !(cleaning && inspected.kind === "static")) { await route.abort(); return; }
        if (inspected.kind === "completion") {
          const index = allowance.forward();
          const item = { endpoint: "chat/completions", index, status: null, durationMs: null, started: Date.now(), addedMaxCompletionTokens: 4096 };
          requests.push(item); completions.set(request, item);
          // Disarm until the next deliberate UI gesture; double sends fail.
          expectedMessages = null;
          await route.continue({ postData: inspected.postData });
        } else {
          if (inspected.kind === "catalog") {
            catalogRequests += 1;
            const item = { endpoint: "models", status: null, durationMs: null, started: Date.now(), invalidKeyCheck: catalogKey === INVALID_KEY };
            catalogs.set(request, item); requests.push(item);
          }
          await route.continue();
        }
      } catch (error) { fail(error); await route.abort().catch(() => {}); }
    });
    page.on("response", (response) => {
      const task = (async () => {
        const url = response.url();
        if (url === COMPLETIONS_URL && response.request().method() === "POST") {
          diagnostics.httpResponseAvailable = true;
          const item = completions.get(response.request());
          if (!item) throw new LiveTestFailure("invalid_request");
          item.status = response.status();
          const body = await response.json().catch(() => null);
          requireSuccessfulStatus(response.status(), body?.error?.code);
          const text = body?.choices?.[0]?.message?.content;
          if (typeof text !== "string" || !text.trim() || !text.includes("OPENAI_SETUP_OK") || containsSecret(text, key)) throw new LiveTestFailure("invalid_response");
          item.usage = allowance.recordUsage(body.usage);
          item.durationMs = Date.now() - item.started;
          // Keep returned text only in memory for conversation/path assertions.
          item.text = text;
          completionSuccesses += 1;
        } else if (url === MODELS_URL && response.request().method() === "GET") {
          const invalid = response.request().headers().authorization === `Bearer ${INVALID_KEY}`;
          const item = catalogs.get(response.request());
          if (item) { item.status = response.status(); item.durationMs = Date.now() - item.started; }
          if (invalid) {
            if (response.status() !== 401) throw new LiveTestFailure("http_error");
          } else {
            diagnostics.httpResponseAvailable = true;
            const body = await response.json().catch(() => null);
            requireSuccessfulStatus(response.status(), body?.error?.code);
            if (!body?.data?.some((model) => model.id === MODEL)) throw new LiveTestFailure("model_unavailable");
          }
        } else if (new URL(url).origin === PRODUCTION_URL && /\.js(?:\?|$)/.test(url)) {
          const artifact = await response.text();
          if (containsSecret(artifact, key) || /mockServiceWorker|devneya-mock-scenario|sk-bf-mock|mock-jwt-|MockAuthProvider/.test(artifact)) throw new LiveTestFailure("security");
        }
      })();
      responseWork.add(task);
      task.catch(fail).finally(() => responseWork.delete(task));
    });
    const canvas = () => page.locator(".canvas-shell");
    const results = () => page.locator(".generated-node .generated-content");
    const selectModel = async (title) => {
      await page.getByRole("button", { name: `${title} model picker`, exact: true }).click();
      await page.getByLabel(`${title} model search`, { exact: true }).fill(MODEL);
      const model = page.getByRole("radio", { name: `${title} model ${MODEL}`, exact: true });
      await expect(model).toBeVisible({ timeout: SETUP_TIMEOUT });
      if (!(await model.isChecked())) await model.check();
      await page.keyboard.press("Escape");
    };
    const connect = async (candidate) => {
      if (!(await page.getByRole("combobox", { name: "Provider", exact: true }).isVisible())) {
        await page.getByRole("button", { name: "Use an API key", exact: true }).click();
      }
      await page.getByRole("combobox", { name: "Provider", exact: true }).selectOption("openai");
      await page.getByLabel("OpenAI API key", { exact: true }).fill(candidate);
      catalogKey = candidate;
      await page.getByRole("button", { name: "Connect to OpenAI", exact: true }).click();
    };
    const openConnection = async () => {
      if (!(await page.getByRole("button", { name: "Disconnect", exact: true }).isVisible())) await page.getByRole("button", { name: "Connection", exact: true }).click();
    };
    const workspace = async () => page.evaluate(() => new Promise((resolve, reject) => {
      const opening = indexedDB.open("devneya-playground");
      opening.onerror = () => reject(new Error("storage"));
      opening.onsuccess = () => {
        const db = opening.result;
        const request = db.transaction("workspaces", "readonly").objectStore("workspaces").get("browser-workspace");
        request.onsuccess = () => { db.close(); resolve(request.result?.document ?? null); };
        request.onerror = () => { db.close(); reject(new Error("storage")); };
      };
    }));
    const assertWorkspace = (document) => {
      if (!document?.flows?.length || containsSecret(JSON.stringify(document), key)) throw new LiveTestFailure("security");
      const flow = document.flows.find((flow) => flow.id === document.activeFlowId);
      const executions = flow?.batches.flatMap((batch) => batch.executions) ?? [];
      if (executions.length !== 2 || executions.some((execution) => execution.status !== "success" || execution.provider !== "openai" || execution.modelId !== MODEL
        || ![execution.usage?.promptTokens, execution.usage?.completionTokens, execution.usage?.totalTokens].every(Number.isFinite))) throw new LiveTestFailure("application");
      const generated = flow.nodes.filter((node) => node.data.origin === "generated");
      if (generated.length !== 2 || generated.some((node, index) => node.data.text !== requests.filter((item) => item.endpoint === "chat/completions")[index]?.text)) throw new LiveTestFailure("application");
      for (const [index, instruction] of [FIRST_PROMPT, FOLLOWUP_PROMPT].entries()) {
        const prompt = flow.nodes.find((node) => node.data.kind === "generation" && node.data.instruction === instruction);
        if (!prompt || prompt.data.modelIds.length !== 1 || prompt.data.modelIds[0] !== MODEL || flow.batches[index]?.instruction !== instruction) throw new LiveTestFailure("application");
      }
      return true;
    };
    await scenario("fresh production load", async () => {
      await page.goto(`${PRODUCTION_URL}/`, { waitUntil: "networkidle" });
      await expect(page.getByRole("button", { name: "Use an API key", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue with Devneya", exact: true })).toBeVisible();
      if (catalogRequests || allowance.runForwarded) throw new LiveTestFailure("application");
    });
    await scenario("invalid key rejection", async () => {
      await connect(INVALID_KEY);
      await expect(page.getByRole("alert")).toHaveText("OpenAI rejected the API key.", { timeout: SETUP_TIMEOUT });
      if (allowance.runForwarded || requests.findLast((item) => item.endpoint === "models")?.status !== 401) throw new LiveTestFailure("application");
    });
    await scenario("valid connection", async () => {
      await page.getByLabel("OpenAI API key", { exact: true }).fill(key);
      catalogKey = key;
      await page.getByRole("button", { name: "Connect to OpenAI", exact: true }).click();
      await expect(canvas()).toBeVisible({ timeout: SETUP_TIMEOUT });
      await expect(page.getByLabel("Catalog ready", { exact: true })).toBeVisible({ timeout: SETUP_TIMEOUT });
      await expect(page.getByLabel("OpenAI API key", { exact: true })).toHaveCount(0);
    });
    await scenario("live catalog and model selection", () => selectModel("Prompt 1"));
    await scenario("provider separation", async () => {
      await openConnection();
      await expect(page.getByRole("link", { name: "Profile", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "Connection settings" })).toContainText("OpenAI");
      await page.getByRole("button", { name: "Connection", exact: true }).click();
      const supabaseLoaded = await page.evaluate(() => performance.getEntriesByType("resource").some((entry) => /auth-vendor|\/AuthProvider-/.test(entry.name)));
      if (supabaseLoaded) throw new LiveTestFailure("application");
    });
    await scenario("first inference", async () => {
      expectedMessages = [{ role: "user", content: FIRST_PROMPT }];
      await page.getByLabel("Prompt 1 instruction", { exact: true }).fill(FIRST_PROMPT);
      await page.getByLabel("Prompt 1 instruction", { exact: true }).press("Enter");
      await expect(results().nth(0)).toContainText("OPENAI_SETUP_OK", { timeout: COMPLETION_TIMEOUT });
      await expect.poll(() => completionSuccesses, { timeout: COMPLETION_TIMEOUT }).toBe(1);
      await expect(page.getByLabel("Prompt 2 instruction", { exact: true })).toBeVisible({ timeout: SETUP_TIMEOUT });
    });
    await scenario("follow-up inference", async () => {
      await selectModel("Prompt 2");
      const previous = requests.find((item) => item.endpoint === "chat/completions").text;
      expectedMessages = [{ role: "user", content: FIRST_PROMPT }, { role: "assistant", content: previous }, { role: "user", content: FOLLOWUP_PROMPT }];
      await page.getByLabel("Prompt 2 instruction", { exact: true }).fill(FOLLOWUP_PROMPT);
      await page.getByLabel("Prompt 2 instruction", { exact: true }).press("Enter");
      await expect(results().nth(1)).toContainText("OPENAI_SETUP_OK", { timeout: COMPLETION_TIMEOUT });
      await expect.poll(() => completionSuccesses, { timeout: COMPLETION_TIMEOUT }).toBe(2);
    });
    await scenario("persistence", async () => {
      await expect.poll(async () => { try { return assertWorkspace(await workspace()); } catch { return false; } }, { timeout: SETUP_TIMEOUT }).toBe(true);
      await page.reload({ waitUntil: "networkidle" });
      await expect(canvas()).toBeVisible({ timeout: SETUP_TIMEOUT });
      await expect(results()).toHaveCount(2);
      for (let index = 0; index < 2; index += 1) await expect(results().nth(index)).toContainText("OPENAI_SETUP_OK");
      await expect(page.getByLabel("Prompt 1 instruction", { exact: true })).toHaveValue(FIRST_PROMPT);
      await expect(page.getByLabel("Prompt 2 instruction", { exact: true })).toHaveValue(FOLLOWUP_PROMPT);
      for (const title of ["Prompt 1", "Prompt 2"]) await expect(page.getByRole("button", { name: `${title} model picker`, exact: true })).toContainText(MODEL);
      assertWorkspace(await workspace());
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("devneya-playground-connection") ?? "null"));
      if (saved?.provider !== "openai" || saved.apiKey !== key || allowance.runForwarded !== 2) throw new LiveTestFailure("application");
    });
    await scenario("credential-free export", async () => {
      await page.getByRole("button", { name: "Export options", exact: true }).click();
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export workspace", exact: true }).click();
      const download = await downloadPromise;
      const path = await download.path();
      const raw = await readFile(path, "utf8");
      if (containsSecret(raw, key) || /"(?:apiKey|access_token|refresh_token|authorization|credentials|connection)"\s*:/i.test(raw)) throw new LiveTestFailure("security");
      const exported = JSON.parse(raw);
      if (exported.format !== "devneya-flow-v3") throw new LiveTestFailure("application");
      assertWorkspace(exported.workspace);
      await download.delete(); // Do not retain the raw workspace in evidence.
    });
    await scenario("failed replacement preserves connection", async () => {
      await openConnection();
      await page.getByRole("button", { name: "Change connection", exact: true }).click();
      await connect(INVALID_KEY);
      await expect(page.getByRole("alert")).toHaveText("OpenAI rejected the API key.", { timeout: SETUP_TIMEOUT });
      const retained = await page.evaluate(() => JSON.parse(localStorage.getItem("devneya-playground-connection") ?? "null"));
      if (retained?.provider !== "openai" || retained.apiKey !== key) throw new LiveTestFailure("security");
      catalogKey = key;
      await page.getByRole("button", { name: "Back to OpenAI", exact: true }).click();
      await expect(canvas()).toBeVisible();
      assertWorkspace(await workspace());
    });
    await scenario("disconnect and reconnect", async () => {
      await openConnection();
      await page.getByRole("button", { name: "Disconnect", exact: true }).click();
      await expect(page.getByRole("button", { name: "Use an API key", exact: true })).toBeVisible();
      const removed = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem("devneya-playground-connection") ?? "null");
        return !saved || (saved.provider === null && !saved.apiKey);
      });
      if (!removed) throw new LiveTestFailure("security");
      assertWorkspace(await workspace());
      await connect(key);
      await expect(canvas()).toBeVisible({ timeout: SETUP_TIMEOUT });
      await expect(page.getByLabel("Catalog ready", { exact: true })).toBeVisible({ timeout: SETUP_TIMEOUT });
      await expect(results()).toHaveCount(2);
      assertWorkspace(await workspace());
      if (allowance.runForwarded !== 2) throw new LiveTestFailure("request_limit");
    });
    await guarded(Promise.all([...responseWork]));
    if (completionSuccesses !== 2 || allowance.runForwarded !== 2 || diagnostics.applicationError) throw new LiveTestFailure("application");
  } catch (error) {
    const chosen = failure ?? error;
    summaryFailure = safeFailure(chosen);
    if (summaryFailure.category === "network" && diagnostics.corsObserved) summaryFailure = safeFailure(new LiveTestFailure("cors"));
  } finally {
    cleaning = true;
    // Only this fresh, nonpersistent context is touched. Unmount first, so
    // workspace debounce/pagehide writes cannot repopulate the cleared store.
    if (page) {
      try {
        const disconnect = page.getByRole("button", { name: "Disconnect", exact: true });
        if (!(await disconnect.isVisible()) && await page.getByRole("button", { name: "Connection", exact: true }).isVisible()) await page.getByRole("button", { name: "Connection", exact: true }).click({ timeout: 5000 });
        if (await disconnect.isVisible()) { await disconnect.click({ timeout: 5000 }); cleanup.disconnected = true; }
      } catch { /* Storage deletion and context destruction remain mandatory. */ }
      try {
        await page.goto(`${PRODUCTION_URL}/robots.txt`, { waitUntil: "domcontentloaded", timeout: SETUP_TIMEOUT });
        await page.evaluate(async () => {
          localStorage.clear(); sessionStorage.clear();
          await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase("devneya-playground");
            request.onsuccess = resolve; request.onerror = reject; request.onblocked = reject;
          });
          for (const name of await caches.keys()) await caches.delete(name);
        });
        await context.clearCookies();
        cleanup.storageCleared = true;
      } catch { /* Report the fixed cleanup category, never the exception. */ }
    }
    try { if (context) await context.close(); if (browser) { await browser.close(); cleanup.browserClosed = true; } } catch { /* Summarized below. */ }
    summaryFailure ??= failure ? safeFailure(failure) : undefined;
    if (diagnostics.corsObserved && ["network", "application"].includes(summaryFailure?.category)) summaryFailure = safeFailure(new LiveTestFailure("cors"));
    if (browser && (!cleanup.storageCleared || !cleanup.browserClosed)) summaryFailure ??= safeFailure(new LiveTestFailure("cleanup"));
    await budget.close();
    const summary = {
      productionUrl: PRODUCTION_URL, commit: sha, model: MODEL, startedAt, finishedAt: new Date().toISOString(), cors,
      result: summaryFailure ? "failed" : "passed", failure: summaryFailure ?? null, scenarios,
      forwardedCompletionRequests: allowance.runForwarded, successfulCompletionResponses: completionSuccesses, catalogRequests,
      releaseAllowance: { ...allowance.state, maxForwarded: 4, maxRuns: 2, maxEstimatedUsd: 0.10 },
      requests: requests.map(({ text: _text, started: _started, ...sanitized }) => sanitized),
      safetyLimitAdded: { max_completion_tokens: 4096 }, maxSerializedMessagesBytes: 4096, retries: 0,
      diagnostics, cleanup,
    };
    // Summary is made solely from fixed strings, numbers, booleans, and SHA.
    const serialized = `${JSON.stringify(summary, null, 2)}\n`;
    if (containsSecret(serialized, key)) summaryFailure = safeFailure(new LiveTestFailure("security"));
    else {
      await mkdir(evidenceDir, { recursive: true });
      const temporaryPath = join(evidenceDir, "summary.json.tmp");
      await writeFile(temporaryPath, serialized, { mode: 0o600 });
      await rename(temporaryPath, join(evidenceDir, "summary.json"));
      console.log(`Sanitized local evidence: ${evidenceDir}`);
    }
  }
  if (summaryFailure) throw new LiveTestFailure(summaryFailure.category);
  console.log(`OpenAI verification passed: ${PRODUCTION_URL}, ${sha}, two successful ${MODEL} completions; isolated context cleared and closed.`);
}

async function recordCors(directory) {
  const cors = await checkProductionCors();
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "cors.json"), `${JSON.stringify(cors, null, 2)}\n`, { mode: 0o600 });
  console.log(`Sanitized CORS evidence: ${directory}`);
  return cors;
}

try { await main(); }
catch (error) { console.error(safeFailure(error).message); process.exitCode = 1; }
