import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const evidenceDir = process.env.EVIDENCE_DIR;
const browserErrors = new WeakMap<Page, string[]>();
const networkFailures = new WeakMap<Page, string[]>();
const assertAccessible = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
};
const waitForMockWorker = async (page: Page) => page.evaluate(async () => {
  if (!navigator.serviceWorker) return;
  await Promise.race([navigator.serviceWorker.ready, new Promise<void>((resolve) => window.setTimeout(resolve, 2_000))]);
});

const prepare = async (page: Page, scenario: string) => {
  await page.goto("/");
  await waitForMockWorker(page);
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15_000 });
  await page.evaluate(async (scenarioName) => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem("devneya-mock-scenario", scenarioName);
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("devneya-playground");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }, scenario);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMockWorker(page);
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15_000 });
};

const signIn = async (page: Page, email = "user-a@example.test") => {
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Compose a flow" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run generation" })).toBeVisible();
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
  await expect.poll(async () => (await storedWorkspaceJson(page)).includes(`"text":"${text}"`), { timeout: 15_000 }).toBe(true);
};
const waitForStoredInputCount = async (page: Page, count: number) => {
  await expect.poll(async () => ((await storedWorkspaceJson(page)).match(/"kind":"input"/g) ?? []).length, { timeout: 15_000 }).toBe(count);
};

const selectModels = async (page: Page, modelIds: string[]) => {
  const node = generation(page);
  for (const modelId of modelIds) {
    const checkbox = node.getByRole("checkbox", { name: `Generation 1 model ${modelId}` });
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  await fitCanvas(page);
};

const runAndWaitForOutputs = async (page: Page, expectedCount: number) => {
  await fitCanvas(page);
  await generation(page).getByRole("button", { name: "Run generation" }).click();
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
  test("has no serious or critical accessibility violations in the starter workspace", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await assertAccessible(page);
  });

  test("edits a text input, selects a model, and runs one completion", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await page.getByLabel("Text 1 text").fill("A short internal product brief.");
    await selectModels(page, ["model-a"]);
    await expect(page.getByText("Saved locally")).toBeVisible();
    await runAndWaitForOutputs(page, 1);
    await assertAccessible(page);
    await expect(page.locator(".generated-node")).toContainText("Mock result");
    await expect(page.locator(".generated-node")).toContainText("model-a");
  });

  test("adds, reconnects, reorders, and removes a second input", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await page.getByRole("button", { name: "+ Text" }).click();
    await fitCanvas(page);
    await page.getByLabel("Text 3 text").fill("Second input");
    const node = generation(page);
    await node.getByRole("button", { name: "Add input" }).click();
    await expect(node.getByLabel("Reconnect input 2")).toHaveCount(1);
    await fitCanvas(page);
    await node.getByLabel("Generation 1 input 2 move up").click();
    await expect(node.getByLabel("Reconnect input 1")).toHaveValue(/.+/);
    await node.getByLabel("Generation 1 input 1 move down").click();
    await node.getByLabel("Remove input 2").click();
    await expect(node.getByLabel("Reconnect input 2")).toHaveCount(0);
    await expect(node).toContainText("Inputs (1)");
  });

  test("runs all four selected models and preserves result siblings", async ({ page }) => {
    await prepare(page, "four-models");
    await signIn(page);
    await selectModels(page, ["model-a", "model-b", "model-c", "model-d"]);
    await runAndWaitForOutputs(page, 4);
    await expect(page.locator(".generated-node").first()).toContainText("model-a");
    await expect(page.locator(".generated-node").last()).toContainText("model-d");
    await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(4);
  });

  test("shows one provider failure without losing successful siblings", async ({ page }) => {
    await prepare(page, "partial-failure");
    await signIn(page);
    await selectModels(page, ["model-a", "model-b", "model-c", "model-d"]);
    await runAndWaitForOutputs(page, 4);
    await expect(page.locator(".generated-node").filter({ hasText: "Failed: The provider failed for model-b." })).toHaveCount(1);
    await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(3);
  });

  test("cancels an in-flight run before a late response can mutate the canvas", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await selectModels(page, ["model-a"]);
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
    await generation(page).getByRole("button", { name: "Run generation" }).click();
    await expect(generation(page).getByRole("button", { name: "Cancel run" })).toBeVisible({ timeout: 15_000 });
    await generation(page).getByRole("button", { name: "Cancel run" }).click();
    await expect(generation(page).getByRole("button", { name: "Run generation" })).toBeVisible();
    await expect(page.locator(".generated-node")).toContainText("Cancelled: The run was cancelled.");
    await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(0);
  });

  test("keeps separate browser workspaces isolated by user", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page, "user-a@example.test");
    await page.getByLabel("Text 1 text").fill("USER_A_PRIVATE_TEXT");
    await expect(page.getByText("Saved locally")).toBeVisible();
    await expect(page.getByLabel("Text 1 text")).toHaveValue("USER_A_PRIVATE_TEXT");
    await waitForStoredText(page, "USER_A_PRIVATE_TEXT");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("Live model catalog")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Text 1 text")).toHaveValue("USER_A_PRIVATE_TEXT", { timeout: 15_000 });
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();

    await signIn(page, "user-b@example.test");
    await expect(page.getByLabel("Text 1 text")).toHaveValue("");
    await page.getByLabel("Text 1 text").fill("USER_B_PRIVATE_TEXT");
    await expect(page.getByText("Saved locally")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await signIn(page, "user-a@example.test");
    await expect(page.getByLabel("Text 1 text")).toHaveValue("USER_A_PRIVATE_TEXT");
    await expect(page.getByLabel("Text 1 text")).not.toHaveValue("USER_B_PRIVATE_TEXT");
  });

  test("exports without credentials, clears, and imports a workspace", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await page.getByLabel("Text 1 text").fill("EXPORTABLE_TEXT");
    await expect(page.getByText("Saved locally")).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export workspace" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let exported = "";
    if (stream) for await (const chunk of stream) exported += chunk.toString();
    expect(exported).toContain("EXPORTABLE_TEXT");
    expect(exported).not.toContain("sk-bf-");
    expect(exported).not.toContain("mock-jwt-");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Clear local workspace" }).click();
    await expect(page.getByLabel("Text 1 text")).toHaveValue("");
    await page.locator('input[type="file"]').setInputFiles({ name: "restore.json", mimeType: "application/json", buffer: Buffer.from(exported) });
    await expect(page.getByLabel("Text 1 text")).toHaveValue("EXPORTABLE_TEXT");
  });

  test("reports catalog and account-key failures in the workspace", async ({ page }) => {
    await prepare(page, "catalog-error");
    await signIn(page);
    await expect(page.getByText("Model catalog unavailable")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await prepare(page, "key-error");
    await signIn(page);
    await expect(page.getByRole("alert")).toContainText("The account key is unavailable.");
    await expect(generation(page).getByRole("button", { name: "Run generation" })).toBeDisabled();
  });

  test("reruns a generation while preserving the previous result batch", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await selectModels(page, ["model-a"]);
    await runAndWaitForOutputs(page, 1);
    await generation(page).getByLabel("Generation 1 instruction").fill("Run this again with the revised instruction.");
    await runAndWaitForOutputs(page, 2);
    await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(2);
  });

  test("reloads the authenticated workspace from browser persistence", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await page.getByLabel("Text 1 text").fill("PERSISTED_AFTER_RELOAD");
    await expect(page.getByText("Saved locally")).toBeVisible();
    await waitForStoredText(page, "PERSISTED_AFTER_RELOAD");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Compose a flow" })).toBeVisible();
    await expect(page.getByText("Live model catalog")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Text 1 text")).toHaveValue("PERSISTED_AFTER_RELOAD", { timeout: 15_000 });
  });

  test("renders the offline completion recovery state", async ({ page }) => {
    await prepare(page, "offline");
    await signIn(page);
    await selectModels(page, ["model-a"]);
    await fitCanvas(page);
    await generation(page).getByRole("button", { name: "Run generation" }).click();
    await expect(page.locator(".generated-node")).toContainText("Failed: The completion request failed.");
  });
});

for (const status of [401, 402, 403]) {
  test(`renders completion HTTP ${status} as a failed result`, async ({ page }) => {
    await prepare(page, `completion-${status === 401 ? "401" : status === 402 ? "402" : "403"}`);
    await signIn(page);
    await selectModels(page, ["model-a"]);
    await fitCanvas(page);
    await generation(page).getByRole("button", { name: "Run generation" }).click();
    await expect(page.locator(".generated-node")).toContainText("Failed: The completion request failed.");
  });
}

test("renders an invalid completion payload as a failed result", async ({ page }) => {
  await prepare(page, "completion-invalid");
  await signIn(page);
  await selectModels(page, ["model-a"]);
  await fitCanvas(page);
  await generation(page).getByRole("button", { name: "Run generation" }).click();
  await expect(page.locator(".generated-node")).toContainText("Failed: The completion did not contain usable text.");
});


test("connects a new Text node with the pointer and restores the edge after reload", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await page.getByRole("button", { name: "+ Text" }).click();
  await fitCanvas(page);
  const source = page.locator(".react-flow__node-text").filter({ hasText: "Text 3" }).locator(".react-flow__handle.source");
  const target = generation(page).locator(".react-flow__handle.target");
  await source.dragTo(target);
  await expect(generation(page)).toContainText("Inputs (2)");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await waitForSave(page);
  await waitForStoredInputCount(page, 2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Live model catalog")).toBeVisible({ timeout: 15_000 });
  await expect(generation(page)).toContainText("Inputs (2)", { timeout: 15_000 });
});

test("rejects an accessible cycle attempt with a visible reason", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await selectModels(page, ["model-a"]);
  await runAndWaitForOutputs(page, 1);
  await page.getByRole("button", { name: "+ Generation" }).click();
  await fitCanvas(page);
  const second = page.locator(".generation-node").nth(1);
  const secondTitle = (await second.locator(".node-header strong").textContent())!;
  await second.getByRole("button", { name: "Add input" }).click();
  await fitCanvas(page);
  await second.getByRole("combobox", { name: `${secondTitle} input source` }).selectOption({ label: "model-a" });
  await second.getByRole("button", { name: "Add input" }).click();
  await second.getByRole("checkbox", { name: `${secondTitle} model model-a` }).check();
  await second.getByRole("button", { name: "Run generation" }).click();
  await expect(page.locator(".generated-node")).toHaveCount(2, { timeout: 15_000 });
  const firstInput = generation(page).first().getByLabel("Reconnect input 1");
  const outputOption = firstInput.locator("option").nth(2);
  const outputId = await outputOption.getAttribute("value");
  expect(outputId).toBeTruthy();
  await firstInput.selectOption(outputId!);
  await expect(page.getByRole("status")).toContainText("cycle");
  await expect(firstInput).not.toHaveValue(outputId!);
});

test("merges two upstream paths into a second generation", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await page.getByLabel("Text 1 text").fill("BRANCH_ALPHA");
  await page.getByRole("button", { name: "+ Text" }).click();
  await fitCanvas(page);
  await page.getByLabel("Text 3 text").fill("BRANCH_BETA");
  await page.getByRole("button", { name: "+ Generation" }).click();
  await fitCanvas(page);
  const second = page.locator(".generation-node").nth(1);
  const secondTitle = (await second.locator(".node-header strong").textContent())!;
  await second.getByRole("button", { name: "Add input" }).click();
  await fitCanvas(page);
  await second.getByRole("combobox", { name: `${secondTitle} input source` }).selectOption({ label: "Text 3" });
  await second.getByRole("button", { name: "Add input" }).click();
  await second.getByRole("checkbox", { name: `${secondTitle} model model-a` }).check();
  await second.getByLabel(`${secondTitle} instruction`).fill("Repeat both branch labels.");
  await second.getByRole("button", { name: "Run generation" }).click();
  await expect(page.locator(".generated-node")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".generated-content")).toContainText("Mock result");
  await expect(second).toContainText("Inputs (2)");
});

test("supports flow creation, rename, duplication, activation, deletion, undo, and redo", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await page.getByLabel("Text 1 text").fill("UNDO_ME");
  const undoButton = page.getByRole("button", { name: "Undo last change" });
  await expect(undoButton).toBeEnabled();
  await undoButton.click();
  await expect(page.getByLabel("Text 1 text")).toHaveValue("");
  await page.getByRole("button", { name: "Redo last change" }).click();
  await expect(page.getByLabel("Text 1 text")).toHaveValue("UNDO_ME");
  await page.getByRole("button", { name: "New flow" }).click();
  await expect(page.getByRole("button", { name: "Rename Untitled flow 2" })).toBeVisible();
  await page.getByRole("button", { name: "Rename Untitled flow 2" }).click();
  const rename = page.locator(".flow-list-item input");
  await rename.fill("Release flow");
  await rename.press("Enter");
  await expect(page.getByRole("button", { name: "Rename Release flow" })).toBeVisible();
  await page.getByRole("button", { name: "Duplicate Release flow" }).click();
  await expect(page.getByRole("button", { name: "Rename Release flow 2" })).toBeVisible();
  await page.getByRole("button", { name: "Delete Release flow 2" }).click();
  await expect(page.getByRole("button", { name: "Rename Release flow 2" })).toHaveCount(0);
  await page.getByRole("button", { name: "Untitled flow" }).click();
  await expect(page.locator(".canvas-toolbar .eyebrow")).toHaveText("Untitled flow");
});

test("recovers from one catalog and account-key failure", async ({ page }) => {
  await prepare(page, "catalog-recover");
  await signIn(page);
  await expect(page.getByText("Model catalog unavailable")).toBeVisible();
  await generation(page).getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Live model catalog")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await prepare(page, "key-recover");
  await signIn(page);
  await expect(page.getByRole("button", { name: "Retry account key" })).toBeVisible();
  await page.getByRole("button", { name: "Retry account key" }).click();
  await expect(generation(page).getByRole("button", { name: "Run generation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry account key" })).toHaveCount(0);
});

test("keeps the editor within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, "default");
  await signIn(page);
  const dimensions = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
});
