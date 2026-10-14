import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { evaluateFormula, type Surface } from "../../src/domain/surface";

test("live controls recalculate without requests, persist, and protect concurrent human edits", async ({ page }, info) => {
  let requests = 0;
  let resolvePatch!: () => void;
  let controlledId = "";
  let changedValue = 0;
  await page.route("**/local-api/completion", async (route) => {
    requests++;
    if (requests === 1) {
      if (!process.env.SURFACE_LIVE_CONTROLS) return route.fulfill({ json: JSON.parse(await readFile(process.env.SURFACE_CONTROLS_RESPONSE ?? new URL("../fixtures/surface-controls.json", import.meta.url), "utf8")) });
      return route.continue();
    }
    await new Promise<void>((resolve) => { resolvePatch = resolve; });
    return route.fulfill({ json: { content: JSON.stringify({ summary: "Late conflicting edit", operations: [{ op: "edit", id: controlledId, changes: { value: changedValue } }], actions: [] }) } });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?view=surface");
  const response = page.waitForResponse((r) => r.url().endsWith("/local-api/completion"), { timeout: 610000 });
  await page.getByRole("button", { name: "Rebalance an evening" }).click();
  const result = await response;
  expect(result.ok()).toBe(true);
  await writeFile(info.outputPath("controls-response.json"), JSON.stringify(await result.json()));
  await expect(page.locator(".work-control").first()).toBeVisible();
  const exportSurface = async (): Promise<Surface> => {
    await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export workspace" }).click();
    const download = await pending;
    const path = info.outputPath("controls-workspace.json");
    await download.saveAs(path);
    const { workspace } = JSON.parse(await readFile(path, "utf8"));
    return workspace.flows.find((flow: {id: string}) => flow.id === workspace.activeFlowId).surface;
  };
  const before = await exportSurface();
  const control = before.objects.find((object) => object.kind === "control")!;
  controlledId = control.id;
  const slider = page.getByRole("slider", { name: control.title, exact: true });
  const key = control.value! < control.max! ? "ArrowRight" : "ArrowLeft";
  await slider.focus();
  await slider.press(key);
  await slider.press(key);
  const value = Number(await slider.inputValue());
  expect(value).not.toBe(control.value);
  const after = await exportSurface();
  expect(after.objects.find((object) => object.id === controlledId)?.value).toBe(value);
  const metrics = after.objects.filter((object) => object.kind === "metric");
  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    const expected = evaluateFormula(metric.formula!, after);
    await expect(page.getByLabel(`${metric.title} value`, { exact: true })).toContainText(expected === null ? "Unavailable" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(expected));
  }
  await page.screenshot({ path: info.outputPath("working-controls.png"), fullPage: true });
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(slider).toHaveValue(String(control.value));
  await page.getByRole("button", { name: "Redo last change" }).click();
  await expect(slider).toHaveValue(String(value));
  await page.reload();
  await expect(slider).toHaveValue(String(value));
  changedValue = control.min!;
  await page.getByRole("button", { name: "Change the work", exact: true }).click();
  await page.getByLabel("Work together", { exact: true }).fill("Try revising this allocation");
  await page.getByRole("button", { name: "Make a move" }).click();
  await expect.poll(() => requests).toBe(2);
  await slider.press(value < control.max! ? "ArrowRight" : "ArrowLeft");
  const humanValue = await slider.inputValue();
  expect(humanValue).not.toBe(String(changedValue));
  resolvePatch();
  await expect(page.locator(".work-error")).toContainText("Your work has been kept");
  await expect(slider).toHaveValue(humanValue);
  expect(errors).toEqual([]);
});
