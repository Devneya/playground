import { expect, test } from "@playwright/test";

test("opens the recorded example separately and continues with human marks", async ({ page }, info) => {
  page.setDefaultTimeout(20000);
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: { object: "list", data: [{ id: "gpt-6.1-sol", object: "model", created: 0, owned_by: "devneya" }] } }));
  let calls = 0;
  await page.route("**/local-api/completion", async (route) => {
    calls++;
    const input = JSON.parse(route.request().postDataJSON().messages[0].content);
    expect(input.objective).toContain("chess");
    expect(Object.values(input.position.marks)).toEqual(["keep"]);
    await route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "delta", text: JSON.stringify({ label: "Develop the kept direction", reason: "Preserve the selected idea while reframing the comparison.", title: "A revised shared position", routes: [], remove: [] }) + "\n" },
      { type: "done", serviceTier: "default" },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n" });
  });
  await page.goto("/?example=1");
  await expect(page.locator(".move-route")).toHaveCount(3);
  await expect(page.getByText("Started from a recorded model example.", { exact: false })).toBeVisible();
  await expect(page.locator(".flow-title")).toContainText("Example · visual moves");
  await expect(page).toHaveURL(/\/$/);
  expect(calls).toBe(0);
  await page.screenshot({ animations: "disabled", path: info.outputPath("example-desktop.png") });
  await page.getByRole("button", { name: "Flows", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Flows", exact: true })).toContainText("Default flow");
  await expect(page.getByRole("dialog", { name: "Flows", exact: true })).toContainText("Example · visual moves");
  await page.getByRole("button", { name: "Close flows", exact: true }).click();
  await page.locator(".piece-read").first().click();
  await expect(page.locator(".piece-detail")).toBeVisible();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "✓ Keep", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A revised shared position", exact: true })).toBeVisible();
  await expect(page.getByText("✓ Kept by you", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ animations: "disabled", path: info.outputPath("example-laptop.png") });
  await page.getByLabel("Board model picker").click();
  const bounds = await page.getByRole("dialog", { name: "Board models" }).boundingBox();
  expect(bounds!.y).toBeGreaterThan(0); expect(bounds!.y + bounds!.height).toBeLessThan(1000);
});
