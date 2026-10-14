import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

test("typing remains responsive in a populated workspace and sends the final character", async ({ page }, info) => {
  const requests: { messages: { content: string }[] }[] = [];
  await page.route("**/local-api/llm/v1/models", route => route.fulfill({ json: { object: "list", data: [{ id: "gpt-6.1-sol", object: "model", created: 0, owned_by: "devneya" }] } }));
  await page.route("**/local-api/completion", route => { requests.push(route.request().postDataJSON()); return route.fulfill({ contentType: "application/x-ndjson", body: '{"type":"delta","text":"Complete."}\n{"type":"done"}\n' }); });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("gpt-6.1-sol");
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Export options", exact: true }).click(); await page.getByLabel("Export workspace", { exact: true }).click();
  const workspaceExport = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
  const flow = workspaceExport.workspace.flows[0]; const prompt = flow.nodes[0];
  flow.nodes.push(...Array.from({ length: 100 }, (_, index) => ({ ...prompt, id: `note-${index}`, position: { x: 1800 + index % 10 * 510, y: Math.floor(index / 10) * 180 }, data: { kind: "text", origin: "manual", title: `Note ${index + 1}`, text: "Existing material. ".repeat(800) } })));
  await page.getByLabel("Workspace JSON file").setInputFiles({ name: "populated.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(workspaceExport)) });
  const input = page.getByLabel("Prompt 1 instruction"); await expect(input).toHaveValue("");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const metrics = window as unknown as { workspaceWrites: number };
    metrics.workspaceWrites = 0;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) { if (this.name === "workspaces") metrics.workspaceWrites++; return original.call(this, value, key); };
  });
  await input.pressSequentially("Human paced draft", { delay: 250 });
  expect(await page.evaluate(() => (window as unknown as { workspaceWrites: number }).workspaceWrites), "normal typing should not save the whole workspace between keystrokes").toBe(0);
  await input.fill("");
  const singleLineHeight = (await input.boundingBox())!.height;
  await input.fill("First line\nSecond line\nThird line");
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(singleLineHeight + 30);
  await input.fill("");
  await input.evaluate(element => {
    const latencies: number[] = [];
    (window as unknown as { typingLatencies: number[] }).typingLatencies = latencies;
    element.addEventListener("input", () => { const started = performance.now(); requestAnimationFrame(() => latencies.push(performance.now() - started)); });
  });
  const text = "Please examine this material, find the strongest idea, and include this final character: Z";
  const started = Date.now(); await input.pressSequentially(text); const duration = Date.now() - started;
  await expect(input).toHaveValue(text);
  const latencies = await page.evaluate(() => (window as unknown as { typingLatencies: number[] }).typingLatencies);
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * .95)] ?? 0;
  info.annotations.push({ type: "typing-performance", description: JSON.stringify({ characters: text.length, populatedNodes: 101, durationMs: duration, p95PaintMs: p95, maxPaintMs: Math.max(...latencies) }) });
  await info.attach("typing-performance.json", { body: JSON.stringify({ durationMs: duration, p95PaintMs: p95, latencies }), contentType: "application/json" });
  const metricsPath = info.outputPath("typing-performance.json"); await mkdir(dirname(metricsPath), { recursive: true });
  await writeFile(metricsPath, JSON.stringify({ durationMs: duration, p95PaintMs: p95, maxPaintMs: Math.max(...latencies), latencies }, null, 2));
  await input.press("Enter"); await expect(page.locator(".generated-content")).toContainText("Complete.");
  expect(requests[0]?.messages.at(-1)?.content).toBe(text);
  expect(p95, "95% of keystrokes should reach the next animation frame within 100 ms").toBeLessThan(100);
  const continuation = page.getByLabel("Prompt 2 instruction");
  await continuation.fill("A draft to save");
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("devneya-playground");
      opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
    });
    const documents = await new Promise<unknown[]>((resolve, reject) => {
      const getting = db.transaction("workspaces").objectStore("workspaces").getAll();
      getting.onsuccess = () => resolve(getting.result); getting.onerror = () => reject(getting.error);
    });
    db.close();
    return JSON.stringify(documents).includes("A draft to save");
  })).toBe(true);
  await page.reload();
  await expect(page.getByLabel("Prompt 2 instruction")).toHaveValue("A draft to save");
});
