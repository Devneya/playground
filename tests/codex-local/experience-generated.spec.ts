import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const capture = new URL("../fixtures/experience-approaches.json", import.meta.url);
const modelIds = ["gpt-6.1-sol", "gpt-6-luna", "gpt-5.5"];

test("real generated interfaces render and operate, with an optional live next move", async ({ page }, info) => {
  page.setDefaultTimeout(20000); await page.setViewportSize({ width: 1920, height: 1200 });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  if (!process.env.EXPERIENCE_NEXT_LIVE) await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: { object: "list", data: modelIds.map((id) => ({ id, object: "model", created: 0, owned_by: "devneya" })) } }));
  let calls = 0;
  await page.route("**/local-api/completion", async (route) => {
    calls++;
    const input = JSON.parse(route.request().postDataJSON().messages[0].content);
    expect(route.request().postDataJSON().model).toBe("gpt-6.1-sol");
    expect(input.current.state.color).toMatchObject({ ink: 96, paper: 24 });
    if (process.env.EXPERIENCE_NEXT_LIVE) return route.continue();
    return route.abort();
  });
  await page.goto("/"); await expect(page.getByLabel("Collaborators model picker")).toContainText("gpt-5.5", { timeout: 60000 });
  await page.getByLabel("Workspace JSON file").setInputFiles(capture.pathname);
  const exported = JSON.parse(await readFile(capture, "utf8"));
  const revisions = exported.workspace.flows[0].experience.revisions as { model: string; title: string }[];
  for (const model of modelIds) {
    const revision = revisions.find((r) => r.model === model)!;
    await page.getByRole("button", { name: new RegExp(`Open version \\d+: ${revision.title}`) }).click();
    const frame = page.frameLocator(".experience-frame");
    await expect(frame.locator("button").first()).toBeVisible();
    await expect(frame.locator("body")).not.toHaveText("");
    await page.screenshot({ path: info.outputPath(`actual-${model}.png`), animations: "disabled" });
    await writeFile(info.outputPath(`actual-${model}.txt`), await frame.locator("body").innerText());
  }
  await page.getByRole("button", { name: /Open version \d+: Four ways to work/ }).click();
  const frame = page.frameLocator(".experience-frame");
  await frame.getByRole("button", { name: /Tune & observe/ }).click();
  expect(calls).toBe(0); // The following action coalesces with any pending view change.
  if (!process.env.EXPERIENCE_NEXT_LIVE) await page.getByRole("button", { name: "Pause model", exact: true }).click();
  await frame.getByRole("button", { name: "Flip ink & paper lightness" }).click();
  await expect(page.getByLabel("Workspace history", { exact: true })).toContainText("Flipped ink and paper lightness");
  await page.screenshot({ path: info.outputPath("actual-human-action.png"), animations: "disabled" });
  if (process.env.EXPERIENCE_NEXT_LIVE) {
    await expect(page.getByLabel("Workspace history", { exact: true }).locator("li.model")).toHaveCount(4, { timeout: 540000 });
    await expect(frame.locator("button").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("actual-model-next.png"), animations: "disabled" });
    expect(calls).toBe(1);
  } else expect(calls).toBe(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(frame.locator("button").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("actual-1440.png"), animations: "disabled" });
  await expect(page.getByRole("alert")).toHaveCount(0);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export workspace" }).click();
  const path = await (await download).path(); await writeFile(info.outputPath("worked-workspace.json"), await readFile(path!));
  expect(errors).toEqual([]);
});

test("generated controls from the other models save actual changes while paused", async ({ page }, info) => {
  page.setDefaultTimeout(20000); await page.setViewportSize({ width: 1920, height: 1200 });
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: { object: "list", data: modelIds.map((id) => ({ id, object: "model", created: 0, owned_by: "devneya" })) } }));
  let calls = 0; await page.route("**/local-api/completion", (route) => { calls++; return route.abort(); });
  await page.goto("/"); await expect(page.getByLabel("Collaborators model picker")).toContainText("gpt-5.5");
  await page.getByLabel("Workspace JSON file").setInputFiles(capture.pathname);
  await page.getByRole("button", { name: "Pause model", exact: true }).click();
  await page.getByRole("button", { name: /Open version \d+: Interaction, felt not described/ }).click();
  const frame = page.frameLocator(".experience-frame");
  await frame.getByRole("button", { name: /Arrival buffer/ }).click();
  await expect(frame.getByText("85 minutes · 6 blocks", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Open version \d+: Interactive UI approach lab/ }).click();
  await frame.getByRole("button", { name: "Suggest tidy layout" }).click();
  await expect(page.getByLabel("Workspace history", { exact: true }).locator("li")).toHaveCount(6);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export workspace" }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const changes = saved.workspace.flows[0].experience.revisions.slice(-2);
  expect(changes[0].state.agenda).toHaveLength(6);
  const initial = JSON.parse(await readFile(capture, "utf8")).workspace.flows[0].experience.revisions.find((r: {model:string}) => r.model === "gpt-5.5");
  expect(changes[1].state.direct.items).not.toEqual(initial.state.direct.items);
  await page.screenshot({ path: info.outputPath("other-model-controls.png"), animations: "disabled" });
  await expect(page.getByRole("alert")).toHaveCount(0); expect(calls).toBe(0);
});
