import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("waiting can stop and revise the original question without an automatic second request", async ({ page }, info) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route("**/local-api/completion", async (route) => { calls += 1; await held; await route.fulfill({ json: { content: "Late answer" } }).catch(() => {}); });
  await page.goto("/?view=threads");
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("gpt-6.1-sol", { timeout: 60000 });
  await page.getByLabel("Prompt 1 instruction").fill("what's on the sky?");
  await page.getByLabel("Prompt 1 instruction").press("Enter");
  const waiting = page.getByRole("region", { name: "Generation in progress" });
  await expect(waiting).toBeVisible();
  await waiting.getByText("View question sent").click();
  await expect(waiting.getByText("what's on the sky?", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("waiting.png"), fullPage: true });
  await waiting.getByRole("button", { name: "Stop & revise question" }).click();
  await expect(page.getByLabel("Prompt 2 instruction")).toHaveValue("what's on the sky?");
  await page.getByLabel("Prompt 2 instruction").fill("What can I see in the night sky from Madrid?");
  release();
  await expect(waiting).toHaveCount(0);
  await expect(page.getByText("Late answer", { exact: true })).toHaveCount(0);
  expect(calls).toBe(1);
  await expect(page.getByRole("button", { name: "Prompt 2 model picker" })).toContainText("gpt-6.1-sol");
});

test("real sky response becomes distinct readable objects that can be explored and compared", async ({ page }, info) => {
  test.skip(!process.env.SKY_RESPONSE_FIXTURE, "Requires the actual captured sky answer.");
  info.annotations.push({ type: "recorded-response", description: "Testing the real live Codex answer captured for this exact prompt, without repeating inference." });
  page.setDefaultTimeout(20000);
  const payload = JSON.parse(await readFile(process.env.SKY_RESPONSE_FIXTURE!, "utf8"));
  const answer = JSON.parse(payload.content);
  expect(answer.grid.layout).toBe("atlas");
  expect(answer.grid.cells.length).toBeGreaterThanOrEqual(3);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let calls = 0;
  await page.route("**/local-api/completion", (route) => { calls += 1; return route.fulfill({ json: payload }); });
  await page.goto("/?view=threads");
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("gpt-6.1-sol", { timeout: 60000 });
  await page.getByLabel("Prompt 1 instruction").fill("what's on the sky?");
  await page.getByLabel("Prompt 1 instruction").press("Enter");
  const cards = page.locator(".atlas-card");
  await expect(cards).toHaveCount(answer.grid.cells.length);
  for (let i = 0; i < answer.grid.cells.length; i++) {
    await expect(cards.nth(i).getByRole("heading", { name: answer.grid.cells[i].title, exact: true })).toBeVisible();
    await expect(cards.nth(i)).toBeInViewport({ ratio: .96 });
    await expect(cards.nth(i).locator(".artifact-answer, .generated-content")).not.toBeEmpty();
  }
  const boxes = await cards.evaluateAll((elements) => elements.map((el) => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
  }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    expect(a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y).toBe(false);
  }
  await page.screenshot({ path: info.outputPath("sky-automatic.png"), fullPage: true });
  const dayNight = cards.nth(1).frameLocator("iframe");
  await dayNight.getByRole("button", { name: "Show night", exact: true }).focus();
  await dayNight.getByRole("button", { name: "Show night", exact: true }).press("Enter");
  await expect(dayNight.locator("#stars")).toHaveAttribute("opacity", "1");
  await expect(dayNight.getByRole("button", { name: "Show day", exact: true })).toBeVisible();
  await cards.nth(1).getByRole("button", { name: "Ask about this view" }).click();
  await expect(page.locator(".instruction-textarea")).toHaveValue(/night sky.*light pollution/);
  await expect(page.locator(".instruction-textarea")).toBeInViewport({ ratio: .95 });
  await page.screenshot({ path: info.outputPath("sky-night-follow-up.png"), fullPage: true });
  await page.getByRole("button", { name: "Delete Prompt 2", exact: true }).click();
  await cards.nth(1).getByRole("button", { name: "Reset visual", exact: true }).click();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workspace" }).click();
  await (await exported).saveAs(info.outputPath("sky.devneya.json"));
  await page.reload();
  await expect(cards).toHaveCount(answer.grid.cells.length);
  // Each card's question carries the actual subject, with no automatic model call.
  await cards.first().getByRole("button", { name: "Ask about this" }).click();
  await expect(page.locator(".instruction-textarea")).toHaveValue(answer.grid.cells[0].question);
  await expect(page.locator(".instruction-textarea")).toBeInViewport({ ratio: .95 });
  await page.screenshot({ path: info.outputPath("sky-follow-up.png"), fullPage: true });
  // Select two separate subjects, then create a comparison with both as context.
  for (const i of [0, 1]) await cards.nth(i).getByRole("button", { name: `Gather ${answer.grid.cells[i].title}` }).click();
  await page.getByRole("button", { name: "Compare ↔" }).click();
  await expect(page.locator(".instruction-textarea").last()).toHaveValue(/Compare these connected ideas/);
  const comparison = page.locator(".draft-generation-node").last();
  await comparison.locator(".context-disclosure summary").click();
  await expect(comparison.locator(".context-panel")).toContainText(answer.grid.cells[0].text);
  await expect(comparison.locator(".context-panel")).toContainText(answer.grid.cells[1].text);
  await expect(comparison.locator(".context-panel")).not.toContainText(answer.grid.cells[2].text);
  expect(calls).toBe(1);
  expect(errors).toEqual([]);
});
