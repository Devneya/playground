import { expect, test } from "@playwright/test";

test("independent scenes sit side by side and keep state when entering full screen", async ({ page }, info) => {
  await page.route("**/local-api/completion", (route) => route.fulfill({ json: { content: JSON.stringify({
    reply: "Two different ways to explore one question.",
    grid: { columns: 2, cells: [0, 1].map((row) => ({ col: 0, row, span: 2, title: `Instrument ${row + 1}`, text: `Accessible context for instrument ${row + 1}.`, noted: false, artifact: { height: 260, html: `<style>body{padding:24px;background:${row ? '#233638' : '#f0e0be'};color:${row ? '#fff' : '#223'};min-height:${row ? 400 : 620}px}button{padding:20px}</style><h1>Instrument ${row + 1}</h1><button id="step">Explore 0</button><script>let n=0;document.querySelector('#step').onclick=e=>{e.target.textContent='Explore '+(++n);parent.postMessage({type:'devneya:selection',prompt:'Continue instrument ${row + 1} after '+n+' steps'},'*')}</script>` } })) },
  }) } }));
  await page.goto("/?view=threads");
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("gpt-6.1-sol", { timeout: 60_000 });
  await page.getByLabel("Prompt 1 instruction").fill("Test independent instruments");
  await page.getByLabel("Prompt 1 instruction").press("Enter");
  const cards = page.locator(".visual-card");
  await expect(cards).toHaveCount(2);
  await expect(page.locator("iframe").first()).toHaveCSS("height", "620px");
  await expect(cards.first()).toBeInViewport({ ratio: .98 });
  const a = await cards.nth(0).boundingBox(); const b = await cards.nth(1).boundingBox();
  expect(b!.x).toBeGreaterThan(a!.x + a!.width);
  await page.screenshot({ path: info.outputPath("multiple-scenes.png"), fullPage: true });
  await cards.first().getByRole("button", { name: "Enter experience" }).click();
  const frame = page.frameLocator(".canvas-artifact iframe").first();
  await frame.getByRole("button", { name: "Explore 0" }).click();
  await expect(frame.getByRole("button", { name: "Explore 1" })).toBeVisible();
  await page.getByRole("button", { name: "Return to canvas" }).click();
  await expect(frame.getByRole("button", { name: "Explore 1" })).toBeVisible();
  await cards.first().getByRole("button", { name: "Explore this selection" }).click();
  await expect(page.locator(".instruction-textarea")).toHaveValue("Continue instrument 1 after 1 steps");
  await expect(page.frameLocator(".canvas-artifact iframe").nth(1).getByRole("button", { name: "Explore 0" })).toBeAttached();
});
