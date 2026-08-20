import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pageErrors = new WeakMap<Page, string[]>();
const networkFailures = new WeakMap<Page, string[]>();

const assertAccessible = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
};

test.describe("Playground browser shell", () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    const failures: string[] = [];
    pageErrors.set(page, errors);
    networkFailures.set(page, failures);
    page.on("pageerror", (error) => {
      if (/^ResizeObserver loop completed with undelivered notifications\.?$/.test(error.message)) return;
      errors.push(`pageerror: ${error.message}`);
    });
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      failures.push(`${request.method()} ${url.origin}${url.pathname}: ${request.failure()?.errorText ?? "request failed"}`);
    });
    await page.goto("/");
    await expect(page).toHaveTitle("Devneya Playground");
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = pageErrors.get(page) ?? [];
    const failures = networkFailures.get(page) ?? [];
    await page.screenshot({ path: testInfo.outputPath("shell.png"), fullPage: true });
    const evidenceDir = process.env.EVIDENCE_DIR;
    const safeName = testInfo.titlePath.join("-").replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    let screenshotPath: string | null = null;
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true });
      screenshotPath = join(evidenceDir, `${testInfo.project.name}-${safeName}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      mkdirSync(join(evidenceDir, "observations"), { recursive: true });
      writeFileSync(join(evidenceDir, "observations", `${testInfo.project.name}-${safeName}.json`), `${JSON.stringify({ test: testInfo.titlePath, status: testInfo.status, screenshot: screenshotPath, browserErrors: errors, networkFailures: failures, visualReview: "pending" }, null, 2)}\n`);
    }
    expect(errors, `Unexpected browser errors: ${errors.join(" | ")}`).toEqual([]);
    expect(failures, `Network failures: ${failures.join(" | ")}`).toEqual([]);
  });

  test("shows the product heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /build and compare model workflows/i })).toBeVisible();
  });

  test("shows email and password fields", async ({ page }) => {
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("has no serious or critical sign-in accessibility violations", async ({ page }) => {
    await assertAccessible(page);
  });

  test("has no serious or critical recovery accessibility violations", async ({ page }) => {
    await page.getByRole("button", { name: /forgot password/i }).click();
    await assertAccessible(page);
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

  test("shows the signup confirmation state", async ({ page }) => {
    await page.getByRole("button", { name: /create an account/i }).click();
    await page.getByLabel("Email").fill("new-user@example.test");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByRole("status")).toContainText("Check your email to confirm your account.");
  });

  test("shows the recovery request state", async ({ page }) => {
    await page.getByRole("button", { name: /forgot password/i }).click();
    await page.getByLabel("Email").fill("person@example.test");
    await page.getByRole("button", { name: /send recovery link/i }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");
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
