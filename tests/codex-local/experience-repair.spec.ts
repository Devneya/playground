import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("live model repairs an observed narrow-viewport layout defect", async ({ page }, info) => {
  test.skip(process.env.EXPERIENCE_REPAIR_LIVE !== "1", "Explicit live repair only");
  page.setDefaultTimeout(20000);
  await page.goto("/"); await expect(page.getByLabel("Collaborators model picker")).toContainText("gpt-5.5", { timeout: 60000 });
  await page.getByLabel("Workspace JSON file").setInputFiles(new URL("../fixtures/experience-approaches.json", import.meta.url).pathname);
  await page.getByRole("button", { name: /Open version \d+: Interactive UI approach lab/ }).click();
  await page.getByLabel("Direct the work").fill("Your interface overlaps at a working viewport of 1080 by 620: the Your trail panel covers Room tools and prevents clicking Suggest tidy layout. Repair the responsive layout so all content and controls remain usable at 900px, 1080px and 1500px widths, without scaling text smaller. Make columns reflow and avoid fixed minimum widths inside the instrument. Keep the useful work; you may change the visual form as needed. Return compact code.");
  await page.getByLabel("Direct the work").press("Enter");
  await expect(page.getByLabel("Workspace history", { exact: true }).locator("li.model")).toHaveCount(4, { timeout: 540000 });
  const frame = page.frameLocator(".experience-frame"); await expect(frame.locator("button").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("repaired-1440.png"), animations: "disabled" });
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export workspace" }).click();
  const path = await (await download).path(); await writeFile(info.outputPath("repaired-workspace.json"), await readFile(path!));
  await writeFile(info.outputPath("repaired-text.txt"), await frame.locator("body").innerText());
  await expect(page.getByRole("alert")).toHaveCount(0);
});
