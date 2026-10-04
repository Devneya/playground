import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const modelIds = ["gpt-6.1-sol", "gpt-6-luna", "gpt-5.5"];
const models = { object: "list", data: modelIds.map((id) => ({ id, object: "model", created: 0, owned_by: "devneya" })) };
const wire = (reply: object) => [{ type: "delta", text: JSON.stringify({ type: "intent", message: "Build a working instrument" }) + "\n" + JSON.stringify({ type: "experience", ...reply }) + "\n" }, { type: "done", serviceTier: "priority" }].map((event) => JSON.stringify(event)).join("\n") + "\n";
const initial = (model: string) => ({ title: `Instrument by ${model}`, description: "Move a real value, then reshape the work.", state: { diagram: { x: 1 }, origin: model }, html: `<style>main{padding:40px}h1{font:40px Georgia}button{padding:16px}</style><main><h1>Spatial instrument ${model}</h1><output id="value"></output><button id="move">Move point</button><input aria-label="An unfinished edit"><p id="blocked"></p></main><script>let state=studio.state;const render=()=>document.getElementById('value').textContent='Position '+state.diagram.x;render();studio.onRestore(next=>{state=next;render()});document.getElementById('move').onclick=()=>{state.diagram.x++;render();studio.commit(state,'Moved point to '+state.diagram.x)};document.getElementById('blocked').textContent=studio.commit({bad:true},'Automatic request')?'BAD':'Automatic request blocked';document.getElementById('move').dispatchEvent(new MouseEvent('click',{bubbles:true}));state=studio.state;render();</script>` });
const transformed = (x: number) => ({ title: `A different medium at ${x}`, description: "The diagram became a typographic construction with a different state shape.", state: { construction: [`Human position ${x}`] }, html: `<main style="padding:60px;background:#263e44;color:#faf0d6;min-height:100vh"><h1 style="font:48px Georgia">Now a construction</h1><p id="built"></p></main><script>const render=s=>document.getElementById('built').textContent=s.construction.join(' / ');render(studio.state);studio.onRestore(render);</script>` });
const submit = async (page: Page, text: string) => { await page.getByLabel("Direct the work").fill(text); await page.getByLabel("Direct the work").press("Enter"); };
test.beforeEach(async ({ page }) => { page.setDefaultTimeout(20000); });

test("three actual model routes, genuine gestures, arbitrary transformations and restorable history", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: models }));
  const calls: { model: string; current: { state: { diagram: { x: number } } } | null }[] = [];
  await page.route("**/local-api/completion", (route) => {
    const body = route.request().postDataJSON(), input = JSON.parse(body.messages[0].content); calls.push({ model: body.model, current: input.current });
    return route.fulfill({ contentType: "application/x-ndjson", body: wire(input.current ? transformed(input.current.state.diagram.x) : initial(body.model)) });
  });
  await page.goto("/"); await expect(page.getByLabel("Collaborators model picker")).toContainText("gpt-5.5");
  await submit(page, "Explore interactions by changing the interface itself");
  await expect(page.locator(".experience-versions .ready")).toHaveCount(3);
  expect(calls.map((call) => call.model).sort()).toEqual([...modelIds].sort());
  await page.getByRole("button", { name: "gpt-5.5 Open this version" }).click();
  const frame = page.frameLocator(".experience-frame");
  await expect(frame.getByText("Automatic request blocked")).toBeVisible();
  await expect(frame.locator("output")).toHaveText("Position 1");
  expect(calls).toHaveLength(3);
  await frame.getByRole("button", { name: "Move point" }).click();
  await expect(frame.locator("output")).toHaveText("Position 2");
  await expect(frame.getByRole("heading", { name: "Now a construction" })).toBeVisible();
  expect(calls).toHaveLength(4); expect(calls[3]!.model).toBe("gpt-5.5"); expect(calls[3]!.current!.state.diagram.x).toBe(2);
  await expect(page.getByLabel("Workspace history", { exact: true })).toContainText("Moved point to 2");
  await page.getByRole("button", { name: /Open version \d+: Instrument by gpt-5.5/ }).click();
  await expect(frame.locator("output")).toHaveText("Position 1");
  await page.getByRole("button", { name: /Open version \d+: Moved point to 2/ }).click();
  await expect(frame.locator("output")).toHaveText("Position 2");
  await page.getByRole("button", { name: "Pause model", exact: true }).click();
  await frame.getByRole("button", { name: "Move point" }).click();
  await expect(frame.locator("output")).toHaveText("Position 3");
  await expect(page.locator(".experience-status")).toContainText("model paused");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.frameLocator(".experience-frame").locator("output")).toHaveText("Position 3");
  expect(calls).toHaveLength(4);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export workspace" }).click();
  const path = await (await download).path(); const saved = JSON.parse(await readFile(path!, "utf8"));
  expect(saved.workspace.flows[0].experience.revisions.some((revision: { state: object }) => "construction" in revision.state)).toBe(true);
  await page.screenshot({ path: info.outputPath("restored-work.png"), animations: "disabled" }); expect(errors).toEqual([]);
});

test("a late model cannot overwrite newer gestures, and the latest gesture drives the next turn", async ({ page }) => {
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: { ...models, data: models.data.slice(0, 1) } }));
  let calls = 0, release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/local-api/completion", async (route) => {
    const input = JSON.parse(route.request().postDataJSON().messages[0].content); calls++;
    if (calls === 1) return route.fulfill({ contentType: "application/x-ndjson", body: wire(initial(modelIds[0]!)) });
    if (calls === 2) await waiting;
    return route.fulfill({ contentType: "application/x-ndjson", body: wire(transformed(input.current.state.diagram.x)) });
  });
  await page.goto("/"); await expect(page.getByLabel("Collaborators model picker")).toContainText("gpt-6.1-sol"); await submit(page, "Work on this");
  const frame = page.frameLocator(".experience-frame"); await frame.getByRole("button", { name: "Move point" }).click();
  await expect.poll(() => calls).toBe(2);
  await frame.getByRole("button", { name: "Move point" }).click(); await expect(frame.locator("output")).toHaveText("Position 3");
  // An unfinished input must not be replaced by a late model response.
  await frame.getByLabel("An unfinished edit").fill("Do not erase me"); release();
  await expect.poll(() => calls).toBe(3); await expect(page.locator(".experience-versions .ready")).toHaveCount(1);
  await expect(frame.getByLabel("An unfinished edit")).toHaveValue("Do not erase me");
  await expect(frame.locator("output")).toHaveText("Position 3");
  await expect(page.getByLabel("Workspace history", { exact: true })).toContainText("A different medium at 2");
  await expect(page.getByLabel("Workspace history", { exact: true })).toContainText("A different medium at 3");
  await page.getByRole("button", { name: /Open version \d+: A different medium at 3/ }).click();
  await expect(frame.locator("#built")).toHaveText("Human position 3");
});

test("opening an early result keeps pending model approaches available", async ({ page }) => {
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: models }));
  let release!: () => void; const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/local-api/completion", async (route) => {
    const model = route.request().postDataJSON().model;
    if (model !== "gpt-6.1-sol") await waiting;
    return route.fulfill({ contentType: "application/x-ndjson", body: wire(initial(model)) });
  });
  await page.goto("/"); await expect(page.getByLabel("Collaborators model picker")).toContainText("gpt-5.5"); await submit(page, "Three different ways");
  await expect(page.locator(".experience-versions .ready")).toHaveCount(1);
  await page.getByRole("button", { name: /Open version 2:/ }).click(); release();
  await expect(page.locator(".experience-versions .ready")).toHaveCount(3);
  await expect(page.locator(".experience-versions .working")).toHaveCount(0);
});

test("stopping preserves the draft and rejects a late result", async ({ page }) => {
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: { ...models, data: models.data.slice(0, 1) } }));
  let release!: () => void; const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/local-api/completion", async (route) => { await waiting; await route.fulfill({ contentType: "application/x-ndjson", body: wire(initial(modelIds[0]!)) }).catch(() => {}); });
  await page.goto("/"); await expect(page.getByLabel("Collaborators model picker")).toContainText("gpt-6.1-sol"); await submit(page, "Keep this request visible");
  await page.getByLabel("Direct the work").fill("Keep this unfinished direction");
  await page.getByRole("button", { name: "Stop", exact: true }).click(); release();
  await expect(page.locator(".experience-versions .failed")).toContainText("Stopped");
  await expect(page.locator(".experience-frame")).toHaveCount(0);
  await expect(page.getByLabel("Direct the work")).toHaveValue("Keep this unfinished direction");
  await expect(page.getByLabel("Workspace history", { exact: true })).toContainText("Keep this request visible");
});

test("live three-model workspace generation", async ({ page }, info) => {
  test.skip(process.env.RUN_EXPERIENCE_LIVE !== "1", "Explicit live run only");
  await page.setViewportSize({ width: 1920, height: 1200 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/"); await expect(page.getByLabel("Collaborators model picker")).toContainText("gpt-5.5", { timeout: 60000 });
  await submit(page, "What kind of interactive UI approaches exist? Let me experience meaningful differences, and develop the work when I act.");
  await page.screenshot({ path: info.outputPath("live-working.png"), animations: "disabled" });
  await expect(page.locator(".experience-versions .ready")).toHaveCount(3, { timeout: 420000 });
  for (const model of modelIds) {
    await page.getByLabel("Model approaches").getByRole("button").filter({ hasText: model }).click();
    await expect(page.locator(".experience-frame")).toBeVisible();
    await expect(page.frameLocator(".experience-frame").locator("button").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath(`live-${model}.png`), animations: "disabled" });
  }
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export workspace" }).click();
  const path = await (await download).path(); await writeFile(info.outputPath("live-workspace.json"), await readFile(path!));
  // The concrete action is chosen after inspecting each real generated interface.
  expect(errors).toEqual([]);
});
