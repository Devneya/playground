import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

test("local canvas loads with verified Codex connection and is accessible", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?view=threads");
  await expect(page.getByLabel("Prompt 1 instruction")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("gpt-6.1-sol", { timeout: 60_000 });
  await expect(page.getByText("Codex · Fast requested · xhigh reasoning · Enter to send")).toBeVisible();
  await page.screenshot({ path: info.outputPath("desktop.png"), fullPage: true });
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByLabel("Prompt 1 instruction")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send prompt", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

for (const [name, question] of [
  ["life", "how to make life better?"],
  ["repair", "I'd like to start a neighborhood repair café, but I have very little money and no venue. How could this work?"],
] as const) test(`ordinary ${name} question chooses an interactive representation`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const replay = process.env.CANVAS_RESPONSE_FIXTURE;
  if (replay) {
    test.info().annotations.push({ type: "recorded-response", description: "Rendering a previously captured model response; no live inference in this run." });
    const json = JSON.parse(await readFile(replay, "utf8"));
    await page.route("**/local-api/completion", (route) => route.fulfill({ json }));
  }
  await page.goto("/?view=threads");
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("gpt-6.1-sol", { timeout: 60_000 });
  await page.getByLabel("Prompt 1 instruction").fill(question);
  const requestPromise = page.waitForRequest((request) => request.url().endsWith("/local-api/completion"));
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/local-api/completion"), { timeout: 610_000 });
  await page.getByLabel("Prompt 1 instruction").press("Enter");
  const request = await requestPromise;
  expect(request.postDataJSON().model).toBe("gpt-6.1-sol");
  expect(request.headers().authorization).toBeUndefined();
  const response = await responsePromise;
  const answer = JSON.stringify(await response.json());
  await writeFile(info.outputPath("model-answer.json"), answer);
  await info.attach("model-answer", { body: answer, contentType: "application/json" });
  expect(response.ok()).toBe(true);
  const ideas = page.locator(".idea-card");
  await expect.poll(() => ideas.count()).toBeGreaterThanOrEqual(1);
  await expect.poll(() => page.locator(".canvas-artifact iframe").count()).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Place map on canvas" })).toHaveCount(0);
  await expect(page.locator(".instruction-textarea")).toHaveCount(0);
  await expect(ideas.first()).toBeInViewport();
  expect(await ideas.first().evaluate((element) => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth)).toBeGreaterThanOrEqual(0.54);
  // Capture the untouched automatic camera, not a manually fitted showcase.
  await page.screenshot({ path: info.outputPath(`${name}-automatic.png`), fullPage: true });
  const boxes = await ideas.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
  }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!; const b = boxes[j]!;
    expect(a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y).toBe(false);
  }
  const visual = page.frameLocator(".canvas-artifact iframe").first();
  await expect(visual.locator("body")).not.toBeEmpty();
  // The model chooses the controls. Operate its first native control and
  // verify a useful selection can leave the visual through the host UI.
  const sliders = visual.locator('input[type="range"]');
  if (await sliders.count()) {
    await sliders.first().focus();
    await sliders.first().press("Home");
    await sliders.first().press("ArrowRight");
  } else if (await visual.locator("button").count()) {
    await visual.locator("button").first().focus();
    await visual.locator("button").first().press("Enter");
  } else {
    throw new Error("The generated visual has no keyboard-accessible interaction");
  }
  await expect(page.getByRole("button", { name: "Explore this selection" })).toBeVisible();
  const buttons = visual.locator("button");
  if (await buttons.count() > 1) {
    const before = await page.locator(".artifact-selection p").textContent();
    const outer = await page.locator(".canvas-artifact iframe").first().boundingBox();
    const inner = await buttons.nth(1).evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: document.documentElement.clientWidth };
    });
    // Playwright's inner-frame click coordinates omit the ancestor canvas
    // transform. Convert observed frame-local coordinates for a real pointer click.
    const scale = outer!.width / inner.width;
    await page.mouse.click(outer!.x + inner.x * scale, outer!.y + inner.y * scale);
    await expect(page.locator(".artifact-selection p")).not.toHaveText(before!);
  }
  await page.screenshot({ path: info.outputPath(`${name}-interacted.png`), fullPage: true });
  await page.getByRole("button", { name: "Explore this selection" }).click();
  await expect(page.locator(".instruction-textarea")).toHaveCount(1);
  expect(await page.locator(".instruction-textarea").inputValue()).not.toBe("");
  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(page.locator(".instruction-textarea")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo last change" }).click();
  await expect(page.locator(".instruction-textarea")).toHaveCount(1);
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const count = await ideas.count();
  await page.reload();
  await expect(ideas).toHaveCount(count);
  await expect.poll(() => page.locator(".canvas-artifact iframe").count()).toBeGreaterThanOrEqual(1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace" }).click();
  expect((await downloadPromise).suggestedFilename()).toContain(".devneya.json");
  expect(errors).toEqual([]);
});
