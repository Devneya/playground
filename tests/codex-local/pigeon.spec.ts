import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

test("captured Pigeon Penthouse can be completed and explored with its actual game state", async ({ page }, info) => {
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);
  const fixture = process.env.PIGEON_RESPONSE_FIXTURE;
  test.skip(!fixture, "Needs the captured model-generated Pigeon Penthouse response.");
  info.annotations.push({ type: "recorded-response", description: "Playing the real captured model output; no new inference." });
  const payload = JSON.parse(await readFile(fixture!, "utf8"));
  let completions = 0;
  await page.route("**/local-api/completion", (route) => { completions += 1; return route.fulfill({ json: payload }); });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?view=threads");
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("gpt-6.1-sol", { timeout: 60000 });
  await page.getByLabel("Prompt 1 instruction").fill("entertain me");
  await page.getByLabel("Prompt 1 instruction").press("Enter");
  await expect(page.locator(".visual-card")).toBeInViewport({ ratio: .98 });
  await page.getByRole("button", { name: "Enter experience" }).click();
  const game = page.frameLocator(".canvas-artifact iframe");
  await game.getByRole("checkbox", { name: "Steady mode" }).check();
  const position = game.getByRole("slider", { name: "Horizontal floor position" });
  for (let floor = 1; floor <= 7; floor += 1) {
    await position.focus();
    await position.press("Home");
    for (let step = 0; step < 5; step += 1) await position.press("PageUp");
    await expect(position).toHaveValue("340");
    await game.getByRole("button", { name: "Drop this floor" }).click();
    await expect(game.locator("#score")).toContainText(`${floor}/7`);
  }
  await expect(game.getByRole("button", { name: "Penthouse complete" })).toBeDisabled();
  await expect(game.getByRole("status")).toContainText("Five stars");
  await expect(page.locator(".artifact-selection p")).toContainText("I completed the penthouse!");
  await page.screenshot({ path: info.outputPath("pigeon-completed.png"), fullPage: true });
  await page.getByRole("button", { name: "Explore this selection" }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(page.locator(".instruction-textarea")).toHaveValue(/I completed the penthouse!.*7\/7/);
  await expect(page.locator(".instruction-textarea")).toBeInViewport({ ratio: .95 });
  expect(completions).toBe(1);
  await page.screenshot({ path: info.outputPath("pigeon-to-thought.png"), fullPage: true });
  if (process.env.PIGEON_PREVIEW_FILE) {
    await page.goto(pathToFileURL(process.env.PIGEON_PREVIEW_FILE).href);
    const preview = page.frameLocator("#scene");
    await expect(preview.getByRole("heading", { name: "Build a hotel. For a pigeon." })).toBeVisible();
    await preview.getByRole("checkbox", { name: "Steady mode" }).check();
    await preview.getByRole("button", { name: "New hotel" }).click();
    await page.screenshot({ path: info.outputPath("pigeon-preview.png"), fullPage: true });
    await preview.getByRole("button", { name: "Drop this floor" }).click();
    await expect(preview.locator("#score")).toContainText("1/7");
  }
  expect(errors).toEqual([]);
});
