import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("recorded live work opens separately, retains model versions, and the repaired control works at narrow widths", async ({ page }, info) => {
  page.setDefaultTimeout(20000);
  const ids = ["gpt-6.1-sol", "gpt-6-luna", "gpt-5.5"];
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: { object: "list", data: ids.map((id) => ({ id, object: "model", created: 0, owned_by: "devneya" })) } }));
  let calls = 0; await page.route("**/local-api/completion", (route) => { calls++; return route.abort(); });
  await page.goto("/"); await expect(page.getByLabel("Collaborators model picker")).toContainText("gpt-5.5");
  await page.getByRole("link", { name: "Try a recorded live run" }).click();
  await expect(page.locator(".flow-title")).toHaveText("Recorded example · working interfaces");
  await expect(page.locator(".experience-versions .ready")).toHaveCount(3);
  await expect(page.locator(".experience-overline")).toContainText("RECORDED CODEX RUN");
  await page.getByRole("button", { name: "Pause model", exact: true }).click();
  await page.getByLabel("Model approaches").getByRole("button").filter({ hasText: "gpt-5.5" }).click();
  const frame = page.frameLocator(".experience-frame");
  for (const width of [1440, 1260, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await frame.getByRole("button", { name: "Suggest tidy layout" }).click();
    await expect(frame.locator("body")).not.toHaveText("");
    await page.screenshot({ path: info.outputPath(`repaired-control-${width}.png`), animations: "disabled" });
  }
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".experience-versions .ready")).toHaveCount(3);
  await expect(frame.getByRole("button", { name: "Suggest tidy layout" })).toBeVisible();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export workspace" }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(saved.workspace.flows).toHaveLength(2);
  expect(saved.workspace.flows[0].experience).toBeUndefined();
  await expect(page.getByRole("alert")).toHaveCount(0); expect(calls).toBe(0);
});
