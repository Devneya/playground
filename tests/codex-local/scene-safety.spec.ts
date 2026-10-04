import { expect, test } from "@playwright/test";

test("scene code can save its own state but cannot read the app, make requests or run the model", async ({ page }) => {
  let calls = 0;
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("scene-probe")) requests.push(request.url()); });
  const html = `<button id="probe">Test isolation</button><button id="step">Increase</button><output id="state"></output><output id="result"></output><script>
  let s={count:0,...workshop.state};const draw=()=>document.querySelector('#state').textContent=String(s.count);draw();workshop.onRestore(next=>{s=next;draw()});
  document.querySelector('#step').onclick=()=>{s={count:s.count+1};draw();workshop.save(s)};
  document.querySelector('#probe').onclick=async()=>{let parentBlocked=false,storageBlocked=false,fetchBlocked=false;
  try{parent.document.body.dataset.compromised='yes'}catch{parentBlocked=true}
  try{localStorage.setItem('scene-probe','yes')}catch{storageBlocked=true}
  try{await fetch('/scene-probe-fetch')}catch{fetchBlocked=true}
  parent.postMessage({type:'devneya:request',prompt:'Run another model call'},'*');
  workshop.save({nested:{operations:[{op:'remove',id:'keep'}]}});
  document.querySelector('#result').textContent=JSON.stringify({parentBlocked,storageBlocked,fetchBlocked});};</script>`;
  await page.route("**/local-api/completion", (route) => {
    calls++;
    return route.fulfill({ json: { content: JSON.stringify({ summary: "Isolation test", operations: [{ op: "create", object: { id: "probe", kind: "scene", title: "Isolation probe", html, state: { count: 0 }, interaction: "Test isolation", x: 20, y: 20, width: 800, height: 300, color: "ink" } }], actions: [] }) } });
  });
  await page.goto("/?view=surface");
  await page.getByLabel("Work together", { exact: true }).fill("Check the interaction boundary");
  await page.getByRole("button", { name: "Make a move" }).click();
  const frame = page.frameLocator('iframe[title="Isolation probe"]');
  await frame.getByRole("button", { name: "Test isolation" }).click();
  await expect(frame.locator("#result")).toHaveText('{"parentBlocked":true,"storageBlocked":true,"fetchBlocked":true}');
  expect(await page.locator("body").getAttribute("data-compromised")).toBeNull();
  await frame.getByRole("button", { name: "Increase" }).click();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(frame.locator("#state")).toHaveText("1");
  expect(calls).toBe(1);
  expect(requests).toEqual([]);
});
