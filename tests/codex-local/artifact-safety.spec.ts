import { expect, test } from "@playwright/test";

test("generated visuals cannot read workspace, fetch, navigate, or execute a run", async ({ page }) => {
  const attempts: string[] = [];
  page.on("request", (request) => { if (request.url().includes("artifact-probe")) attempts.push(request.url()); });
  let completions = 0;
  const html = `<button id="test">Test isolation</button><output id="result"></output><script>
    document.querySelector('#test').onclick=async()=>{
      let parentBlocked=false, storageBlocked=false, fetchBlocked=false;
      try { parent.document.body.dataset.compromised='yes'; } catch { parentBlocked=true; }
      try { localStorage.setItem('artifact-probe','yes'); } catch { storageBlocked=true; }
      try { await fetch('/artifact-probe-fetch'); } catch { fetchBlocked=true; }
      document.querySelector('#result').textContent=JSON.stringify({parentBlocked,storageBlocked,fetchBlocked});
      parent.postMessage({type:'devneya:selection',prompt:'An untrusted suggested branch'},'*');
    };
    </script>`;
  await page.route("**/local-api/completion", async (route) => {
    completions += 1;
    await route.fulfill({ json: { content: JSON.stringify({ reply: "An isolation test.", grid: { columns: 2, cells: [{ col: 0, row: 0, span: 2, title: "Sandbox probe", text: "Test generated code isolation.", noted: false, artifact: { html, height: 260 } }] } }) } });
  });
  await page.goto("/?view=threads");
  await expect(page.getByRole("button", { name: "Prompt 1 model picker" })).toContainText("gpt-6.1-sol", { timeout: 60_000 });
  await page.getByLabel("Prompt 1 instruction").fill("Check isolation");
  await page.getByLabel("Prompt 1 instruction").press("Enter");
  const frame = page.frameLocator(".canvas-artifact iframe");
  await frame.getByRole("button", { name: "Test isolation" }).click();
  await expect(frame.locator("output")).toHaveText('{"parentBlocked":true,"storageBlocked":true,"fetchBlocked":true}');
  expect(await page.locator("body").getAttribute("data-compromised")).toBeNull();
  await expect(page.getByRole("button", { name: "Explore this selection" })).toBeVisible();
  await expect(page.locator(".instruction-textarea")).toHaveCount(0);
  expect(completions).toBe(1);
  // Probe iframe URL navigation separately; parent frame-src blocks even
  // same-origin loads, closing a gap left by sandbox + connect-src alone.
  const child = (await (await page.locator(".canvas-artifact iframe").elementHandle())!.contentFrame())!;
  const originalUrl = child.url();
  await child.evaluate(() => { location.href = "/artifact-probe-navigation"; });
  await expect.poll(() => child.url()).not.toBe(originalUrl);
  expect(attempts).toEqual([]);
  await expect(page.locator(".idea-card")).toHaveCount(1);
});
