import { expect, test, type Page, type Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

type ProviderCase = {
  id: "openai" | "anthropic" | "google" | "openrouter" | "groq" | "mistral" | "deepseek" | "custom";
  label: string;
  key: string;
  model: string;
  catalogPaths: string[];
  completionPath: string;
  authHeader: string;
  authValue: string;
  extraHeaders?: Record<string, string>;
  baseURL?: string;
};

const customBaseURL = "https://custom-provider.example/api/v1";
const providers: ProviderCase[] = [
  { id: "openai", label: "OpenAI", key: "synthetic-openai-browser-key", model: "gpt-mock-chat", catalogPaths: ["/v1/models"], completionPath: "/v1/chat/completions", authHeader: "authorization", authValue: "Bearer synthetic-openai-browser-key" },
  { id: "anthropic", label: "Anthropic", key: "synthetic-anthropic-browser-key", model: "claude-mock-chat", catalogPaths: ["/v1/models?limit=100"], completionPath: "/v1/messages", authHeader: "x-api-key", authValue: "synthetic-anthropic-browser-key", extraHeaders: { "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } },
  { id: "google", label: "Google Gemini", key: "synthetic-google-browser-key", model: "gemini-mock-chat", catalogPaths: ["/v1beta/models?pageSize=1000"], completionPath: "/v1beta/models/gemini-mock-chat:generateContent", authHeader: "x-goog-api-key", authValue: "synthetic-google-browser-key" },
  { id: "openrouter", label: "OpenRouter", key: "synthetic-openrouter-browser-key", model: "openrouter/mock-chat", catalogPaths: ["/api/v1/key", "/api/v1/models"], completionPath: "/api/v1/chat/completions", authHeader: "authorization", authValue: "Bearer synthetic-openrouter-browser-key" },
  { id: "groq", label: "Groq", key: "synthetic-groq-browser-key", model: "groq-mock-chat", catalogPaths: ["/openai/v1/models"], completionPath: "/openai/v1/chat/completions", authHeader: "authorization", authValue: "Bearer synthetic-groq-browser-key" },
  { id: "mistral", label: "Mistral", key: "synthetic-mistral-browser-key", model: "mistral-mock-chat", catalogPaths: ["/v1/models"], completionPath: "/v1/chat/completions", authHeader: "authorization", authValue: "Bearer synthetic-mistral-browser-key" },
  { id: "deepseek", label: "DeepSeek", key: "synthetic-deepseek-browser-key", model: "deepseek-mock-chat", catalogPaths: ["/models"], completionPath: "/chat/completions", authHeader: "authorization", authValue: "Bearer synthetic-deepseek-browser-key" },
  { id: "custom", label: "Custom OpenAI-compatible", key: "synthetic-custom-browser-key", model: "custom-mock-chat", catalogPaths: ["/api/v1/models"], completionPath: "/api/v1/chat/completions", authHeader: "authorization", authValue: "Bearer synthetic-custom-browser-key", baseURL: customBaseURL },
];

const browserErrors = new WeakMap<Page, string[]>();
const networkFailures = new WeakMap<Page, string[]>();
const waitForMockWorker = async (page: Page) => page.evaluate(async () => {
  if (!navigator.serviceWorker) return;
  await Promise.race([navigator.serviceWorker.ready, new Promise<void>((resolve) => window.setTimeout(resolve, 2_000))]);
});

const prepare = async (page: Page, scenario = "default") => {
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  await page.goto("/robots.txt");
  await page.evaluate(async (scenarioName) => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem("devneya-mock-scenario", scenarioName);
    localStorage.setItem("devneya-playground-connection", JSON.stringify({ provider: null }));
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("devneya-playground");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }, scenario);
  await page.goto("/");
  await waitForMockWorker(page);
  await expect(page.getByRole("heading", { name: "Choose your connection." })).toBeVisible({ timeout: 15_000 });
};

const selectedProvider = async (page: Page, provider: ProviderCase) => {
  await page.getByRole("button", { name: "Use an API key", exact: true }).click();
  const select = page.getByLabel("Provider");
  await expect(select).toHaveValue("openai");
  if (provider.id !== "openai") await select.selectOption(provider.id);
  if (provider.baseURL) await page.getByLabel("API base URL").fill(provider.baseURL);
  const keyLabel = provider.id === "custom" ? "API key" : `${provider.label} API key`;
  await page.getByLabel(keyLabel).fill(provider.key);
};

const connect = async (page: Page, provider: ProviderCase) => {
  await selectedProvider(page, provider);
  const buttonName = provider.id === "custom" ? "Connect to custom endpoint" : `Connect to ${provider.label}`;
  await page.getByRole("button", { name: buttonName }).click();
  await expect(page.locator(".canvas-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
};

const changeConnection = async (page: Page) => {
  await page.getByRole("button", { name: "Connection" }).click();
  await page.getByRole("button", { name: "Change connection" }).click();
  await expect(page.getByRole("heading", { name: "Choose your connection." })).toBeVisible();
};

const storedConnection = async (page: Page) => page.evaluate(() => {
  const raw = localStorage.getItem("devneya-playground-connection");
  return raw ? JSON.parse(raw) as Record<string, unknown> : null;
});

const storedWorkspace = async (page: Page) => page.evaluate(() => new Promise<string>((resolve) => {
  const request = indexedDB.open("devneya-playground");
  request.onerror = () => resolve("");
  request.onsuccess = () => {
    const db = request.result;
    const get = db.transaction("workspaces", "readonly").objectStore("workspaces").getAll();
    get.onsuccess = () => { resolve(JSON.stringify(get.result)); db.close(); };
    get.onerror = () => { resolve(""); db.close(); };
  };
}));

type PersistedRecord = {
  document: {
    flows: Array<{
      batches: Array<{
        executions: Array<{ usage?: Record<string, unknown> }>;
      }>;
    }>;
  };
};

const waitForStoredText = async (page: Page, text: string) => {
  await expect.poll(async () => (await storedWorkspace(page)).includes(text), { timeout: 15_000 }).toBe(true);
};

const generation = (page: Page) => page.locator(".generation-node");
const selectModel = async (page: Page, model: string, prompt = "Prompt 1") => {
  await generation(page).getByRole("button", { name: `${prompt} model picker` }).click();
  const picker = page.getByRole("dialog", { name: `${prompt} models` });
  await picker.getByLabel(`${prompt} model search`).fill(model);
  const radio = page.getByRole("radio", { name: `${prompt} model ${model}` });
  await expect(radio).toBeVisible();
  await radio.check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "fit view" }).click();
};

const originFor = (provider: ProviderCase) => {
  if (provider.id === "openai") return "https://api.openai.com";
  if (provider.id === "anthropic") return "https://api.anthropic.com";
  if (provider.id === "google") return "https://generativelanguage.googleapis.com";
  if (provider.id === "openrouter") return "https://openrouter.ai";
  if (provider.id === "groq") return "https://api.groq.com";
  if (provider.id === "mistral") return "https://api.mistral.ai";
  if (provider.id === "deepseek") return "https://api.deepseek.com";
  return "https://custom-provider.example";
};

const matchingRequests = (requests: Request[], provider: ProviderCase, path: string, method = "GET") => requests.filter((request) => {
  const url = new URL(request.url());
  return url.origin === originFor(provider) && url.pathname + url.search === path && request.method() === method;
});

const storedShape = (provider: ProviderCase) => provider.id === "custom"
  ? { provider: provider.id, apiKey: provider.key, baseURL: provider.baseURL }
  : { provider: provider.id, apiKey: provider.key };

const assertNoSeriousA11yViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
};

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  const failures: string[] = [];
  browserErrors.set(page, errors);
  networkFailures.set(page, failures);
  page.on("pageerror", (error) => {
    if (/^ResizeObserver loop completed with undelivered notifications\.?$/.test(error.message)) return;
    errors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/^Failed to load resource: the server responded with a status of (401|402|403|502|503)/.test(message.text())) return;
    errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => failures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "request failed"}`));
});

test.afterEach(async ({ page }) => {
  const errors = browserErrors.get(page) ?? [];
  const failures = networkFailures.get(page) ?? [];
  expect(errors, `Unexpected browser errors: ${errors.join(" | ")}`).toEqual([]);
  expect(failures, `Network failures: ${failures.join(" | ")}`).toEqual([]);
});

for (const provider of providers) {
  test(`${provider.label}: setup, contextual runs, persistence, replacement, export, and disconnect`, async ({ page }) => {
    const requests: Request[] = [];
    page.on("request", (request) => requests.push(request));
    await prepare(page);
    await expect(page.locator(".connection-options button")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Continue with Devneya", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use an API key", exact: true })).toBeVisible();
    await connect(page, provider);

    for (const path of provider.catalogPaths) {
      const catalogRequest = matchingRequests(requests, provider, path)[0];
      expect(catalogRequest, `Missing catalog request ${path}`).toBeDefined();
      expect(await catalogRequest!.headerValue(provider.authHeader)).toBe(provider.authValue);
      for (const [name, value] of Object.entries(provider.extraHeaders ?? {})) expect(await catalogRequest!.headerValue(name)).toBe(value);
    }
    expect(requests.filter((request) => request.method() === "POST" && new URL(request.url()).origin === originFor(provider))).toHaveLength(0);
    expect(requests.some((request) => /devneya|supabase\.co/i.test(request.url()) || /\/llm\/v1\//.test(new URL(request.url()).pathname))).toBe(false);
    expect(await storedConnection(page)).toEqual(storedShape(provider));

    const firstPicker = generation(page).first().getByRole("button", { name: "Prompt 1 model picker" });
    await expect(firstPicker).toHaveText("Select model");
    await firstPicker.click();
    const dialog = page.getByRole("dialog", { name: "Prompt 1 models" });
    await expect(dialog.getByRole("radio", { name: `Prompt 1 model ${provider.model}` })).toBeVisible();
    await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    if (provider.id === "openrouter") {
      const publicResult = await page.evaluate(async () => {
        const response = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: "Bearer synthetic-invalid-openrouter-key" } });
        return { status: response.status, body: await response.json() as { data?: Array<{ id?: string }> } };
      });
      expect(publicResult.status).toBe(200);
      expect(publicResult.body.data?.some(({ id }) => id === provider.model)).toBe(true);
    }

    await selectModel(page, provider.model);
    const firstPrompt = `CONTEXT_FIRST_${provider.id}`;
    await generation(page).first().getByLabel("Prompt 1 instruction").fill(firstPrompt);
    const firstCompletion = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).origin === originFor(provider) && new URL(request.url()).pathname === provider.completionPath);
    await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
    const firstRequest = await firstCompletion;
    const firstBody = firstRequest.postDataJSON() as Record<string, unknown>;
    if (provider.id !== "google") expect(firstBody.model).toBe(provider.model);
    else expect(firstRequest.url()).toContain(`models/${provider.model}:generateContent`);
    expect(await firstRequest.headerValue(provider.authHeader)).toBe(provider.authValue);
    await expect(page.locator(".generated-content").filter({ hasText: `${provider.label} mock result` })).toHaveCount(1, { timeout: 15_000 });
    const firstResult = await page.locator(".generated-content").first().innerText();
    await expect(generation(page)).toHaveCount(2);

    await selectModel(page, provider.model, "Prompt 2");
    const secondPrompt = `CONTEXT_SECOND_${provider.id}`;
    await generation(page).nth(1).getByLabel("Prompt 2 instruction").fill(secondPrompt);
    const secondCompletion = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).origin === originFor(provider) && new URL(request.url()).pathname === provider.completionPath && request !== firstRequest);
    await generation(page).nth(1).getByRole("button", { name: "Send prompt" }).click();
    const secondRequest = await secondCompletion;
    const secondBody = secondRequest.postDataJSON() as Record<string, unknown>;
    if (provider.id !== "google") expect(secondBody.model).toBe(provider.model);
    const serializedSecondBody = JSON.stringify(secondBody);
    expect(serializedSecondBody).toContain(firstPrompt);
    expect(serializedSecondBody).toContain(firstResult);
    expect(serializedSecondBody).toContain(secondPrompt);
    expect(await secondRequest.headerValue(provider.authHeader)).toBe(provider.authValue);
    await expect(page.locator(".generated-node")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator(".generated-content").filter({ hasText: `${provider.label} mock result` })).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText("Saved locally")).toBeVisible();
    await waitForStoredText(page, secondPrompt);
    const persisted = JSON.parse(await storedWorkspace(page)) as PersistedRecord[];
    const executions = persisted.flatMap((record) => record.document.flows.flatMap((flow) => flow.batches.flatMap((batch) => batch.executions)));
    expect(executions).toHaveLength(2);
    for (const execution of executions) expect(execution.usage).toEqual(expect.objectContaining({
      promptTokens: expect.any(Number),
      completionTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    }));

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".canvas-shell")).toBeVisible();
    await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue(firstPrompt);
    await expect(page.getByLabel("Prompt 2 instruction")).toHaveValue(secondPrompt);
    await expect(page.locator(".generated-node")).toHaveCount(2);
    await expect(page.locator(".generated-content").filter({ hasText: `${provider.label} mock result` })).toHaveCount(2);
    await expect(generation(page).first().getByRole("button", { name: "Prompt 1 model picker" })).toContainText(provider.model);
    await expect(generation(page).nth(1).getByRole("button", { name: "Prompt 2 model picker" })).toContainText(provider.model);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export options", exact: true }).click();
    await page.getByRole("button", { name: "Export workspace" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let exported = "";
    if (stream) for await (const chunk of stream) exported += chunk.toString();
    expect(exported).toContain(firstPrompt);
    expect(exported).toContain(secondPrompt);
    expect(exported).not.toContain(provider.key);
    if (provider.baseURL) expect(exported).not.toContain(provider.baseURL);
    expect(exported).not.toContain("sk-bf-");
    expect(exported).not.toContain("mock-jwt-");

    await changeConnection(page);
    await selectedProvider(page, provider);
    const rejectedKey = `synthetic-invalid-${provider.id}-browser-key`;
    await page.getByLabel(provider.id === "custom" ? "API key" : `${provider.label} API key`).fill(rejectedKey);
    await page.getByRole("button", { name: provider.id === "custom" ? "Connect to custom endpoint" : `Connect to ${provider.label}` }).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    expect(await storedConnection(page)).toEqual(storedShape(provider));
    await page.getByRole("button", { name: `Back to ${provider.label}` }).click();
    await expect(page.locator(".canvas-shell")).toBeVisible();
    expect(await storedConnection(page)).toEqual(storedShape(provider));

    await page.getByRole("button", { name: "Connection" }).click();
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("heading", { name: "Choose your connection." })).toBeVisible();
    expect(await storedConnection(page)).toEqual({ provider: null });
    expect(JSON.stringify(await storedConnection(page))).not.toContain(provider.key);
    expect(await storedWorkspace(page)).toContain(firstPrompt);
    expect(await storedWorkspace(page)).toContain(secondPrompt);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Choose your connection." })).toBeVisible();
    expect(await storedWorkspace(page)).toContain(firstPrompt);
  });
}

test("the API-key form expands accessibly and exposes all provider choices", async ({ page }) => {
  await prepare(page);
  const open = page.getByRole("button", { name: "Use an API key", exact: true });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  const select = page.getByLabel("Provider");
  await expect(select).toHaveValue("openai");
  await expect(select.locator("option")).toHaveText([
    "OpenAI", "Anthropic", "Google Gemini", "OpenRouter", "Groq", "Mistral", "DeepSeek", "Custom OpenAI-compatible",
  ]);
  await expect(page.getByLabel("OpenAI API key")).toBeVisible();
  await assertNoSeriousA11yViolations(page);
  await select.selectOption("custom");
  await expect(page.getByLabel("API base URL")).toBeVisible();
  await expect(page.getByLabel("API key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect to custom endpoint" })).toBeDisabled();
  await assertNoSeriousA11yViolations(page);
});

test("rejects an invalid custom URL locally and does not fall back to Devneya", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await prepare(page);
  await selectedProvider(page, providers.find(({ id }) => id === "custom")!);
  await page.getByLabel("API base URL").fill("http://custom-provider.example/api/v1");
  await page.getByRole("button", { name: "Connect to custom endpoint" }).click();
  await expect(page.getByRole("alert")).toContainText("HTTPS API base URL");
  expect(requests.some((url) => url.includes("custom-provider.example"))).toBe(false);
  expect(requests.some((url) => /devneya|supabase\.co/i.test(url) || /\/llm\/v1\//.test(new URL(url).pathname))).toBe(false);
  expect(await storedConnection(page)).toEqual({ provider: null });
});

test("a missing custom catalog fails setup without provider fallback", async ({ page }) => {
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  await prepare(page, "catalog-invalid");
  const custom = providers.find(({ id }) => id === "custom")!;
  await selectedProvider(page, custom);
  await page.getByRole("button", { name: "Connect to custom endpoint" }).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
  expect(await storedConnection(page)).toEqual({ provider: null });
  expect(matchingRequests(requests, custom, "/api/v1/models")).toHaveLength(1);
  expect(requests.some((request) => /devneya|supabase\.co/i.test(request.url()) || /\/llm\/v1\//.test(new URL(request.url()).pathname))).toBe(false);
  expect(requests.some((request) => request.method() === "POST" && /\/(?:chat\/completions|messages|generateContent)$/.test(new URL(request.url()).pathname))).toBe(false);
});
