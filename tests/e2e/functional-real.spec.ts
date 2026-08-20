import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.env.PLAYGROUND_E2E_BASE_URL ?? "";
const testEmail = process.env.E2E_TEST_EMAIL ?? "";
const testPassword = process.env.E2E_TEST_PASSWORD ?? "";
const isolationEmail = process.env.E2E_TEST_EMAIL_B ?? "";
const isolationPassword = process.env.E2E_TEST_PASSWORD_B ?? "";
const configuredModel = process.env.E2E_TEST_MODEL;
const evidenceDir = process.env.EVIDENCE_DIR;
const pageErrors = new WeakMap<Page, string[]>();
const networkFailures = new WeakMap<Page, string[]>();

const generation = (page: Page) => page.locator(".generation-node");
const fitCanvas = async (page: Page) => page.getByRole("button", { name: "fit view" }).click();

const resetBrowserWorkspace = async (page: Page) => {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("devneya-playground");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  }));
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
  await expect.poll(async () => (await storedWorkspaceJson(page)).includes(`"text":"${text}"`), { timeout: 30_000 }).toBe(true);
};

const signIn = async (page: Page, email = testEmail, password = testPassword) => {
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Compose a flow" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Live model catalog")).toBeVisible({ timeout: 60_000 });
  await expect(generation(page).getByRole("button", { name: "Run generation" })).toBeEnabled({ timeout: 60_000 });
};

const signOut = async (page: Page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 60_000 });
};

const selectRealModel = async (page: Page): Promise<string> => {
  const node = generation(page);
  const available = await node.locator('input[type="checkbox"]').evaluateAll((inputs) => inputs.map((input) => input.getAttribute("aria-label")?.replace(/^Generation 1 model /, "")));
  const model = configuredModel ?? ["gpt-oss-20b", "gpt-oss-120b"].find((candidate) => available.includes(candidate));
  if (!model || !available.includes(model)) throw new Error(`No configured release-test model is available. Available models: ${available.join(", ")}`);
  await node.getByRole("checkbox", { name: `Generation 1 model ${model}` }).check();
  await fitCanvas(page);
  return model;
};

const runAndExpect = async (page: Page, token: string, expectedCount: number) => {
  await fitCanvas(page);
  await generation(page).getByRole("button", { name: "Run generation" }).click();
  const result = page.locator(".generated-content").filter({ hasText: token }).first();
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".generated-node")).toHaveCount(expectedCount);
  await expect(page.getByText("Saved locally")).toBeVisible({ timeout: 30_000 });
  return result;
};

const exportWorkspace = async (page: Page): Promise<string> => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let exported = "";
  if (stream) for await (const chunk of stream) exported += chunk.toString();
  return exported;
};

test.describe("real-server functional E2E", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(() => {
    if (process.env.E2E_MODE === "mock" || process.env.E2E_MODE === "evidence") throw new Error("Real functional E2E cannot run in mock mode.");
    if (!/^https?:\/\//.test(baseUrl) || /(?:localhost|127\.0\.0\.1)/.test(baseUrl)) throw new Error("PLAYGROUND_E2E_BASE_URL must point to a real pre-production or production server.");
    if (!testEmail || !testPassword) throw new Error("E2E_TEST_EMAIL and E2E_TEST_PASSWORD are required for real functional E2E.");
  });

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    const failures: string[] = [];
    pageErrors.set(page, errors);
    networkFailures.set(page, failures);
    page.on("pageerror", (error) => {
      if (/^ResizeObserver loop completed with undelivered notifications\.?$/.test(error.message)) return;
      errors.push(error.message);
    });
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      failures.push(`${request.method()} ${url.origin}${url.pathname}: ${request.failure()?.errorText ?? "request failed"}`);
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Devneya Playground");
    await resetBrowserWorkspace(page);
    await page.reload({ waitUntil: "domcontentloaded" });
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = pageErrors.get(page) ?? [];
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
    expect(errors, `Uncaught browser errors: ${errors.join(" | ")}`).toEqual([]);
    expect(failures, `Network failures: ${failures.join(" | ")}`).toEqual([]);
  });

  test("real server: authenticates, discovers a model, and completes a generation", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Text 1 text").fill("Release smoke input one.");
    await page.getByLabel("Generation 1 instruction").fill("Reply with the token DEVNEYA_SMOKE_ONE and no sensitive information.");
    const model = await selectRealModel(page);
    await runAndExpect(page, "DEVNEYA_SMOKE_ONE", 1);
    await expect(page.locator(".generated-node")).toContainText(model);
  });

  test("real server: preserves ordered inputs and reload persistence", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Text 1 text").fill("ALPHA");
    await page.getByRole("button", { name: "+ Text" }).click();
    await fitCanvas(page);
    await page.getByLabel("Text 3 text").fill("BETA");
    const node = generation(page);
    await node.getByRole("button", { name: "Add input" }).click();
    await expect(node.getByLabel("Reconnect input 2")).toHaveCount(1);
    await node.getByLabel("Generation 1 instruction").fill("Repeat the labels exactly in received order: ALPHA then BETA.");
    await selectRealModel(page);
    const result = await runAndExpect(page, "ALPHA", 1);
    const output = await result.textContent();
    expect(output).toContain("ALPHA");
    expect(output).toContain("BETA");
    expect(output!.indexOf("ALPHA")).toBeLessThan(output!.indexOf("BETA"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Compose a flow" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel("Text 1 text")).toHaveValue("ALPHA");
    await expect(page.getByLabel("Text 3 text")).toHaveValue("BETA");
    await expect(page.locator(".generated-content")).toContainText("ALPHA");
  });

  test("real server: preserves the old result across a rerun and export", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Text 1 text").fill("Rerun release smoke input.");
    await page.getByLabel("Generation 1 instruction").fill("Reply with DEVNEYA_SMOKE_FIRST and no sensitive information.");
    await selectRealModel(page);
    await runAndExpect(page, "DEVNEYA_SMOKE_FIRST", 1);
    await page.getByLabel("Generation 1 instruction").fill("Reply with DEVNEYA_SMOKE_RERUN and no sensitive information.");
    await runAndExpect(page, "DEVNEYA_SMOKE_RERUN", 2);
    await expect(page.locator(".generated-content")).toContainText("DEVNEYA_SMOKE_FIRST");
    const exported = await exportWorkspace(page);
    expect(exported).toContain("DEVNEYA_SMOKE_FIRST");
    expect(exported).toContain("DEVNEYA_SMOKE_RERUN");
    expect(exported).not.toContain("sk-bf-");
    expect(exported).not.toContain("Authorization");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".generated-node")).toHaveCount(2);
    await expect(page.locator(".generated-content")).toContainText("DEVNEYA_SMOKE_RERUN");
  });

  test("real server: clears the workspace and logs out", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Text 1 text").fill("REAL_CLEAR_MARKER");
    await waitForStoredText(page, "REAL_CLEAR_MARKER");
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Clear local workspace" }).click();
    await expect(page.getByLabel("Text 1 text")).toHaveValue("");
    await expect.poll(async () => (await storedWorkspaceJson(page)).includes("REAL_CLEAR_MARKER"), { timeout: 30_000 }).toBe(false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Text 1 text")).toHaveValue("");
    await signOut(page);
  });

  test("real server: isolates two release-test accounts", async ({ page }) => {
    if (!isolationEmail || !isolationPassword) throw new Error("E2E_TEST_EMAIL_B and E2E_TEST_PASSWORD_B are required for real user-isolation E2E.");
    await signIn(page, testEmail, testPassword);
    await page.getByLabel("Text 1 text").fill("REAL_USER_A_MARKER");
    await waitForStoredText(page, "REAL_USER_A_MARKER");
    await signOut(page);
    await signIn(page, isolationEmail, isolationPassword);
    await expect(page.getByLabel("Text 1 text")).not.toHaveValue("REAL_USER_A_MARKER");
    await page.getByLabel("Text 1 text").fill("REAL_USER_B_MARKER");
    await waitForStoredText(page, "REAL_USER_B_MARKER");
    await signOut(page);
    await signIn(page, testEmail, testPassword);
    await expect(page.getByLabel("Text 1 text")).toHaveValue("REAL_USER_A_MARKER");
    await signOut(page);
  });
});
