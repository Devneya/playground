import { expect, test } from "@playwright/test";

test.describe("Playground browser shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Devneya Playground");
  });

  test.afterEach(async ({ page }, testInfo) => {
    await page.screenshot({ path: testInfo.outputPath("shell.png"), fullPage: true });
  });

  test("shows the product heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /build and compare model workflows/i })).toBeVisible();
  });

  test("shows email and password fields", async ({ page }) => {
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("shows Google OAuth", async ({ page }) => {
    await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
  });

  test("shows GitHub OAuth", async ({ page }) => {
    await expect(page.getByRole("button", { name: /continue with github/i })).toBeVisible();
  });

  test("switches to account creation", async ({ page }) => {
    await page.getByRole("button", { name: /create an account/i }).click();
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
  });

  test("switches to recovery", async ({ page }) => {
    await page.getByRole("button", { name: /forgot password/i }).click();
    await expect(page.getByRole("button", { name: /send recovery link/i })).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);
  });

  test("requires an email", async ({ page }) => {
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByLabel("Email")).toHaveAttribute("required", "");
  });

  test("requires a minimum password length", async ({ page }) => {
    await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "8");
  });

  test("has a recovery return path", async ({ page }) => {
    await page.getByRole("button", { name: /forgot password/i }).click();
    await page.getByRole("button", { name: /back to sign in/i }).click();
    await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
  });

  test("renders a mobile-friendly auth card", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".auth-card")).toBeVisible();
  });

  test("does not expose a legacy template heading", async ({ page }) => {
    await expect(page.getByText("Devneya Space")).toHaveCount(0);
  });

  test("keeps the auth card within the viewport", async ({ page }) => {
    const box = await page.locator(".auth-card").boundingBox();
    expect(box?.width).toBeLessThanOrEqual(440);
  });
});
