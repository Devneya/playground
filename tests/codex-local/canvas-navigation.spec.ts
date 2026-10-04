import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/local-api/llm/v1/models", route => route.fulfill({ json: { object: "list", data: [{ id: "gpt-6.1-sol", object: "model", created: 0, owned_by: "devneya", supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "xhigh" }] } }));
  await page.route("**/local-api/completion", route => route.fulfill({ contentType: "application/x-ndjson", body: [{ type: "delta", text: "A useful answer worth saving.\n\n" + "More context for the answer. ".repeat(35) }, { type: "done" }].map(event => JSON.stringify(event)).join("\n") + "\n" }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("gpt-6.1-sol");
});

test("toolbar export choices, focused model search, and compact effort buttons", async ({ page }, info) => {
  const toolbar = page.getByRole("toolbar", { name: "Canvas", exact: true });
  const labels = await toolbar.locator("button > .tool-caption").allTextContents();
  expect(labels.slice(0, 6)).toEqual(["New prompt", "Upload", "Note", "Undo", "Redo", "Flows"]);
  await expect(toolbar.locator(".toolbar-separator")).toBeVisible();
  await page.getByRole("button", { name: "Export options", exact: true }).click();
  const exports = page.getByRole("dialog", { name: "Export options", exact: true });
  await expect(exports.getByRole("button")).toHaveCount(2);
  await expect(exports.getByRole("button", { name: "Export workspace", exact: true })).toBeVisible();
  await expect(exports.getByRole("button", { name: /Print \/ Save PDF/ })).toBeVisible();
  await page.getByRole("button", { name: "Export options", exact: true }).click();
  await page.getByRole("button", { name: "Prompt 1 model picker" }).click();
  const menu = page.getByRole("dialog", { name: "Prompt 1 models" });
  await expect(menu.getByRole("textbox", { name: "Prompt 1 model search" })).toBeFocused();
  await expect(menu.getByRole("radiogroup")).toBeVisible();
  await expect(menu.getByRole("radiogroup").getByRole("radio")).toHaveCount(5);
  await expect(menu.getByText("Changes apply immediately")).toHaveCount(0);
  await expect(menu.getByRole("combobox")).toHaveCount(0);
  await menu.getByRole("radio", { name: "Prompt 1 gpt-6.1-sol effort low" }).check();
  await page.screenshot({ path: info.outputPath("compact-effort-menu.png"), fullPage: true });
  await menu.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("low");
});

test("zoom controls and panning survive reload with the same focus point", async ({ page }) => {
  const viewport = page.locator(".react-flow__viewport");
  await page.getByRole("button", { name: "zoom out", exact: true }).click();
  await page.getByRole("button", { name: "zoom out", exact: true }).click();
  await page.mouse.move(1250, 750); await page.mouse.down();
  await page.mouse.move(1110, 650, { steps: 12 }); await page.mouse.up();
  const camera = await viewport.getAttribute("style");
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const opening = indexedDB.open("devneya-playground"); opening.onsuccess = () => resolve(opening.result); });
    const documents = await new Promise<unknown[]>(resolve => { const request = db.transaction("workspaces").objectStore("workspaces").getAll(); request.onsuccess = () => resolve(request.result); });
    db.close();
    const saved = documents[0] as { document?: { flows?: { viewport: { zoom: number } }[] }; flows?: { viewport: { zoom: number } }[] } | undefined;
    return (saved?.document?.flows ?? saved?.flows)?.[0]?.viewport.zoom;
  })).toBeLessThan(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("gpt-6.1-sol");
  await expect(viewport).toHaveAttribute("style", camera!);
});

test("latest draft survives an immediate reload", async ({ page }) => {
  const input = page.getByLabel("Prompt 1 instruction");
  await input.fill("An unsent draft with final character Z");
  await page.reload();
  await expect(page.getByLabel("Prompt 1 instruction")).toHaveValue("An unsent draft with final character Z");
});

test("new prompts avoid tall files, highlight nearby, and notes eject next to the output", async ({ page }, info) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 1100"><rect width="500" height="1100" fill="#dde4dd"/></svg>';
  await page.getByLabel("Canvas file").setInputFiles({ name: "tall.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  const file = page.locator(".file-node");
  await expect(file).toBeVisible();
  await page.getByRole("button", { name: "+ Prompt", exact: true }).click();
  const prompt = page.locator(".generation-node").last();
  await expect(prompt.locator("textarea")).toBeFocused();
  await expect(prompt).toHaveClass(/card-arriving/);
  await expect.poll(async () => {
    const f = await file.boundingBox(); const p = await prompt.boundingBox();
    return f && p && (p.x >= f.x + f.width || f.x >= p.x + p.width || p.y >= f.y + f.height || f.y >= p.y + p.height);
  }).toBe(true);
  await page.screenshot({ path: info.outputPath("new-prompt-next-to-tall-file.png"), fullPage: true });
  await prompt.locator("textarea").fill("Give me something worth keeping.");
  await prompt.getByRole("button", { name: "Send prompt" }).click();
  const answer = page.locator(".generated-node");
  await expect(answer.getByRole("button", { name: "Save as note", exact: true })).toBeVisible();
  await expect.poll(async () => {
    const a = await answer.boundingBox(); const canvas = await page.locator(".react-flow").boundingBox();
    return a && canvas && a.y + a.height <= canvas.y + canvas.height * .8 + 2;
  }).toBe(true);
  await answer.getByRole("button", { name: "Save as note", exact: true }).click();
  const note = page.locator(".manual-node");
  await expect(note.locator("textarea")).toBeFocused();
  await expect.poll(async () => {
    const a = await answer.boundingBox(); const n = await note.boundingBox();
    return a && n && n.x >= a.x + a.width && n.x - a.x - a.width < 40 && Math.abs(n.y - a.y) < 2;
  }).toBe(true);
  await expect(note).toHaveCSS("background-color", "rgb(255, 253, 250)");
  await page.screenshot({ path: info.outputPath("note-ejected-next-to-answer.png"), fullPage: true });
});
