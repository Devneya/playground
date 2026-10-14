import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("an ordinary opening produces something usable and keeps the human request visible", async ({ page }, info) => {
  let calls = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/local-api/completion", async (route) => {
    calls++;
    if (!process.env.SCENE_LIVE) return route.fulfill({ json: JSON.parse(await readFile(process.env.SCENE_RESPONSE ?? new URL("../fixtures/scene-greeting.json", import.meta.url), "utf8")) });
    return route.continue();
  });
  await page.goto("/?view=surface");
  await expect(page.getByLabel("Workspace model picker")).toContainText("gpt-6.1-sol", { timeout: 60000 });
  await page.getByLabel("Work together", { exact: true }).fill("what's up?");
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/local-api/completion"), { timeout: 610000 });
  await page.getByRole("button", { name: "Make a move" }).click();
  await expect(page.getByRole("complementary", { name: "Your requests" })).toContainText("what's up?");
  await page.screenshot({ path: info.outputPath("waiting.png"), fullPage: true });
  const response = await responsePromise;
  const payload = await response.json();
  await writeFile(info.outputPath("response.json"), JSON.stringify(payload));
  expect(response.ok()).toBe(true);
  await expect(page.locator(".work-scene-stage iframe").first()).toBeVisible();
  const scene = page.frameLocator(".work-scene-stage iframe").first();
  await expect(scene.locator("button,input,select").first()).toBeVisible();
  await writeFile(info.outputPath("visible-interface.txt"), await scene.locator("body").innerText());
  await page.screenshot({ path: info.outputPath("experience.png"), fullPage: true });
  await expect(page.getByRole("complementary", { name: "Your requests" })).toContainText("what's up?");
  await expect(page.getByLabel("Work together", { exact: true })).toHaveCount(0);
  expect(calls).toBe(1);
  expect(errors).toEqual([]);
});
