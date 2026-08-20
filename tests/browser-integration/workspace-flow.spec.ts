import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const evidenceDir = process.env.EVIDENCE_DIR;
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
  await expect(page.locator(".generated-content").filter({ hasText: "Mock result" }).first()).toHaveCount(1, { timeout: 15_000 });
  await fitCanvas(page);
  await expect(page.locator(".generated-content").filter({ hasText: "Mock result" }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".generated-node")).toHaveCount(expectedCount);
};

test.afterEach(async ({ page }, testInfo) => {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  const safeName = testInfo.titlePath.join("-").replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  await page.screenshot({ path: join(evidenceDir, `${testInfo.project.name}-${safeName}.png`), fullPage: true });
});

test.describe("mocked workspace flows", () => {
  test("edits a text input, selects a model, and runs one completion", async ({ page }) => {
    await prepare(page, "default");
    await signIn(page);
    await page.getByLabel("Text 1 text").fill("A short internal product brief.");
    await selectModels(page, ["model-a"]);
    await expect(page.getByText("Saved locally")).toBeVisible();
    await runAndWaitForOutputs(page, 1);
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
    await page.reload();
    await expect(page.getByRole("heading", { name: "Compose a flow" })).toBeVisible();
    await expect(page.getByLabel("Text 1 text")).toHaveValue("PERSISTED_AFTER_RELOAD");
    await expect(page.getByText("Live model catalog")).toBeVisible();
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
