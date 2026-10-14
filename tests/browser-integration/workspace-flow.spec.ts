import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const evidenceDir = process.env.EVIDENCE_DIR;
const OPENAI_TEST_KEY = "synthetic-openai-browser-key";
const OPENAI_TEST_CHAT_MODEL = "gpt-mock-chat";
const ANTHROPIC_TEST_KEY = "synthetic-anthropic-browser-key";
const ANTHROPIC_TEST_CHAT_MODEL = "claude-mock-chat";
const browserErrors = new WeakMap<Page, string[]>();
const networkFailures = new WeakMap<Page, string[]>();
const expectedCancellation = new WeakSet<Page>();
const assertAccessible = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
};
const waitForMockWorker = async (page: Page) => page.evaluate(async () => {
  if (!navigator.serviceWorker) return;
  await Promise.race([navigator.serviceWorker.ready, new Promise<void>((resolve) => window.setTimeout(resolve, 2_000))]);
});

const prepare = async (page: Page, scenario: string, options: { setup?: boolean } = {}) => {
  // Establish this origin without booting the app so its early workspace save
  // cannot repopulate IndexedDB while the test fixture is being reset.
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  await page.goto("/robots.txt");
  await page.evaluate(async ({ scenarioName, setup }) => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem("devneya-mock-scenario", scenarioName);
    if (setup) localStorage.setItem("devneya-playground-connection", JSON.stringify({ provider: null }));
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("devneya-playground");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }, { scenarioName: scenario, setup: options.setup ?? false });
  await page.goto("/");
  await waitForMockWorker(page);
  if (options.setup) await expect(page.getByRole("heading", { name: "Choose your connection." })).toBeVisible({ timeout: 15_000 });
  else await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15_000 });
};

const connectOpenAI = async (page: Page, apiKey = OPENAI_TEST_KEY) => {
  await page.getByRole("button", { name: "Use an API key", exact: true }).click();
  await expect(page.getByLabel("Provider")).toHaveValue("openai");
  await page.getByLabel("OpenAI API key").fill(apiKey);
  await page.getByRole("button", { name: "Connect to OpenAI" }).click();
  await expect(page.locator(".canvas-shell")).toBeVisible();
  await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
};

const connectAnthropic = async (page: Page) => {
  await page.getByRole("button", { name: "Use an API key", exact: true }).click();
  await page.getByLabel("Provider").selectOption("anthropic");
  await page.getByLabel("Anthropic API key").fill(ANTHROPIC_TEST_KEY);
  await page.getByRole("button", { name: "Connect to Anthropic" }).click();
  await expect(page.locator(".canvas-shell")).toBeVisible();
  await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
};

const changeConnection = async (page: Page) => {
  await page.getByRole("button", { name: "Connection" }).click();
  await page.getByRole("button", { name: "Change connection" }).click();
  await expect(page.getByRole("heading", { name: "Choose your connection." })).toBeVisible();
};

const storedConnection = async (page: Page) => page.evaluate(() => {
  const raw = localStorage.getItem("devneya-playground-connection");
  return raw ? JSON.parse(raw) as { provider?: string | null; apiKey?: string } : null;
});

const signIn = async (page: Page, email = "user-a@example.test") => {
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".canvas-shell")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send prompt" })).toBeVisible();
};

const generation = (page: Page) => page.locator(".generation-node");
const fitCanvas = async (page: Page) => page.getByRole("button", { name: "fit view" }).click();
const waitForSave = async (page: Page) => {
  await expect(page.getByText("Saved locally")).toBeVisible({ timeout: 15_000 });
};
const storedWorkspaceJson = async (page: Page) => page.evaluate(() => new Promise<string>((resolve) => {
  const request = indexedDB.open("devneya-playground");
  request.onerror = () => resolve("");
  request.onsuccess = () => {
    const db = request.result;
    const get = db.transaction("workspaces", "readonly").objectStore("workspaces").getAll();
    get.onsuccess = () => { resolve(JSON.stringify(get.result)); db.close(); };
    get.onerror = () => { resolve(""); db.close(); };
  };
}));
const waitForStoredText = async (page: Page, text: string) => {
  await expect.poll(async () => (await storedWorkspaceJson(page)).includes(`"instruction":"${text}"`), { timeout: 15_000 }).toBe(true);
};
const waitForStoredInputCount = async (page: Page, count: number) => {
  await expect.poll(async () => ((await storedWorkspaceJson(page)).match(/"kind":"input"/g) ?? []).length, { timeout: 15_000 }).toBe(count);
};

const selectModel = async (page: Page, modelId: string, title = "Prompt 1") => {
  const node = generation(page);
  await node.getByRole("button", { name: `${title} model picker` }).click();
  await page.getByRole("dialog", { name: `${title} models` }).getByLabel(`${title} model search`).fill(modelId);
  const radio = page.getByRole("radio", { name: `${title} model ${modelId}` });
  if (!(await radio.isChecked())) await radio.check();
  await page.keyboard.press("Escape");
  await fitCanvas(page);
};

const runAndWaitForOutputs = async (page: Page, expectedCount: number, node = generation(page).first()) => {
  await fitCanvas(page);
  const instruction = node.getByLabel(/instruction/);
  if ((await instruction.inputValue()).trim() === "") await instruction.fill("Run the mock instruction.");
  await node.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.locator(".generated-node")).toHaveCount(expectedCount, { timeout: 15_000 });
  await expect(page.locator(".generated-content").filter({ hasText: "Mock result" }).first()).toHaveCount(1, { timeout: 15_000 });
  await fitCanvas(page);
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
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const completionPath = url.pathname === "/v1/chat/completions" || url.pathname === "/llm/v1/chat/completions" || url.pathname === "/v1/messages";
    if (expectedCancellation.has(page) && request.method() === "POST" && completionPath && request.failure()?.errorText === "net::ERR_ABORTED") return;
    failures.push(`${request.method()} ${url.origin}${url.pathname}: ${request.failure()?.errorText ?? "request failed"}`);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const errors = browserErrors.get(page) ?? [];
  const failures = networkFailures.get(page) ?? [];
  const safeName = testInfo.titlePath.join("-").replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  let screenshotPath: string | null = null;
  if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true });
    screenshotPath = join(evidenceDir, `${testInfo.project.name}-${safeName}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    mkdirSync(join(evidenceDir, "observations"), { recursive: true });
    writeFileSync(join(evidenceDir, "observations", `${testInfo.project.name}-${safeName}.json`), `${JSON.stringify({ test: testInfo.titlePath, status: testInfo.status, screenshot: screenshotPath, browserErrors: errors, networkFailures: failures, visualReview: "pending" }, null, 2)}\n`);
  }
  expect(errors, `Unexpected browser errors: ${errors.join(" | ")}`).toEqual([]);
  expect(failures, `Network failures: ${failures.join(" | ")}`).toEqual([]);
});

test.describe("mocked workspace flows", () => {
  test("offers the two hosted choices, runs a contextual OpenAI conversation, and reloads it", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await prepare(page, "default", { setup: true });
    await expect(page.locator(".connection-options button")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Use an API key", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Devneya", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Codex/i })).toHaveCount(0);

    const catalogRequestPromise = page.waitForRequest((request) => request.url() === "https://api.openai.com/v1/models");
    await connectOpenAI(page);
    const catalogRequest = await catalogRequestPromise;
    expect(await catalogRequest.headerValue("authorization")).toBe(`Bearer ${OPENAI_TEST_KEY}`);
    await expect(generation(page).first().getByRole("button", { name: "Prompt 1 model picker" })).toHaveText("Select model");
    const openPicker = generation(page).first().getByRole("button", { name: "Prompt 1 model picker" });
    await openPicker.click();
    await expect(page.getByRole("radio", { name: "Prompt 1 model gpt-mock-chat" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Prompt 1 model text-embedding-mock" })).toBeVisible();
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(requested.filter((url) => url === "https://api.openai.com/v1/models")).toHaveLength(1);
    expect(requested.filter((url) => url === "https://api.openai.com/v1/chat/completions")).toHaveLength(0);
    expect(requested.filter((url) => url.includes("api.devneya.com") || url.includes("supabase.co"))).toHaveLength(0);
    expect(await storedConnection(page)).toEqual({ provider: "openai", apiKey: OPENAI_TEST_KEY });

    await selectModel(page, OPENAI_TEST_CHAT_MODEL);
    const firstInstruction = "Summarize the launch plan in one sentence.";
    await generation(page).first().getByLabel("Prompt 1 instruction").fill(firstInstruction);
    const firstRequestPromise = page.waitForRequest((request) => request.url() === "https://api.openai.com/v1/chat/completions");
    await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
    const firstRequest = await firstRequestPromise;
    const firstBody = firstRequest.postDataJSON() as { model: string; messages: Array<{ role: string; content: string }> };
    expect(firstBody.model).toBe(OPENAI_TEST_CHAT_MODEL);
    expect(firstBody.messages).toEqual([{ role: "user", content: firstInstruction }]);
    await expect(page.locator(".generated-content").filter({ hasText: "OpenAI mock result" })).toHaveCount(1, { timeout: 15_000 });
    const firstResult = await page.locator(".generated-content").first().innerText();
    await expect(generation(page)).toHaveCount(2);

    await selectModel(page, OPENAI_TEST_CHAT_MODEL, "Prompt 2");
    const secondInstruction = "Now list the first follow-up action.";
    await generation(page).nth(1).getByLabel("Prompt 2 instruction").fill(secondInstruction);
    const secondRequestPromise = page.waitForRequest((request) => request.url() === "https://api.openai.com/v1/chat/completions");
    await generation(page).nth(1).getByRole("button", { name: "Send prompt" }).click();
    const secondRequest = await secondRequestPromise;
    const secondBody = secondRequest.postDataJSON() as { model: string; messages: Array<{ role: string; content: string }> };
    expect(secondBody.model).toBe(OPENAI_TEST_CHAT_MODEL);
    expect(secondBody.messages).toContainEqual({ role: "user", content: firstInstruction });
    expect(secondBody.messages).toContainEqual({ role: "assistant", content: firstResult });
    expect(secondBody.messages).toContainEqual({ role: "user", content: secondInstruction });
    await expect(page.locator(".generated-node")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator(".generated-content").filter({ hasText: "OpenAI mock result" })).toHaveCount(2, { timeout: 15_000 });
    await waitForSave(page);
    await waitForStoredText(page, firstInstruction);
    await waitForStoredText(page, secondInstruction);
    type PersistedRecord = {
      document: {
        flows: Array<{
          batches: Array<{
            executions: Array<{ usage?: Record<string, unknown> }>;
          }>;
        }>;
      };
    };
    const persisted = JSON.parse(await storedWorkspaceJson(page)) as PersistedRecord[];
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
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue(firstInstruction);
    await expect(page.getByLabel("Prompt 2 instruction")).toHaveValue(secondInstruction);
    await expect(page.locator(".generated-node")).toHaveCount(2);
    await expect(page.locator(".generated-content").filter({ hasText: "OpenAI mock result" })).toHaveCount(2);
    await expect(generation(page).first().getByRole("button", { name: "Prompt 1 model picker" })).toContainText(OPENAI_TEST_CHAT_MODEL);
    await expect(generation(page).nth(1).getByRole("button", { name: "Prompt 2 model picker" })).toContainText(OPENAI_TEST_CHAT_MODEL);
  });

  test("keeps one workspace through OpenAI, Devneya, OpenAI, and reloads", async ({ page }) => {
    await prepare(page, "default", { setup: true });
    await connectOpenAI(page);
    await selectModel(page, OPENAI_TEST_CHAT_MODEL);
    const text = "SHARED_PROVIDER_WORKSPACE";
    await page.getByLabel("Prompt 1 instruction").fill(text);
    await waitForStoredText(page, text);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".canvas-shell")).toBeVisible();
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue(text, { timeout: 15_000 });
    await expect(generation(page).first().getByRole("button", { name: "Prompt 1 model picker" })).toContainText(OPENAI_TEST_CHAT_MODEL);

    await changeConnection(page);
    await page.getByRole("button", { name: "Continue with Devneya", exact: true }).click();
    await signIn(page);
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue(text);
    expect(await storedConnection(page)).toEqual({ provider: "devneya" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".canvas-shell")).toBeVisible();
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue(text, { timeout: 15_000 });

    await changeConnection(page);
    await connectOpenAI(page);
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue(text);
    await expect(generation(page).first().getByRole("button", { name: "Prompt 1 model picker" })).toContainText(OPENAI_TEST_CHAT_MODEL);
    expect(await storedConnection(page)).toEqual({ provider: "openai", apiKey: OPENAI_TEST_KEY });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".canvas-shell")).toBeVisible();
    await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue(text, { timeout: 15_000 });
  });

  test("keeps the original OpenAI key after a failed replacement and Back", async ({ page }) => {
    await prepare(page, "default", { setup: true });
    await connectOpenAI(page);
    await changeConnection(page);
    await page.getByRole("button", { name: "Use an API key", exact: true }).click();
    await expect(page.getByLabel("Provider")).toHaveValue("openai");
    await page.getByLabel("OpenAI API key").fill("sk-rejected-openai-key");
    await page.getByRole("button", { name: "Connect to OpenAI" }).click();
    await expect(page.getByRole("alert")).toHaveText("OpenAI rejected the API key.");
    expect(await storedConnection(page)).toEqual({ provider: "openai", apiKey: OPENAI_TEST_KEY });
    await page.getByRole("button", { name: "Back to OpenAI" }).click();
    await expect(page.locator(".canvas-shell")).toBeVisible();
    await expect(page.locator(".catalog-dot.live")).toBeVisible();
    expect(await storedConnection(page)).toEqual({ provider: "openai", apiKey: OPENAI_TEST_KEY });
  });

  test("disconnecting OpenAI keeps the workspace and removes the key", async ({ page }) => {
    await prepare(page, "default", { setup: true });
    await connectOpenAI(page);
    const text = "RETAINED_AFTER_OPENAI_DISCONNECT";
    await page.getByLabel("Prompt 1 instruction").fill(text);
    await waitForStoredText(page, text);
    await page.getByRole("button", { name: "Connection" }).click();
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("heading", { name: "Choose your connection." })).toBeVisible();
    expect(await storedConnection(page)).toEqual({ provider: null });
    expect(JSON.stringify(await storedConnection(page))).not.toContain(OPENAI_TEST_KEY);
    expect(await storedWorkspaceJson(page)).toContain(text);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Choose your connection." })).toBeVisible();
    expect(await storedWorkspaceJson(page)).toContain(text);
  });

  test("disconnecting Devneya keeps the workspace and removes its virtual key", async ({ page }) => {
    await prepare(page, "default", { setup: true });
    await page.getByRole("button", { name: "Continue with Devneya", exact: true }).click();
    await signIn(page);
    const text = "RETAINED_AFTER_DEVNEYA_DISCONNECT";
    await page.getByLabel("Prompt 1 instruction").fill(text);
    await waitForStoredText(page, text);
    await page.getByRole("button", { name: "Connection" }).click();
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("heading", { name: "Choose your connection." })).toBeVisible();
    expect(await storedConnection(page)).toEqual({ provider: null });
    const storage = await page.evaluate(() => Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index) ?? "")).join("\n"));
    expect(storage).not.toContain("sk-bf-");
    expect(await storedWorkspaceJson(page)).toContain(text);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Choose your connection." })).toBeVisible();
    expect(await storedWorkspaceJson(page)).toContain(text);
  });

  test("exports an OpenAI workspace without connection credentials", async ({ page }) => {
    await prepare(page, "default", { setup: true });
    await connectOpenAI(page);
    await page.getByLabel("Prompt 1 instruction").fill("OPENAI_EXPORT_TEXT");
    await waitForSave(page);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export options", exact: true }).click();
    await page.getByRole("button", { name: "Export workspace" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let exported = "";
    if (stream) for await (const chunk of stream) exported += chunk.toString();
    expect(exported).toContain("OPENAI_EXPORT_TEXT");
    expect(exported).not.toContain(OPENAI_TEST_KEY);
    expect(exported).not.toContain("sk-bf-");
    expect(exported).not.toContain("mock-jwt-");
  });

  test("cancels a delayed OpenAI run before switching to Devneya", async ({ page }) => {
    await prepare(page, "slow", { setup: true });
    await connectOpenAI(page);
    await selectModel(page, OPENAI_TEST_CHAT_MODEL);
    await page.getByLabel("Prompt 1 instruction").fill("Wait for this delayed mock response.");
    await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
    await expect(page.getByLabel("Generation in progress").getByRole("button", { name: "Cancel run" })).toBeVisible({ timeout: 15_000 });
    expectedCancellation.add(page);
    await changeConnection(page);
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes('"status":"cancelled"')).toBe(true);
    await page.getByRole("button", { name: "Continue with Devneya", exact: true }).click();
    await signIn(page);
    await expect(page.locator(".generated-node")).toContainText("Cancelled: The run was cancelled.");
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes('"status":"cancelled"')).toBe(true);
    await page.waitForTimeout(4_500);
    await expect(page.locator(".generated-node")).toContainText("Cancelled: The run was cancelled.");
    await expect(page.locator(".generated-content").filter({ hasText: "OpenAI mock result" })).toHaveCount(0);
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes('"status":"cancelled"')).toBe(true);
  });

  test("cancels a delayed Devneya run before switching to OpenAI", async ({ page }) => {
    await prepare(page, "slow", { setup: true });
    await page.getByRole("button", { name: "Continue with Devneya", exact: true }).click();
    await signIn(page);
    await generation(page).first().getByLabel("Prompt 1 instruction").fill("Wait for this delayed mock response.");
    await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
    await expect(page.getByLabel("Generation in progress").getByRole("button", { name: "Cancel run" })).toBeVisible({ timeout: 15_000 });
    expectedCancellation.add(page);
    await changeConnection(page);
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes('"status":"cancelled"')).toBe(true);
    await connectOpenAI(page);
    await expect(page.locator(".generated-node")).toContainText("Cancelled: The run was cancelled.");
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes('"status":"cancelled"')).toBe(true);
    await page.waitForTimeout(4_500);
    await expect(page.locator(".generated-node")).toContainText("Cancelled: The run was cancelled.");
    await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(0);
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes('"status":"cancelled"')).toBe(true);
  });

  test("cancels a delayed Anthropic run before switching to Devneya", async ({ page }) => {
    await prepare(page, "slow", { setup: true });
    await connectAnthropic(page);
    await selectModel(page, ANTHROPIC_TEST_CHAT_MODEL);
    await page.getByLabel("Prompt 1 instruction").fill("Wait for this delayed native mock response.");
    await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
    await expect(page.getByLabel("Generation in progress").getByRole("button", { name: "Cancel run" })).toBeVisible({ timeout: 15_000 });
    expectedCancellation.add(page);
    await changeConnection(page);
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes('"status":"cancelled"')).toBe(true);
    await page.getByRole("button", { name: "Continue with Devneya", exact: true }).click();
    await signIn(page);
    await expect(page.locator(".generated-node")).toContainText("Cancelled: The run was cancelled.");
    await page.waitForTimeout(4_500);
    await expect(page.locator(".generated-node")).toContainText("Cancelled: The run was cancelled.");
    await expect(page.locator(".generated-content").filter({ hasText: "Anthropic mock result" })).toHaveCount(0);
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes('"status":"cancelled"')).toBe(true);
  });

  test("cancels a delayed Devneya run before switching to Anthropic", async ({ page }) => {
    await prepare(page, "slow", { setup: true });
    await page.getByRole("button", { name: "Continue with Devneya", exact: true }).click();
    await signIn(page);
    await selectModel(page, "claude-sonnet-5");
    await page.getByLabel("Prompt 1 instruction").fill("Wait for this delayed Devneya response.");
    await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
    await expect(page.getByLabel("Generation in progress").getByRole("button", { name: "Cancel run" })).toBeVisible({ timeout: 15_000 });
    expectedCancellation.add(page);
    await changeConnection(page);
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes('"status":"cancelled"')).toBe(true);
    await connectAnthropic(page);
    await expect(page.locator(".generated-node")).toContainText("Cancelled: The run was cancelled.");
    await page.waitForTimeout(4_500);
    await expect(page.locator(".generated-node")).toContainText("Cancelled: The run was cancelled.");
    await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(0);
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes('"status":"cancelled"')).toBe(true);
  });

  test("links Profile and Dashboard from the connection menu to the Devneya app", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await page.getByRole("button", { name: "Connection" }).click();
    await expect(page.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "https://app.devneya.com/account");
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "https://app.devneya.com/");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("has no serious or critical accessibility violations in the starter workspace", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await assertAccessible(page);
  });

  test("edits a text input, selects a model, and runs one completion", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await page.getByLabel("Prompt 1 instruction").fill("A short internal product brief.");
    await selectModel(page, "claude-sonnet-5");
    await expect(page.getByText("Saved locally")).toBeVisible();
    await runAndWaitForOutputs(page, 1);
    await assertAccessible(page);
    await expect(page.locator(".generated-node")).toContainText("Mock result");
    await expect(page.locator(".generated-node")).toContainText("claude-sonnet-5");
  });

  test("keeps generation disabled for whitespace instructions until valid text is entered", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await selectModel(page, "claude-sonnet-5");
    const instruction = page.getByLabel("Prompt 1 instruction");
    const runButton = generation(page).first().getByRole("button", { name: "Send prompt" });
    await instruction.fill("   \n\t");
    await expect(runButton).toBeDisabled();
    await instruction.fill("Run the mock instruction.");
    await expect(runButton).toBeEnabled();
  });

  test("auto-creates a continuation and exposes Fork on successful results", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await selectModel(page, "claude-sonnet-5");
    await runAndWaitForOutputs(page, 1);
    const result = page.locator(".generated-node").first();
    await expect(result.getByRole("button", { name: "Fork", exact: true })).toBeVisible();
    await expect(generation(page)).toHaveCount(2);
    await expect(generation(page).nth(1).getByLabel("Prompt 2 instruction")).toHaveValue("");
    await result.getByRole("button", { name: "Fork", exact: true }).click();
    await expect(generation(page)).toHaveCount(3);
    await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  });

  test("accepts a second content input on a prompt", async ({ page }) => {
    await prepare(page, "four-models");
    await signIn(page);
    await selectModel(page, "claude-sonnet-5");
    await runAndWaitForOutputs(page, 1);
    const followup = page.locator(".generation-node").nth(1);
    await selectModel(page, "gpt-5.6-sol", "Prompt 2");
    await followup.getByLabel("Prompt 2 instruction").fill("Second model turn.");
    await followup.getByRole("button", { name: "Send prompt" }).click();
    await expect(page.locator(".generated-node")).toHaveCount(2, { timeout: 15_000 });
    await page.getByRole("button", { name: "+ Prompt" }).click();
    await fitCanvas(page);
    const extra = page.locator(".generation-node").last();
    const firstResult = page.locator(".generated-node").first().locator("[data-handleid='text-output']");
    await firstResult.dragTo(extra.locator("[data-handleid='generation-input']"));
    await extra.locator(".context-disclosure summary").click();
    await expect(extra.locator(".context-panel")).toContainText("claude-sonnet-5");
    const secondResult = page.locator(".generated-node").nth(1).locator("[data-handleid='text-output']");
    await secondResult.dragTo(extra.locator("[data-handleid='generation-input']"));
    await expect(extra.locator(".context-panel")).toContainText("gpt-5.6-sol");
    await expect(page.locator(".react-flow__edge")).toHaveCount(6);
    await page.locator(".managed-edge-hoverzone").last().hover();
    await page.getByRole("button", { name: "Remove connection" }).click();
    await expect(page.locator(".react-flow__edge")).toHaveCount(5);
  });

  test("groups the four-provider catalog and runs the selected model", async ({ page }) => {
    await prepare(page, "four-models");
    await signIn(page);
    const picker = page.getByRole("button", { name: "Prompt 1 model picker" });
    await picker.click();
    await expect(page.getByRole("group", { name: "OpenAI" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Claude" })).toBeVisible();
    await expect(page.getByRole("group", { name: "DeepSeek" })).toBeVisible();
    await expect(page.getByRole("group", { name: "GLM" })).toBeVisible();
    await expect(page.getByRole("radio", { checked: true })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await selectModel(page, "glm-5.3");
    await runAndWaitForOutputs(page, 1);
    await expect(page.locator(".generated-node")).toContainText("glm-5.3");
    await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(1);
  });

  test("shows a provider failure on the selected model", async ({ page }) => {
    await prepare(page, "partial-failure");
    await signIn(page);
    await selectModel(page, "gpt-5.6-sol");
    await fitCanvas(page);
    await generation(page).first().getByLabel(/instruction/).fill("Run the mock instruction.");
    await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
    await expect(page.locator(".generated-node").filter({ hasText: "Failed: The provider failed for gpt-5.6-sol." })).toHaveCount(1, { timeout: 15_000 });
  });

  test("cancels an in-flight run before a late response can mutate the canvas", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await selectModel(page, "claude-sonnet-5");
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (!String(input).includes("/llm/v1/chat/completions")) return originalFetch(input, init);
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
      };
    });
    await generation(page).first().getByLabel(/instruction/).fill("Run the mock instruction.");
    await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
    await expect(page.getByLabel("Generation in progress").getByRole("button", { name: "Cancel run" })).toBeVisible({ timeout: 15_000 });
    await fitCanvas(page);
    await page.getByLabel("Generation in progress").getByRole("button", { name: "Cancel run" }).click();
    await expect(generation(page).first().getByRole("button", { name: "Fork", exact: true })).toBeVisible();
    await expect(generation(page).first().getByRole("button", { name: "Send prompt" })).toBeDisabled();
    await expect(page.locator(".generated-node")).toContainText("Cancelled: The run was cancelled.");
    await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(0);
  });

  test("keeps one browser workspace when the Devneya account changes", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page, "user-a@example.test");
    await page.getByLabel("Prompt 1 instruction").fill("USER_A_PRIVATE_TEXT");
    await expect(page.getByText("Saved locally")).toBeVisible();
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue("USER_A_PRIVATE_TEXT");
    await waitForStoredText(page, "USER_A_PRIVATE_TEXT");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue("USER_A_PRIVATE_TEXT", { timeout: 15_000 });
    await page.getByRole("button", { name: "Connection" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();

    await signIn(page, "user-b@example.test");
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue("USER_A_PRIVATE_TEXT");
    await page.getByLabel("Prompt 1 instruction").fill("USER_B_PRIVATE_TEXT");
    await expect(page.getByText("Saved locally")).toBeVisible();
    await page.getByRole("button", { name: "Connection" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();

    await signIn(page, "user-a@example.test");
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue("USER_B_PRIVATE_TEXT");
  });

  test("exports without credentials, clears, and imports a workspace", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await page.getByLabel("Prompt 1 instruction").fill("EXPORTABLE_TEXT");
    await expect(page.getByText("Saved locally")).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export options", exact: true }).click(); await page.getByRole("button", { name: "Export workspace" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let exported = "";
    if (stream) for await (const chunk of stream) exported += chunk.toString();
    expect(exported).toContain("EXPORTABLE_TEXT");
    expect(exported).not.toContain("sk-bf-");
    expect(exported).not.toContain("mock-jwt-");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Clear local workspace" }).click();
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue("");
    await page.getByLabel("Workspace JSON file").setInputFiles({ name: "restore.json", mimeType: "application/json", buffer: Buffer.from(exported) });
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue("EXPORTABLE_TEXT");
  });

  test("reports catalog and account-key failures in the workspace", async ({ page }) => {
    await prepare(page, "catalog-error");
    await signIn(page);
    await expect(page.getByText("Model catalog unavailable")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    await page.getByRole("button", { name: "Connection" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await prepare(page, "key-error");
    await signIn(page);
    await expect(page.locator(".overlay-alert[role=alert]")).toContainText("The account key is unavailable.");
    await expect(generation(page).getByRole("button", { name: "Send prompt" })).toBeDisabled();
  });

  test("duplicates a sent prompt, edits the copy, and preserves the previous result batch", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await selectModel(page, "claude-sonnet-5");
    await runAndWaitForOutputs(page, 1);
    const originalResult = page.locator(".generated-node").first();
    await expect(originalResult).toContainText("Mock result");
    await generation(page).first().getByRole("button", { name: "Fork", exact: true }).click();
    await expect(generation(page)).toHaveCount(3);
    const duplicate = generation(page).last();
    await expect(duplicate.getByLabel("Prompt 3 instruction")).toHaveValue("Run the mock instruction.");
    await duplicate.getByLabel("Prompt 3 instruction").fill("Run this again with the revised instruction.");
    await runAndWaitForOutputs(page, 2, duplicate);
    await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(2);
    await expect(originalResult).toContainText("Mock result");
  });

  test("reloads the authenticated workspace from browser persistence", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await page.getByLabel("Prompt 1 instruction").fill("PERSISTED_AFTER_RELOAD");
    await expect(page.getByText("Saved locally")).toBeVisible();
    await waitForStoredText(page, "PERSISTED_AFTER_RELOAD");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".canvas-shell")).toBeVisible();
    await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue("PERSISTED_AFTER_RELOAD", { timeout: 15_000 });
  });

  test("renders the offline completion recovery state", async ({ page }) => {
    await prepare(page, "offline");
    await signIn(page);
    await selectModel(page, "claude-sonnet-5");
    await fitCanvas(page);
    await generation(page).first().getByLabel(/instruction/).fill("Run the mock instruction.");
    await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
    await expect(page.locator(".generated-node")).toContainText("Failed: The completion request failed.");
  });
});

for (const status of [401, 402, 403]) {
  test(`renders completion HTTP ${status} as a failed result`, async ({ page }) => {
    await prepare(page, `completion-${status === 401 ? "401" : status === 402 ? "402" : "403"}`);
    await signIn(page);
    await selectModel(page, "claude-sonnet-5");
    await fitCanvas(page);
    await generation(page).first().getByLabel(/instruction/).fill("Run the mock instruction.");
    await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
    await expect(page.locator(".generated-node")).toContainText("Failed: The completion request failed.");
  });
}

test("renders an invalid completion payload as a failed result", async ({ page }) => {
  await prepare(page, "completion-invalid");
  await signIn(page);
  await selectModel(page, "claude-sonnet-5");
  await fitCanvas(page);
  await generation(page).first().getByLabel(/instruction/).fill("Run the mock instruction.");
  await generation(page).first().getByRole("button", { name: "Send prompt" }).click();
  await expect(page.locator(".generated-node")).toContainText("Failed: The completion did not contain usable text.");
});


test("connects a result into a new prompt with the pointer and restores the edge after reload", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await selectModel(page, "claude-sonnet-5");
  await runAndWaitForOutputs(page, 1);
  await page.getByRole("button", { name: "+ Prompt" }).click();
  await fitCanvas(page);
  const source = page.locator(".generated-node").first().locator("[data-handleid='text-output']");
  const second = page.locator(".generation-node").last();
  await source.dragTo(second.locator("[data-handleid='generation-input']"));
  await expect(second).toContainText("claude-sonnet-5");
  await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  await waitForSave(page);
  await waitForStoredInputCount(page, 2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".canvas-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".generation-node").last()).toContainText("claude-sonnet-5", { timeout: 15_000 });
});

test("removes an input edge from its hover midpoint control", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await selectModel(page, "claude-sonnet-5");
  await runAndWaitForOutputs(page, 1);
  await page.getByRole("button", { name: "+ Prompt" }).click();
  await fitCanvas(page);
  const second = page.locator(".generation-node").last();
  await page.locator(".generated-node").first().locator("[data-handleid='text-output']").dragTo(second.locator("[data-handleid='generation-input']"));
  const removeButton = page.getByRole("button", { name: "Remove connection" });
  await expect(removeButton).toBeHidden();
  await page.locator(".managed-edge-hoverzone").last().hover();
  await expect(removeButton).toBeVisible();
  await removeButton.click();
  await expect(second.locator(".context-disclosure summary")).toContainText("Context");
  await expect(second.locator(".context-disclosure summary")).not.toContainText("(");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});

test("selects a model through the pill picker with search", async ({ page }) => {
  await prepare(page, "four-models");
  await signIn(page);
  await fitCanvas(page);
  const picker = page.getByRole("button", { name: "Prompt 1 model picker" });
  await expect(picker).toContainText("claude-sonnet-5");
  await picker.click();
  await page.getByLabel("Prompt 1 model search").fill("deepseek-flash");
  await expect(page.getByRole("radio", { name: "Prompt 1 model claude-sonnet-5" })).toBeHidden();
  await page.getByRole("radio", { name: "Prompt 1 model deepseek-flash" }).check();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveText("deepseek-flash");
});

test("threads a result into a second prompt and refuses the cycle back", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await selectModel(page, "claude-sonnet-5");
  await runAndWaitForOutputs(page, 1);
  await page.getByRole("button", { name: "+ Prompt" }).click();
  await fitCanvas(page);
  const second = page.locator(".generation-node").last();
  const outputHandle = page.locator(".generated-node").first().locator("[data-handleid='text-output']");
  await outputHandle.dragTo(second.locator("[data-handleid='generation-input']"));
  await expect(second).toContainText("claude-sonnet-5");
  await page.locator(".managed-edge-hoverzone").last().hover();
  await page.getByRole("button", { name: "Remove connection" }).click();
  await page.locator(".generated-node").first().locator("[data-handleid='text-output']").dragTo(generation(page).first().locator("[data-handleid='generation-input']"));
  await expect(page.getByRole("status")).toContainText("cycle");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});

test("runs a threaded generation from a result input", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await selectModel(page, "claude-sonnet-5");
  await runAndWaitForOutputs(page, 1);
  await page.getByRole("button", { name: "+ Prompt" }).click();
  await fitCanvas(page);
  const second = page.locator(".generation-node").last();
  const secondTitle = (await second.locator(".node-header > strong[title]").textContent())!;
  await page.locator(".generated-node").first().locator("[data-handleid='text-output']").dragTo(second.locator("[data-handleid='generation-input']"));
  await second.getByRole("button", { name: `${secondTitle} model picker` }).click();
  await page.getByRole("radio", { name: `${secondTitle} model claude-sonnet-5` }).check();
  await page.keyboard.press("Escape");
  await second.getByLabel(`${secondTitle} instruction`).fill("Continue the mock thread.");
  await second.getByRole("button", { name: "Send prompt" }).click();
  await expect(page.locator(".generated-node")).toHaveCount(2, { timeout: 15_000 });
});

test("supports flow creation, rename, duplication, activation, deletion, undo, and redo", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await page.getByLabel("Prompt 1 instruction").fill("UNDO_ME");
  const undoButton = page.getByRole("button", { name: "Undo last change" });
  await expect(undoButton).toBeEnabled();
  await undoButton.click();
  await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue("");
  await page.getByRole("button", { name: "Redo last change" }).click();
  await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue("UNDO_ME");
  await page.getByRole("button", { name: "Flows" }).click();
  await page.getByRole("button", { name: "New flow" }).click();
  await expect(page.getByRole("button", { name: "Rename Default flow 2" })).toBeVisible();
  await page.getByRole("button", { name: "Rename Default flow 2" }).click();
  const rename = page.locator(".flow-list-item input");
  await rename.fill("Release flow");
  await rename.press("Enter");
  await expect(page.getByRole("button", { name: "Rename Release flow" })).toBeVisible();
  await page.getByRole("button", { name: "Duplicate Release flow" }).click();
  await expect(page.getByRole("button", { name: "Rename Release flow 2" })).toBeVisible();
  await page.getByRole("button", { name: "Delete Release flow 2" }).click();
  await expect(page.getByRole("button", { name: "Rename Release flow 2" })).toHaveCount(0);
  await page.getByRole("button", { name: "Default flow" }).click();
  await expect(page.locator(".flow-title")).toHaveText("Default flow");
});

test("recovers from one catalog and account-key failure", async ({ page }) => {
  await prepare(page, "catalog-recover");
  await signIn(page);
  await expect(page.getByText("Model catalog unavailable")).toBeVisible();
  await generation(page).getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".catalog-dot.live")).toBeVisible();

  await page.getByRole("button", { name: "Connection" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await prepare(page, "key-recover");
  await signIn(page);
  await expect(page.getByRole("button", { name: "Retry connection" })).toBeVisible();
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(generation(page).getByRole("button", { name: "Send prompt" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry connection" })).toHaveCount(0);
});

test("keeps the editor within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, "default");
  await signIn(page);
  const dimensions = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
});
