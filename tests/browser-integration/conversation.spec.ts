import { expect, test, type Page, type Request, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const browserErrors = new WeakMap<Page, string[]>();
const networkFailures = new WeakMap<Page, string[]>();

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

const signIn = async (page: Page) => {
  await page.getByLabel("Email").fill("user-a@example.test");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".canvas-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Prompt 1 instruction")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
  // The product has one spatial chat canvas. These assertions make stale mode
  // controls fail loudly if they accidentally return to the shell.
  await expect(page.getByRole("button", { name: "Conversation view" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Map view" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editor view" })).toHaveCount(0);
};

const generation = (page: Page, title?: string) => {
  const nodes = page.locator(".generation-node");
  return title ? nodes.filter({ has: page.locator(`.node-header strong[title="${title}"]`) }) : nodes;
};

const result = (page: Page, modelId?: string) => {
  const nodes = page.locator(".generated-node");
  return modelId ? nodes.filter({ has: page.locator(`.node-header strong[title="${modelId}"]`) }) : nodes;
};

const chooseModel = async (page: Page, title: string, modelId: string, options: { uncheck?: string } = {}) => {
  const node = generation(page, title);
  await node.getByRole("button", { name: `${title} model picker` }).click();
  const checkbox = node.getByRole("checkbox", { name: `${title} model ${modelId}` });
  if (!(await checkbox.isChecked())) await checkbox.check();
  if (options.uncheck) {
    const inherited = node.getByRole("checkbox", { name: `${title} model ${options.uncheck}` });
    await expect(inherited).toBeChecked();
    await inherited.uncheck();
  }
  await page.keyboard.press("Escape");
};

const completionBody = (request: Request) => JSON.parse(request.postData() ?? "{}") as {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
};

const capture = async (page: Page, testInfo: TestInfo, name: string) => {
  const path = testInfo.outputPath(name);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  return path;
};

const viewportTransform = async (page: Page) => page.evaluate(() => {
  const element = document.querySelector<HTMLElement>(".react-flow__viewport");
  const transform = element ? getComputedStyle(element).transform : "none";
  if (transform === "none") return { x: 0, y: 0, zoom: 1 };
  const match = transform.match(/^matrix\(([^)]+)\)$/);
  if (!match) return { x: 0, y: 0, zoom: 1 };
  const values = (match[1] ?? "").split(",").map(Number);
  return { x: values[4] ?? 0, y: values[5] ?? 0, zoom: values[0] ?? 1 };
});

// React Flow scales card boxes with the viewport zoom. Normalize measurements
// back to CSS pixels so the assertions guard the product's 8px chat gap and
// compact card budgets at any camera position.
const cardGap = async (page: Page, from: ReturnType<typeof generation>, to: ReturnType<typeof generation>) => {
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  expect(fromBox).not.toBeNull();
  expect(toBox).not.toBeNull();
  if (!fromBox || !toBox) return Number.NaN;
  const { zoom } = await viewportTransform(page);
  return (toBox.y - (fromBox.y + fromBox.height)) / Math.max(zoom, 0.001);
};

const waitForCardGap = async (page: Page, from: ReturnType<typeof generation>, to: ReturnType<typeof generation>) => {
  await expect.poll(() => cardGap(page, from, to), { timeout: 15_000 }).toBeGreaterThanOrEqual(7);
  await expect.poll(() => cardGap(page, from, to), { timeout: 15_000 }).toBeLessThanOrEqual(9);
};

const compactCardHeight = async (page: Page, card: ReturnType<typeof generation>) => {
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return Number.POSITIVE_INFINITY;
  const { zoom } = await viewportTransform(page);
  return box.height / Math.max(zoom, 0.001);
};

const expectCompactCard = async (page: Page, card: ReturnType<typeof generation>, maxHeight: number) => {
  await expect.poll(() => compactCardHeight(page, card), { timeout: 15_000 }).toBeLessThanOrEqual(maxHeight);
};

const storedWorkspace = async (page: Page) => page.evaluate(() => new Promise<unknown>((resolve) => {
  const request = indexedDB.open("devneya-playground");
  request.onerror = () => resolve(null);
  request.onsuccess = () => {
    const db = request.result;
    const get = db.transaction("workspaces", "readonly").objectStore("workspaces").getAll();
    get.onsuccess = () => { resolve(get.result); db.close(); };
    get.onerror = () => { resolve(null); db.close(); };
  };
}));

type StoredNode = { id: string; position: { x: number; y: number }; data: { kind: string; modelIds?: string[] } };
type StoredExecution = { outputNodeId?: string; modelId: string };
type StoredFlow = { id: string; nodes: StoredNode[]; batches?: Array<{ executions: StoredExecution[] }> };
type StoredRecord = { document?: { activeFlowId?: string; flows?: StoredFlow[] } };

const storedActiveFlow = async (page: Page) => {
  const records = await storedWorkspace(page) as StoredRecord[] | null;
  const document = records?.[0]?.document;
  return document?.flows?.find((flow) => flow.id === document.activeFlowId) ?? null;
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

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? [], "Unexpected browser errors").toEqual([]);
  expect(networkFailures.get(page) ?? [], "Network failures").toEqual([]);
});

test("opens one spatial chat canvas at natural zoom", async ({ page }, testInfo) => {
  await prepare(page, "four-models");
  await signIn(page);
  await expect(page.locator(".canvas-shell")).toBeVisible();
  await expect(page.locator(".generation-node .node-header .drag-hint")).toBeVisible();
  const prompt = generation(page, "Prompt 1");
  const contextBox = await prompt.locator(".context-disclosure summary").boundingBox();
  const modelBox = await prompt.locator(".model-pill").boundingBox();
  const closeBox = await prompt.getByRole("button", { name: "Delete Prompt 1" }).boundingBox();
  expect(Math.abs(contextBox!.y + contextBox!.height / 2 - modelBox!.y - modelBox!.height / 2)).toBeLessThan(1);
  expect(Math.abs(closeBox!.y + closeBox!.height / 2 - modelBox!.y - modelBox!.height / 2)).toBeLessThan(1);
  const inputBox = await prompt.locator(".prompt-compose").boundingBox();
  const sendBox = await prompt.getByRole("button", { name: "Send prompt" }).boundingBox();
  expect(sendBox!.x + sendBox!.width).toBeLessThan(inputBox!.x + inputBox!.width);
  expect(sendBox!.y + sendBox!.height).toBeLessThan(inputBox!.y + inputBox!.height);
  const navigation = page.locator(".canvas-toolbar-floating .canvas-navigation");
  await expect(navigation.getByRole("button", { name: "zoom in", exact: true })).toBeVisible();
  await navigation.getByRole("button", { name: "zoom in", exact: true }).click();
  await expect.poll(async () => (await viewportTransform(page)).zoom).toBeGreaterThan(1);
  await navigation.getByRole("button", { name: "fit view", exact: true }).click();
  await expect.poll(async () => (await viewportTransform(page)).zoom).toBeLessThanOrEqual(1);
  await capture(page, testInfo, "spatial-chat-initial.png");
});

test("selects a live default model and ejects a note without moving the thread", async ({ page }, testInfo) => {
  await prepare(page, "default");
  await signIn(page);
  const prompt = generation(page, "Prompt 1");
  await expect(prompt.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("model-a");
  await prompt.getByLabel("Prompt 1 instruction").fill("A useful thought to keep.");
  await prompt.getByRole("button", { name: "Send prompt" }).click();
  const answer = result(page, "model-a").first();
  await expect(generation(page, "Prompt 2")).toBeVisible();
  const before = await answer.evaluate((node) => node.closest<HTMLElement>(".react-flow__node")?.style.transform);
  const noteAction = answer.locator(".node-header").getByRole("button", { name: "Save as note" });
  await expect(noteAction).toHaveText("Note");
  await noteAction.click();
  const note = page.locator(".manual-node");
  await expect(note).toHaveCount(1);
  await expect(note.getByRole("textbox")).toHaveValue("Mock result 1 from model-a.");
  await expect.poll(() => answer.evaluate((node) => node.closest<HTMLElement>(".react-flow__node")?.style.transform)).toBe(before);
  // Read both rectangles in one frame: CameraFollow can still be panning,
  // so separate boundingBox calls can observe different viewport transforms.
  await expect.poll(() => note.evaluate((element) => {
    const source = document.querySelector(".generated-node");
    if (!source) return false;
    const answerBox = source.getBoundingClientRect();
    const noteBox = element.getBoundingClientRect();
    return noteBox.left >= answerBox.right && noteBox.bottom <= answerBox.top;
  })).toBe(true);
  await expect.poll(async () => {
    const box = await note.boundingBox();
    return box ? box.x + box.width : Infinity;
  }).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(generation(page)).toHaveCount(2);
  await answer.getByRole("button", { name: "Branch", exact: true }).click();
  await expect(generation(page)).toHaveCount(3);
  await note.locator(".note-source summary").click();
  await expect(note.locator(".note-source")).toContainText("A useful thought to keep.");
  await note.getByRole("textbox").fill("My edited note");
  await expect(note.locator(".note-source")).toContainText("Mock result 1 from model-a.");
  await note.locator(".note-source summary").click();
  await page.getByRole("button", { name: "fit view" }).click();
  await expect.poll(async () => {
    const n = await note.boundingBox();
    const b = await generation(page, "Prompt 3").boundingBox();
    return !!n && !!b && n.y + n.height <= b.y;
  }).toBe(true);
  await capture(page, testInfo, "note-ejected.png");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".manual-node textarea")).toHaveValue("My edited note");
  await page.locator(".manual-node .note-source summary").click();
  await expect(page.locator(".note-source")).toContainText("A useful thought to keep.");
  await page.getByRole("button", { name: "fit view" }).click();
  await page.locator(".manual-node").getByRole("button", { name: "Source ↗" }).click();
  await expect(result(page, "model-a").first()).toBeInViewport();
});

test("default mock offers two models that can be selected together", async ({ page }, testInfo) => {
  await prepare(page, "default");
  await signIn(page);
  const prompt = generation(page, "Prompt 1");
  await prompt.getByRole("button", { name: "Prompt 1 model picker" }).click();
  await expect(prompt.getByRole("checkbox")).toHaveCount(2);
  await prompt.getByRole("checkbox", { name: "Prompt 1 model model-b" }).check();
  await expect(prompt.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await capture(page, testInfo, "two-model-picker.png");
  await page.keyboard.press("Escape");
  await prompt.getByLabel("Prompt 1 instruction").fill("Compare two responses.");
  await prompt.getByRole("button", { name: "Send prompt" }).click();
  await expect(result(page)).toHaveCount(2);
  await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(2);
  await capture(page, testInfo, "default-two-models.png");
});

for (const count of [2, 3, 4]) {
  test(`compares ${count} models on the same surface`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1800, height: 1000 });
    await prepare(page, "four-models");
    await signIn(page);
    for (const model of ["model-b", "model-c", "model-d"].slice(0, count - 1)) await chooseModel(page, "Prompt 1", model);
    await generation(page, "Prompt 1").getByLabel("Prompt 1 instruction").fill("Compare approaches to a compact, branching conversation.");
    await generation(page, "Prompt 1").getByRole("button", { name: "Send prompt" }).click();
    await expect(result(page)).toHaveCount(count);
    await expect(generation(page)).toHaveCount(count + 1);
    await expect(page.locator(".generated-content").filter({ hasText: "Mock result" })).toHaveCount(count);
    await page.getByRole("button", { name: "fit view" }).click();
    await expect.poll(async () => {
      const boxes = await result(page).evaluateAll((nodes) => nodes.map((node) => {
        const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }));
      return boxes.every((a, i) => boxes.every((b, j) => i === j || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
    }).toBe(true);
    await capture(page, testInfo, `comparison-${count}-models.png`);
  });
}

test("sends with Enter, keeps Shift+Enter in the prompt, and compacts a completed two-turn thread", async ({ page }, testInfo) => {
  await prepare(page, "default");
  await signIn(page);
  await chooseModel(page, "Prompt 1", "model-a");
  const firstPrompt = "Explain the first\nconversation turn.";
  const firstInstruction = page.getByLabel("Prompt 1 instruction");
  await firstInstruction.fill("Explain the first");
  await firstInstruction.press("Shift+Enter");
  await firstInstruction.pressSequentially("conversation turn.");
  await expect(firstInstruction).toHaveValue(firstPrompt);
  const firstRequestPromise = page.waitForRequest((request) => request.url().includes("/llm/v1/chat/completions"));
  await firstInstruction.press("Enter");
  const firstBody = completionBody(await firstRequestPromise);
  expect(firstBody.model).toBe("model-a");
  expect(firstBody.messages).toEqual([{ role: "user", content: firstPrompt }]);
  await expect(result(page, "model-a").first().locator(".generated-content")).toBeVisible({ timeout: 15_000 });
  const firstResponseText = (await result(page, "model-a").first().locator(".generated-content").textContent())?.trim() ?? "";
  await expect(generation(page, "Prompt 2").getByLabel("Prompt 2 instruction")).toBeVisible({ timeout: 15_000 });
  await expect(generation(page, "Prompt 1").locator(".completed-prompt")).toBeVisible();
  await expect(generation(page, "Prompt 1").getByLabel("Prompt 1 instruction")).toHaveCount(0);
  await expect(generation(page, "Prompt 1").locator(".completed-prompt")).toContainText(firstPrompt);
  await waitForCardGap(page, generation(page, "Prompt 1"), result(page, "model-a").first());
  await waitForCardGap(page, result(page, "model-a").first(), generation(page, "Prompt 2"));

  const followupPrompt = "Now turn that explanation into three actions.";
  const followupInstruction = generation(page, "Prompt 2").getByLabel("Prompt 2 instruction");
  await followupInstruction.fill(followupPrompt);
  await expect(followupInstruction).toHaveValue(followupPrompt);
  const secondRequestPromise = page.waitForRequest((request) => request.url().includes("/llm/v1/chat/completions"));
  await followupInstruction.press("Enter");
  const secondBody = completionBody(await secondRequestPromise);
  expect(secondBody.model).toBe("model-a");
  expect(secondBody.messages).toEqual([
    { role: "user", content: firstPrompt },
    { role: "assistant", content: firstResponseText },
    { role: "user", content: followupPrompt },
  ]);
  await expect(result(page, "model-a")).toHaveCount(2, { timeout: 15_000 });
  await expect(generation(page, "Prompt 2").locator(".completed-prompt")).toBeVisible();
  await expect(generation(page, "Prompt 3").getByLabel("Prompt 3 instruction")).toBeVisible({ timeout: 15_000 });
  await expect(generation(page, "Prompt 2").locator(".context-disclosure summary")).toContainText("Context (2)");
  await waitForCardGap(page, generation(page, "Prompt 2"), result(page, "model-a").nth(1));
  await waitForCardGap(page, result(page, "model-a").nth(1), generation(page, "Prompt 3"));
  await capture(page, testInfo, "spatial-chat-two-turn.png");
  await expect(page.getByText("Saved locally")).toBeVisible({ timeout: 15_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".canvas-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".catalog-dot.live")).toBeVisible({ timeout: 15_000 });
  await expect(generation(page, "Prompt 3").getByLabel("Prompt 3 instruction")).toBeVisible({ timeout: 15_000 });
  await waitForCardGap(page, result(page, "model-a").nth(1), generation(page, "Prompt 3"));
});

test("branches a response into a prompt to the right of its continuation", async ({ page }, testInfo) => {
  await prepare(page, "default");
  await signIn(page);
  await chooseModel(page, "Prompt 1", "model-a");
  const branchInstruction = page.getByLabel("Prompt 1 instruction");
  await branchInstruction.fill("Start a branchable thread.");
  await expect(branchInstruction).toHaveValue("Start a branchable thread.");
  await branchInstruction.press("Enter");
  await expect(result(page, "model-a").first().locator(".generated-content")).toBeVisible({ timeout: 15_000 });
  await expect(generation(page, "Prompt 2").getByLabel("Prompt 2 instruction")).toBeVisible({ timeout: 15_000 });
  const originalContinuation = generation(page, "Prompt 2");
  await result(page, "model-a").first().getByRole("button", { name: "Branch" }).click();
  await expect(generation(page, "Prompt 3").getByLabel("Prompt 3 instruction")).toBeVisible({ timeout: 15_000 });
  const siblingContinuation = generation(page, "Prompt 3");
  const originalBox = await originalContinuation.boundingBox();
  const siblingBox = await siblingContinuation.boundingBox();
  expect(originalBox).not.toBeNull();
  expect(siblingBox).not.toBeNull();
  if (originalBox && siblingBox) expect(siblingBox.x).toBeGreaterThan(originalBox.x + originalBox.width - 8);
  await siblingContinuation.getByLabel("Prompt 3 instruction").fill("A sibling branch direction.");
  await expect(siblingContinuation.getByLabel("Prompt 3 instruction")).toHaveValue("A sibling branch direction.");
  await expect.poll(async () => {
    const card = await siblingContinuation.boundingBox();
    const canvas = await page.locator(".react-flow").boundingBox();
    return card && canvas ? card.x + card.width - canvas.x - canvas.width : Infinity;
  }).toBeLessThanOrEqual(0);
  await capture(page, testInfo, "spatial-chat-parallel-branch.png");
});

test("duplicates a sent prompt while preserving frozen context and model history", async ({ page }, testInfo) => {
  await prepare(page, "four-models");
  await signIn(page);
  await chooseModel(page, "Prompt 1", "model-a");
  const rootPrompt = "Start a source conversation.";
  const rootInstruction = page.getByLabel("Prompt 1 instruction");
  await rootInstruction.fill(rootPrompt);
  await expect(rootInstruction).toHaveValue(rootPrompt);
  await rootInstruction.press("Enter");
  await expect(result(page, "model-a").first().locator(".generated-content")).toBeVisible({ timeout: 15_000 });
  const rootResult = (await result(page, "model-a").first().locator(".generated-content").textContent())?.trim() ?? "";
  await expectCompactCard(page, generation(page, "Prompt 1"), 80);
  await expectCompactCard(page, result(page, "model-a").first(), 85);

  const source = generation(page, "Prompt 2");
  await expect(source.getByLabel("Prompt 2 instruction")).toBeVisible({ timeout: 15_000 });
  const followupPrompt = "Continue with a concrete plan.";
  const followupInstruction = source.getByLabel("Prompt 2 instruction");
  await followupInstruction.fill(followupPrompt);
  await expect(followupInstruction).toHaveValue(followupPrompt);
  const followupRequestPromise = page.waitForRequest((request) => request.url().includes("/llm/v1/chat/completions"));
  await followupInstruction.press("Enter");
  const followupBody = completionBody(await followupRequestPromise);
  expect(followupBody.model).toBe("model-a");
  await expect(result(page, "model-a")).toHaveCount(2, { timeout: 15_000 });
  await expectCompactCard(page, source, 80);
  await expectCompactCard(page, generation(page, "Prompt 3"), 135);

  await expect(source.getByRole("button", { name: "Branch", exact: true })).toBeVisible();
  await source.getByRole("button", { name: "Branch", exact: true }).click();
  const duplicate = generation(page, "Prompt 4");
  await expect(duplicate.getByLabel("Prompt 4 instruction")).toHaveValue(followupPrompt);
  await expect(duplicate.getByRole("button", { name: "Prompt 4 model picker" })).toContainText("model-a");
  await expect(source.locator(".completed-prompt")).toContainText(followupPrompt);
  await expect(source.getByLabel("Prompt 2 instruction")).toHaveCount(0);
  await expectCompactCard(page, duplicate, 135);
  await chooseModel(page, "Prompt 4", "model-b", { uncheck: "model-a" });
  const duplicateInstruction = duplicate.getByLabel("Prompt 4 instruction");
  await expect(duplicateInstruction).toHaveValue(followupPrompt);
  const duplicateRequestPromise = page.waitForRequest((request) => request.url().includes("/llm/v1/chat/completions"));
  await duplicateInstruction.press("Enter");
  const duplicateBody = completionBody(await duplicateRequestPromise);
  expect(duplicateBody.model).toBe("model-b");
  expect(duplicateBody.messages).toEqual([
    { role: "user", content: rootPrompt },
    { role: "assistant", content: rootResult },
    { role: "user", content: followupPrompt },
  ]);
  await expectCompactCard(page, duplicate, 80);
  await expect(result(page, "model-b").locator(".generated-content")).toBeVisible({ timeout: 15_000 });
  await expectCompactCard(page, result(page, "model-b"), 85);
  const history = generation(page, "Prompt 5").locator(".context-disclosure");
  await expect(generation(page, "Prompt 5").getByLabel("Prompt 5 instruction")).toBeVisible({ timeout: 15_000 });
  await expectCompactCard(page, generation(page, "Prompt 5"), 135);
  await history.locator("summary").click();
  await expect(history.locator(".context-entry-role").filter({ hasText: "model-a" })).toHaveCount(1);
  await expect(history.locator(".context-entry-role").filter({ hasText: "model-b" })).toHaveCount(1);
  await page.getByRole("button", { name: "fit view" }).click();
  await capture(page, testInfo, "expanded-context.png");
});

test("pans vertically over an answer without changing zoom", async ({ page }) => {
  await prepare(page, "default");
  await signIn(page);
  await chooseModel(page, "Prompt 1", "model-a");
  const panInstruction = page.getByLabel("Prompt 1 instruction");
  await panInstruction.fill("Pan around this answer.");
  await expect(panInstruction).toHaveValue("Pan around this answer.");
  await panInstruction.press("Enter");
  await expect(result(page, "model-a").first().locator(".generated-content")).toContainText("Mock result", { timeout: 15_000 });
  const canvas = page.locator(".react-flow");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;
  // CameraFollow leaves the newly created continuation focused, so the answer
  // can be just above the viewport. Pan the canvas up until the answer is in
  // view before checking wheel-over-answer behavior.
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  for (let attempt = 0; attempt < 8 && !(await result(page, "model-a").first().locator(".generated-content").isVisible()); attempt += 1) {
    await page.mouse.wheel(0, -320);
  }
  await expect(result(page, "model-a").first().locator(".generated-content")).toBeVisible({ timeout: 15_000 });
  const answer = result(page, "model-a").first().locator(".generated-content");
  const box = await answer.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const before = await viewportTransform(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => viewportTransform(page)).not.toEqual(before);
  const after = await viewportTransform(page);
  expect(after.zoom).toBeCloseTo(before.zoom, 5);
  expect(after.y).not.toBe(before.y);
});

test("persists a manually moved answer with its model and graph snapshot", async ({ page }, testInfo) => {
  await prepare(page, "default");
  await signIn(page);
  await chooseModel(page, "Prompt 1", "model-a");
  const moveInstruction = page.getByLabel("Prompt 1 instruction");
  await moveInstruction.fill("Persist this moved answer.");
  await expect(moveInstruction).toHaveValue("Persist this moved answer.");
  await moveInstruction.press("Enter");
  await expect(result(page, "model-a").first().locator(".generated-content")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Saved locally")).toBeVisible({ timeout: 15_000 });
  const beforeFlow = await storedActiveFlow(page);
  const answer = result(page, "model-a").first();
  const answerId = await answer.evaluate((element) => element.closest<HTMLElement>(".react-flow__node")?.dataset.id ?? "");
  const beforeNode = beforeFlow?.nodes.find((node) => node.id === answerId);
  expect(beforeNode).toBeDefined();
  const header = answer.locator(".node-header");
  const headerBox = await header.boundingBox();
  expect(headerBox).not.toBeNull();
  if (!headerBox || !beforeNode) return;
  await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(headerBox.x + headerBox.width / 2 + 140, headerBox.y + headerBox.height / 2 + 80, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const flow = await storedActiveFlow(page);
    const node = flow?.nodes.find((candidate) => candidate.id === answerId);
    return node ? node.position.x !== beforeNode.position.x || node.position.y !== beforeNode.position.y : false;
  }, { timeout: 15_000 }).toBe(true);
  const movedFlow = await storedActiveFlow(page);
  const movedNode = movedFlow?.nodes.find((node) => node.id === answerId);
  expect(movedNode?.position).not.toEqual(beforeNode.position);
  expect(movedFlow?.batches?.flatMap((batch) => batch.executions).find((execution) => execution.outputNodeId === answerId)?.modelId).toBe("model-a");
  await capture(page, testInfo, "spatial-chat-manual-movement.png");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".canvas-shell")).toBeVisible({ timeout: 15_000 });
  await expect(result(page, "model-a").first().locator(".generated-content")).toBeVisible({ timeout: 15_000 });
});

test("lays out a long response without card overlaps", async ({ page }) => {
  await prepare(page, "default");
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (!String(input).includes("/llm/v1/chat/completions")) return originalFetch(input, init);
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { model?: string };
      const model = body.model ?? "model-a";
      const longText = Array.from({ length: 180 }, (_, index) => `Long response paragraph ${index + 1}: spatial chat should keep this answer readable and clear.`).join(" ");
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: longText } }], usage: { prompt_tokens: 12, completion_tokens: 800, total_tokens: 812 }, model }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  });
  await signIn(page);
  await chooseModel(page, "Prompt 1", "model-a");
  const longInstruction = page.getByLabel("Prompt 1 instruction");
  await longInstruction.fill("Produce a long answer.");
  await expect(longInstruction).toHaveValue("Produce a long answer.");
  await longInstruction.press("Enter");
  await expect(result(page, "model-a").first().locator(".generated-content")).toContainText("Long response paragraph 180", { timeout: 15_000 });
  await expect(generation(page, "Prompt 2").getByLabel("Prompt 2 instruction")).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return cards.every((card, index) => cards.every((other, otherIndex) => index === otherIndex || card.right <= other.left + 1 || other.right <= card.left + 1 || card.bottom <= other.top + 1 || other.bottom <= card.top + 1));
  }), { timeout: 15_000 }).toBe(true);
});

test("keeps the spatial chat within a mobile viewport and has no serious accessibility violations", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, "four-models");
  await signIn(page);
  const dimensions = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
  const navigation = page.locator(".canvas-toolbar-floating .canvas-navigation");
  await expect(navigation.getByRole("button", { name: "zoom in", exact: true })).toBeInViewport();
  await expect(navigation.getByRole("button", { name: "fit view", exact: true })).toBeInViewport();
  const toolbarBox = await page.locator(".canvas-toolbar-floating").boundingBox();
  expect(toolbarBox?.height).toBeLessThanOrEqual(84);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  await capture(page, testInfo, "spatial-chat-mobile.png");
});
