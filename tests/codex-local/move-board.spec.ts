import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => { page.setDefaultTimeout(20000); });

const piece = (id: string, label: string) => ({ id, label, detail: `A concrete example for ${label}. This proposal can be challenged or combined with another direction.`, kind: "idea", basis: "proposal" });
const direction = (id: string, title: string, labels: string[]) => ({ id, title, premise: `Develop ${title.toLowerCase()} through meaningful human and model moves.`, pieces: labels.map((label, i) => piece(`${id}_${i}`, label)), tradeoff: "Requires making assumptions explicit before committing.", test: "Try one real question and inspect what changes after your move." });
const routes = [direction("a", "A shared visual position", ["Select a tension", "Model develops alternatives", "Keep the useful parts"]), direction("b", "A world of possibilities", ["Set a constraint", "Explore its consequences", "Revise an assumption"]), direction("c", "An evolving construction", ["Place a fragment", "Model builds around it", "Combine different versions"])];
const moves = routes.map((route, i) => ({ label: `Open direction ${String.fromCharCode(65 + i)}`, reason: "Offers a distinct way to cooperate with the model.", title: "Three ways to think together", question: "Which parts should survive the next move?", routes: [route], remove: [] }));
const wire = (content: object[]) => [{ type: "status", text: "Request sent to Codex" }, ...content.map((move) => ({ type: "delta", text: JSON.stringify(move) + "\n" })), { type: "done", serviceTier: "default" }].map((e) => JSON.stringify(e)).join("\n") + "\n";

test("select, keep, combine, revisit and branch a visual position", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: { object: "list", data: [{ id: "gpt-6.1-sol", object: "model", created: 0, owned_by: "devneya" }] } }));
  let count = 0;
  await page.route("**/local-api/completion", async (route) => {
    count++;
    const input = JSON.parse(route.request().postDataJSON().messages[0].content);
    if (count === 1) return route.fulfill({ contentType: "application/x-ndjson", body: wire(moves) });
    if (count === 2) {
      expect(input.selectedPieces).toEqual(["a_0"]);
      expect(input.position.marks).toEqual({ a_0: "keep" });
      return route.fulfill({ contentType: "application/x-ndjson", body: wire([{ ...moves[0], label: "Develop a consequence of the kept idea", routes: [{ ...routes[1], pieces: [{ ...routes[1]!.pieces[0], label: "A constraint that preserves the tension" }, ...routes[1]!.pieces.slice(1)] }] }]) });
    }
    if (count === 3) {
      expect(input.selectedPieces).toEqual(["a_1", "c_0"]);
      expect(input.position.marks).toEqual({ a_0: "keep" });
      return route.fulfill({ contentType: "application/x-ndjson", body: wire([{ ...moves[0], label: "Combine selected fragments", routes: [direction("d", "A construction with alternatives", ["Build from the selected fragment", "Develop competing continuations"]) ] }]) });
    }
    expect(input.position.routes.map((r: {id:string}) => r.id)).toEqual(["a"]);
    return route.fulfill({ contentType: "application/x-ndjson", body: wire([{ ...moves[0], label: "Develop the earlier possibility", routes: [{ ...routes[0], title: "A different continuation" }] }]) });
  });
  await page.goto("/?view=board");
  await expect(page.getByLabel("Board model picker")).toContainText("gpt-6.1-sol");
  await page.screenshot({ animations: "disabled", path: info.outputPath("opening.png") });
  await page.getByLabel("Your move", { exact: true }).fill("A visual way for humans and models to think together");
  await page.getByRole("button", { name: "Your move ↗", exact: true }).click();
  await expect(page.locator(".move-route")).toHaveCount(3);
  await expect(page.getByLabel("Move history", { exact: true })).toContainText("A visual way for humans and models to think together");
  await expect(page.getByLabel("Move history", { exact: true }).locator("li")).toHaveCount(4);
  await page.screenshot({ animations: "disabled", path: info.outputPath("three-directions.png") });
  await page.getByRole("button", { name: "Read Select a tension", exact: true }).click();
  await expect(page.getByRole("region", { name: "Details: Select a tension", exact: true })).toContainText("A concrete example");
  expect(count).toBe(1);
  await page.getByRole("button", { name: "Select all pieces", exact: true }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(9);
  await expect(page.getByLabel("Your selected pieces")).toContainText("Selection alone changes nothing");
  expect(count).toBe(1);
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await page.getByLabel("Select Select a tension", { exact: true }).check();
  await page.getByRole("button", { name: "✓ Keep", exact: true }).click();
  await expect(page.getByText("✓ Kept by you", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Read A constraint that preserves the tension", exact: true })).toBeVisible();
  await expect(page.locator(".move-change-report")).toContainText("1 updated");
  await page.getByLabel("Select Model develops alternatives").check();
  await page.getByLabel("Select Place a fragment").click();
  await page.screenshot({ animations: "disabled", path: info.outputPath("select-across-directions.png") });
  await page.getByRole("button", { name: "Combine ↗", exact: true }).click();
  await expect(page.locator(".move-route")).toHaveCount(4);
  await expect(page.getByText("✓ Kept by you", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View move 2: Open direction A", exact: true }).click();
  await expect(page.locator(".move-route")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Your move ↗", exact: true })).toBeDisabled();
  await page.screenshot({ animations: "disabled", path: info.outputPath("history-preview.png") });
  await page.getByRole("button", { name: "Continue from here ↗", exact: true }).click();
  await page.getByLabel("Your move", { exact: true }).fill("Develop this earlier direction differently");
  await page.getByRole("button", { name: "Your move ↗", exact: true }).click();
  await expect(page.getByText("A different continuation", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Move history", { exact: true })).toContainText("Combine selected fragments");
  await expect(page.getByLabel("Move history", { exact: true })).toContainText("from 2");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("A different continuation", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View move 8: Combine selected fragments", exact: true }).click();
  await expect(page.locator(".move-route")).toHaveCount(4);
  await page.getByRole("button", { name: "Back to present", exact: true }).click();
  await expect(page.locator(".move-route")).toHaveCount(1);
  await page.screenshot({ animations: "disabled", path: info.outputPath("branched-position.png") });
  expect(count).toBe(4); expect(errors).toEqual([]);
});

test("stopping a pending move keeps the next draft and never applies late output", async ({ page }, info) => {
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: { object: "list", data: [{ id: "gpt-6.1-sol", object: "model", created: 0, owned_by: "devneya" }] } }));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/local-api/completion", async (route) => { await pending; await route.fulfill({ contentType: "application/x-ndjson", body: wire(moves) }).catch(() => {}); });
  await page.goto("/?view=board");
  await expect(page.getByLabel("Board model picker")).toContainText("gpt-6.1-sol");
  await page.getByLabel("Your move", { exact: true }).fill("What should we explore?");
  await page.getByRole("button", { name: "Your move ↗", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Think by/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What should we explore?", exact: true })).toBeVisible();
  await page.getByLabel("Your move", { exact: true }).fill("My next thought stays here");
  await page.screenshot({ animations: "disabled", path: info.outputPath("while-waiting.png") });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  release();
  await expect(page.getByRole("alert")).toContainText("Stopped");
  await expect(page.getByLabel("Your move", { exact: true })).toHaveValue("My next thought stays here");
  await expect(page.locator(".move-route")).toHaveCount(0);
});

test("steps run downward, topics form groups, and a no-change response is explicit", async ({ page }, info) => {
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: { object: "list", data: [{ id: "gpt-6.1-sol", object: "model", created: 0, owned_by: "devneya" }] } }));
  let calls = 0;
  await page.route("**/local-api/completion", async (route) => {
    calls++;
    const response = calls === 1 ? [{ ...moves[0], layout: "sequence" }] : calls === 2 ? [{ ...moves[0], layout: "map", routes }] : [{ label: "The available information does not resolve this", reason: "Nothing changed: resolving this assumption needs the actual constraint.", routes: [], remove: [] }];
    return route.fulfill({ contentType: "application/x-ndjson", body: wire(response) });
  });
  await page.goto("/?view=board");
  await expect(page.getByLabel("Board model picker")).toContainText("gpt-6.1-sol");
  await page.getByLabel("Your move", { exact: true }).fill("A step-by-step process");
  await page.getByRole("button", { name: "Your move ↗", exact: true }).click();
  await expect(page.locator(".layout-sequence")).toBeVisible();
  const steps = await page.locator(".move-piece").all();
  const first = (await steps[0]!.boundingBox())!, second = (await steps[1]!.boundingBox())!;
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  expect(second.x).toBe(first.x);
  await page.getByRole("button", { name: "Read Select a tension", exact: true }).click();
  await page.screenshot({ animations: "disabled", path: info.outputPath("vertical-steps.png") });
  await page.getByLabel("Your move", { exact: true }).fill("Map the topics instead");
  await page.getByRole("button", { name: "Your move ↗", exact: true }).click();
  await expect(page.locator(".layout-map")).toBeVisible();
  const groups = await page.locator(".move-route").all();
  const groupA = (await groups[0]!.boundingBox())!, groupB = (await groups[1]!.boundingBox())!, groupC = (await groups[2]!.boundingBox())!;
  expect(groupB.y).toBe(groupA.y);
  expect(groupC.y).toBeGreaterThan(groupA.y);
  await page.screenshot({ animations: "disabled", path: info.outputPath("topic-groups.png") });
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Question selected pieces", exact: true }).click();
  await expect(page.locator(".move-change-report > summary")).toContainText("No board changes");
  await page.locator(".move-change-report > summary").click();
  await expect(page.locator(".move-change-content")).toContainText("Nothing changed");
  await expect(page.getByRole("button", { name: /take the lead|Respond to my move/ })).toHaveCount(0);
  expect(calls).toBe(3);
  await page.screenshot({ animations: "disabled", path: info.outputPath("explicit-no-change.png") });
});

test("keeping a mixed selection keeps every selected piece; release is an explicit action", async ({ page }) => {
  await page.route("**/local-api/llm/v1/models", (route) => route.fulfill({ json: { object: "list", data: [{ id: "gpt-6.1-sol", object: "model", created: 0, owned_by: "devneya" }] } }));
  const marks: unknown[] = [];
  await page.route("**/local-api/completion", (route) => {
    marks.push(JSON.parse(route.request().postDataJSON().messages[0].content).position.marks);
    return route.fulfill({ contentType: "application/x-ndjson", body: wire([{ label: "Keep the present work", reason: "No substantive change is needed for this selection.", routes: [], remove: [] }]) });
  });
  await page.goto("/?example=1");
  await expect(page.getByLabel("Board model picker")).toContainText("gpt-6.1-sol");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "✓ Keep", exact: true }).click();
  await expect(page.locator(".move-change-report > summary")).toContainText("No board changes");
  await page.getByRole("button", { name: "Select all pieces", exact: true }).click();
  const total = await page.getByRole("checkbox").count();
  await page.getByRole("button", { name: "✓ Keep", exact: true }).click();
  await expect(page.getByText("✓ Kept by you", { exact: true })).toHaveCount(total);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Select all pieces", exact: true }).click();
  await page.getByRole("button", { name: "✓ Release", exact: true }).click();
  await expect(page.getByText("✓ Kept by you", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  expect(marks).toHaveLength(3);
  expect(Object.values(marks[1] as object)).toEqual(Array(total).fill("keep"));
  expect(marks[2]).toEqual({});
});

test("live Codex produces alternatives and responds to a visual move", async ({ page }, info) => {
  test.skip(!process.env.BOARD_LIVE && !process.env.BOARD_LIVE_FOLLOWUP, "Explicit live-model verification");
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.BOARD_LIVE_FOLLOWUP ? "/?example=1" : "/?view=board");
  await expect(page.getByLabel("Board model picker")).toContainText("gpt-6.1-sol", { timeout: 120000 });
  if (!process.env.BOARD_LIVE_FOLLOWUP) {
  await page.getByLabel("Your move", { exact: true }).fill(process.env.BOARD_PROMPT ?? "I want a truly visual interface for people and LLMs to think together. Like a tweaked chess game: I make a move, the model makes one or several moves, perhaps revisiting something earlier while I type. Compare three concrete interaction designs. No chat, no answer cards, no kids' toys.");

  await page.getByRole("button", { name: "Your move ↗", exact: true }).click();
  await expect(page.locator(".move-route").first()).toBeVisible({ timeout: 600000 });
  await page.screenshot({ animations: "disabled", path: info.outputPath("first-live-move.png") });
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0, { timeout: 600000 });
  await expect(page.locator(".move-error")).toHaveCount(0);
  }
  const saveBoard = async (name: string) => {
    await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export workspace", exact: true }).click();
    const file = await pending; const path = info.outputPath(name + ".json"); await file.saveAs(path);
    const document = JSON.parse(await readFile(path, "utf8"));
    const board = document.workspace.flows.find((f: {id: string}) => f.id === document.workspace.activeFlowId).board;
    await writeFile(info.outputPath(name + "-board.json"), JSON.stringify(board, null, 2));
  };
  await expect(page.locator(".move-route").first()).toBeVisible();
  if (process.env.BOARD_LIVE_LAYOUT) await expect(page.locator(`.layout-${process.env.BOARD_LIVE_LAYOUT}`)).toBeVisible();
  await saveBoard("live-opening");
  await page.screenshot({ animations: "disabled", path: info.outputPath("live-position.png") });
  await page.locator(".move-route").first().getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Question selected pieces", exact: true }).click();

  await page.getByLabel("Your move", { exact: true }).fill("I can keep thinking while you move.");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0, { timeout: 600000 });
  await expect(page.locator(".move-error")).toHaveCount(0);
  await saveBoard("live-continuation");
  await expect(page.getByLabel("Your move", { exact: true })).toHaveValue("I can keep thinking while you move.");
  await expect(page.locator(".move-change-report")).not.toContainText("No board changes");
  await page.locator(".move-change-report > summary").click();
  await page.screenshot({ animations: "disabled", path: info.outputPath("live-next-position.png") });
  expect(errors).toEqual([]);
});
