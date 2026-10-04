import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300"><title>Elephant</title><ellipse cx="220" cy="160" rx="130" ry="80" fill="#aaa"/><path d="M 330 170 Q 400 170 390 260" fill="none" stroke="#aaa" stroke-width="30"/></svg>';
const stream = (text: string) => [{ type: "status", text: "Request sent to Codex" }, { type: "delta", text }, { type: "done" }].map(event => JSON.stringify(event)).join("\n") + "\n";

test("progress, Markdown and stored drawings work in the original boxes", async ({ page }, info) => {
  let release: () => void = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const payloads: { messages: { content: string }[] }[] = [];
  await page.route("**/local-api/llm/v1/models", route => route.fulfill({ json: { object: "list", data: [{ id: "gpt-6.1-sol", object: "model", created: 0, owned_by: "devneya", supportedReasoningEfforts: ["low", "xhigh"], defaultReasoningEffort: "xhigh" }] } }));
  await page.route("**/local-api/completion", async route => {
    payloads.push(route.request().postDataJSON());
    calls++;
    if (calls === 1) await ready;
    const text = calls === 1 ? `# Elephant\n\n**Large** mammal.\n\n\`\`\`text\n / __ \\\n| (oo) |\n\`\`\`\n\n\`\`\`svg\n${svg}\n\`\`\`` : "The stored vector is available for revision.";
    await route.fulfill({ contentType: "application/x-ndjson", body: stream(text) });
  });
  await page.goto("/");
  const input = page.getByLabel("Prompt 1 instruction");
  await expect(input).toHaveAttribute("placeholder", "Ask gpt-6.1-sol", { timeout: 60_000 });
  await expect(input).toHaveCSS("text-align", "right");
  expect(await input.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(53);
  await expect(page.locator(".react-flow__attribution")).toHaveCount(0);
  await input.fill("Draw an elephant."); await input.press("Enter");
  const pending = page.getByLabel("Generation in progress");
  await expect(pending).toBeVisible();
  await expect(pending.getByLabel("Characters received")).toHaveText("0 characters received");
  await expect(pending.getByLabel("Elapsed time")).not.toHaveText("0:00");
  await expect(page.locator(".send-button.running")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("waiting.png"), fullPage: true });
  release();
  await expect(page.locator(".stored-images img")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Elephant", exact: true })).toBeVisible();
  await expect(page.locator(".markdown-text strong")).toHaveText("Large");
  await expect(page.locator(".markdown-text pre")).toHaveCSS("white-space", "pre");
  await expect(page.locator(".markdown-text pre")).toContainText("(oo)");
  await expect(pending).toHaveCount(0);
  expect(await page.locator(".stored-images img").evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download image" }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe("Elephant.svg");
  const imagePath = await download.path(); expect(await readFile(imagePath!, "utf8")).toBe(svg);
  await page.getByRole("button", { name: "fit view", exact: true }).click(); await page.waitForTimeout(500);
  await page.screenshot({ path: info.outputPath("drawing.png"), fullPage: true });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.locator(".stored-images img")).toHaveCount(1);
  const exportPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Export options", exact: true }).click(); await page.getByLabel("Export workspace").click();
  const exported = await exportPromise; const saved = JSON.parse(await readFile((await exported.path())!, "utf8"));
  expect(saved.workspace.flows[0].nodes.some((node: { data: { images?: { source: string }[] } }) => node.data.images?.[0]?.source === svg)).toBe(true);
  await page.getByLabel("Prompt 2 instruction").fill("Make its trunk longer."); await page.getByLabel("Prompt 2 instruction").press("Enter");
  await expect(page.locator(".generated-node")).toHaveCount(2);
  await expect(page.locator(".generated-content").last()).toContainText("available for revision");
  expect(payloads[1]?.messages.some(message => message.content.includes(svg))).toBe(true);
});

test("live Codex draws a locally stored elephant", async ({ page }, info) => {
  const fixture = process.env.CANVAS_DRAW_FIXTURE;
  test.skip(process.env.CANVAS_DRAW_LIVE !== "1" && !fixture, "Explicit live drawing test.");
  if (fixture) {
    const output = await readFile(fixture, "utf8");
    info.annotations.push({ type: "recorded-live-output", description: "Rendering a captured real Codex drawing; no new drawing inference." });
    await page.route("**/local-api/completion", route => route.fulfill({ contentType: "application/x-ndjson", body: output }));
  }
  await page.goto("/");
  const input = page.getByLabel("Prompt 1 instruction");
  await expect(input).toHaveAttribute("placeholder", "Ask gpt-6.1-sol", { timeout: 60_000 });
  await input.fill("Draw a recognizable friendly elephant in side view, with a long curved trunk, large ear and four legs, in a clean vector illustration. Keep the explanation to one short sentence.");
  const responsePromise = page.waitForResponse(response => response.url().endsWith("/local-api/completion"), { timeout: 610_000 });
  await input.press("Enter");
  if (!fixture) {
    await expect(page.getByLabel("Generation in progress")).toBeVisible();
    await page.screenshot({ path: info.outputPath("live-waiting.png"), fullPage: true });
  }
  const response = await responsePromise; expect(response.ok()).toBe(true);
  const output = await response.text(); await writeFile(info.outputPath("live-output.ndjson"), output);
  const image = page.locator(".stored-images img");
  await expect(image).toHaveCount(1, { timeout: 30_000 });
  await expect(image).toHaveJSProperty("complete", true);
  expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "fit view", exact: true }).click(); await page.waitForTimeout(500);
  await page.screenshot({ path: info.outputPath("live-elephant.png"), fullPage: true });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.locator(".stored-images img")).toHaveCount(1);
});
