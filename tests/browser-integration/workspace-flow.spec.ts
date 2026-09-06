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
  await expect(page.locator(".canvas-shell")).toBeVisible();
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
  await expect.poll(async () => (await storedWorkspaceJson(page)).includes(`"instruction":"${text}"`), { timeout: 15_000 }).toBe(true);
};
const waitForStoredInputCount = async (page: Page, count: number) => {
  await expect.poll(async () => ((await storedWorkspaceJson(page)).match(/"kind":"input"/g) ?? []).length, { timeout: 15_000 }).toBe(count);
};

const selectModels = async (page: Page, modelIds: string[]) => {
  const node = generation(page);
  await node.getByRole("button", { name: "Generation 1 model picker" }).click();
  for (const modelId of modelIds) {
    const checkbox = node.getByRole("checkbox", { name: `Generation 1 model ${modelId}` });
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  await page.keyboard.press("Escape");
  await fitCanvas(page);
};

const runAndWaitForOutputs = async (page: Page, expectedCount: number) => {
  await fitCanvas(page);
  await generation(page).first().getByRole("button", { name: "Run generation" }).click();
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
    await page.getByLabel("Generation 1 instruction").fill("A short internal product brief.");
    await selectModels(page, ["model-a"]);
    await expect(page.getByText("Saved locally")).toBeVisible();
    await runAndWaitForOutputs(page, 1);
    await assertAccessible(page);
    await expect(page.locator(".generated-node")).toContainText("Mock result");
    await expect(page.locator(".generated-node")).toContainText("model-a");
  });

  test("refuses a second input with a visible reason", async ({ page }) => {
    await prepare(page, "four-models");
    await signIn(page);
    await selectModels(page, ["model-a", "model-b"]);
    await runAndWaitForOutputs(page, 2);
    await page.getByRole("button", { name: "+ Generation" }).click();
    await fitCanvas(page);
    const second = page.locator(".generation-node").last();
    const firstResult = page.locator(".generated-node").first().locator(".react-flow__handle.source");
    await firstResult.dragTo(second.locator(".react-flow__handle.target"));
    await expect(second).toContainText("model-a");
    const secondResult = page.locator(".generated-node").nth(1).locator(".react-flow__handle.source");
    await secondResult.dragTo(second.locator(".react-flow__handle.target"));
    await expect(page.getByRole("status")).toContainText("at most 1 input");
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);
    await page.locator(".react-flow__edge-managed.input-edge").last().hover();
    await page.getByRole("button", { name: "Remove connection" }).click();
    await secondResult.dragTo(second.locator(".react-flow__handle.target"));
    await expect(second).toContainText("model-b");
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);
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
    await page.getByLabel("Generation 1 instruction").fill("USER_A_PRIVATE_TEXT");
    await expect(page.getByText("Saved locally")).toBeVisible();
    await expect(page.getByLabel("Generation 1 instruction")).toHaveValue("USER_A_PRIVATE_TEXT");
    await waitForStoredText(page, "USER_A_PRIVATE_TEXT");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Generation 1 instruction")).toHaveValue("USER_A_PRIVATE_TEXT", { timeout: 15_000 });
  await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("Email")).toBeVisible();

    await signIn(page, "user-b@example.test");
    await expect(page.getByLabel("Generation 1 instruction")).toHaveValue("");
    await page.getByLabel("Generation 1 instruction").fill("USER_B_PRIVATE_TEXT");
    await expect(page.getByText("Saved locally")).toBeVisible();
  await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();

    await signIn(page, "user-a@example.test");
    await expect(page.getByLabel("Generation 1 instruction")).toHaveValue("USER_A_PRIVATE_TEXT");
    await expect(page.getByLabel("Generation 1 instruction")).not.toHaveValue("USER_B_PRIVATE_TEXT");
  });

  test("exports without credentials, clears, and imports a workspace", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await page.getByLabel("Generation 1 instruction").fill("EXPORTABLE_TEXT");
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
    await expect(page.getByLabel("Generation 1 instruction")).toHaveValue("");
    await page.locator('input[type="file"]').setInputFiles({ name: "restore.json", mimeType: "application/json", buffer: Buffer.from(exported) });
    await expect(page.getByLabel("Generation 1 instruction")).toHaveValue("EXPORTABLE_TEXT");
  });

  test("reports catalog and account-key failures in the workspace", async ({ page }) => {
    await prepare(page, "catalog-error");
    await signIn(page);
    await expect(page.getByText("Model catalog unavailable")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

  await page.getByRole("button", { name: "Account" }).click();
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
    await page.getByLabel("Generation 1 instruction").fill("PERSISTED_AFTER_RELOAD");
    await expect(page.getByText("Saved locally")).toBeVisible();
    await waitForStoredText(page, "PERSISTED_AFTER_RELOAD");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".canvas-shell")).toBeVisible();
    await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Generation 1 instruction")).toHaveValue("PERSISTED_AFTER_RELOAD", { timeout: 15_000 });
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


test("connects a result into a new prompt with the pointer and restores the edge after reload", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await selectModels(page, ["model-a"]);
  await runAndWaitForOutputs(page, 1);
  await page.getByRole("button", { name: "+ Generation" }).click();
  await fitCanvas(page);
  const source = page.locator(".generated-node").first().locator(".react-flow__handle.source");
  const second = page.locator(".generation-node").nth(1);
  await source.dragTo(second.locator(".react-flow__handle.target"));
  await expect(second).toContainText("model-a");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await waitForSave(page);
  await waitForStoredInputCount(page, 1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".generation-node").nth(1)).toContainText("model-a", { timeout: 15_000 });
});

test("removes an input edge from its hover midpoint control", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await selectModels(page, ["model-a"]);
  await runAndWaitForOutputs(page, 1);
  await page.getByRole("button", { name: "+ Generation" }).click();
  await fitCanvas(page);
  const second = page.locator(".generation-node").last();
  await page.locator(".generated-node").first().locator(".react-flow__handle.source").dragTo(second.locator(".react-flow__handle.target"));
  const removeButton = page.getByRole("button", { name: "Remove connection" });
  await expect(removeButton).toBeHidden();
  await page.locator(".react-flow__edge-managed.input-edge").last().hover();
  await expect(removeButton).toBeVisible();
  await removeButton.click();
  await expect(second).toContainText("Context (0)");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});

test("selects models through the pill picker with search", async ({ page }) => {
  await prepare(page, "four-models");
  await signIn(page);
  await fitCanvas(page);
  const picker = page.getByRole("button", { name: "Generation 1 model picker" });
  await expect(picker).toContainText("Select models");
  await picker.click();
  await page.getByLabel("Generation 1 model search").fill("model-c");
  await expect(page.getByRole("checkbox", { name: "Generation 1 model model-a" })).toBeHidden();
  await page.getByRole("checkbox", { name: "Generation 1 model model-c" }).check();
  await page.keyboard.press("Escape");
  await expect(picker).toContainText("model-c (1/4)");
});

test("threads a result into a second prompt and refuses the cycle back", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await selectModels(page, ["model-a"]);
  await runAndWaitForOutputs(page, 1);
  await page.getByRole("button", { name: "+ Generation" }).click();
  await fitCanvas(page);
  const second = page.locator(".generation-node").last();
  const outputHandle = page.locator(".generated-node").first().locator(".react-flow__handle.source");
  await outputHandle.dragTo(second.locator(".react-flow__handle.target"));
  await expect(second).toContainText("model-a");
  await page.locator(".react-flow__edge-managed.input-edge").first().hover();
  await page.getByRole("button", { name: "Remove connection" }).click();
  await page.locator(".generated-node").first().locator(".react-flow__handle.source").dragTo(generation(page).first().locator(".react-flow__handle.target"));
  await expect(page.getByRole("status")).toContainText("cycle");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});

test("runs a threaded generation from a result input", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await selectModels(page, ["model-a"]);
  await runAndWaitForOutputs(page, 1);
  await page.getByRole("button", { name: "+ Generation" }).click();
  await fitCanvas(page);
  const second = page.locator(".generation-node").last();
  const secondTitle = (await second.locator(".node-header strong").textContent())!;
  await page.locator(".generated-node").first().locator(".react-flow__handle.source").dragTo(second.locator(".react-flow__handle.target"));
  await second.getByRole("button", { name: `${secondTitle} model picker` }).click();
  await second.getByRole("checkbox", { name: `${secondTitle} model model-a` }).check();
  await page.keyboard.press("Escape");
  await second.getByRole("button", { name: "Run generation" }).click();
  await expect(page.locator(".generated-node")).toHaveCount(2, { timeout: 15_000 });
});

test("supports flow creation, rename, duplication, activation, deletion, undo, and redo", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await page.getByLabel("Generation 1 instruction").fill("UNDO_ME");
  const undoButton = page.getByRole("button", { name: "Undo last change" });
  await expect(undoButton).toBeEnabled();
  await undoButton.click();
  await expect(page.getByLabel("Generation 1 instruction")).toHaveValue("");
  await page.getByRole("button", { name: "Redo last change" }).click();
  await expect(page.getByLabel("Generation 1 instruction")).toHaveValue("UNDO_ME");
  await page.getByRole("button", { name: "Canvases" }).click();
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
  await expect(page.locator(".flow-title")).toHaveText("Untitled flow");
});

test("recovers from one catalog and account-key failure", async ({ page }) => {
  await prepare(page, "catalog-recover");
  await signIn(page);
  await expect(page.getByText("Model catalog unavailable")).toBeVisible();
  await generation(page).getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".catalog-dot.live")).toBeVisible();

  await page.getByRole("button", { name: "Account" }).click();
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
