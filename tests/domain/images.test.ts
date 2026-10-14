import { beforeEach, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { extractDrawings, isSafeSvg } from "../../src/domain/images";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { reduceWorkspace } from "../../src/domain/workspaceReducer";
import { getInputSnapshots } from "../../src/domain/graph";
import { startGenerationRun } from "../../src/features/execution/executeGeneration";
import { IndexedDbWorkspaceRepository } from "../../src/persistence/IndexedDbWorkspaceRepository";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300"><title>Elephant</title><g fill="#aaa"><ellipse cx="220" cy="160" rx="130" ry="80"/><path d="M 330 170 Q 400 170 390 260" fill="none" stroke="#aaa" stroke-width="30"/></g></svg>';
const context = { idFactory: () => crypto.randomUUID(), clock: { now: () => new Date("2026-10-04T12:00:00Z") } };
beforeEach(async () => new IndexedDbWorkspaceRepository().clearAllBrowserData());
it("extracts complete vector drawings and keeps ordinary Markdown and invalid SVG as text", () => {
  const result = extractDrawings(`An elephant.\n\n\`\`\`svg\n${svg}\n\`\`\``);
  expect(result.text).toBe("An elephant.");
  expect(result.images?.[0]).toEqual({ name: "Elephant", mimeType: "image/svg+xml", source: svg });
  expect(extractDrawings(`\`\`\`svg\n<script>bad</script>\n\`\`\``).images).toBeUndefined();
  expect(extractDrawings("**Hello**")).toEqual({ text: "**Hello**" });
});
it.each([
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/a.png"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.test/a)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:red"/></svg>',
  '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><text>&#x41;</text></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" width="500"></svg>',
])("rejects active, remote or malformed drawing content", source => expect(isSafeSvg(source)).toBe(false));
it("accepts gradients, clipping and escaped labels, and bounds drawings", () => {
  expect(isSafeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="shade"><stop offset="0%" stop-color="#fff"/></linearGradient><clipPath id="round"><circle cx="50" cy="50" r="40"/></clipPath></defs><rect fill="url(#shade)" clip-path="url(#round)"/><text>A &amp; B</text></svg>')).toBe(true);
  expect(isSafeSvg(svg + ' ' .repeat(131072))).toBe(false);
});
it("persists drawings with their notes and includes source in revision context", async () => {
  let workspace = createStarterWorkspace(context.idFactory, context.clock);
  const flow = workspace.flows[0]!;
  const prompt = flow.nodes.find(node => node.data.kind === "generation")!;
  const actions: Parameters<typeof reduceWorkspace>[1][] = [];
  const run = startGenerationRun({ flow: { ...flow, nodes: flow.nodes.map(node => node.id === prompt.id && node.data.kind === "generation" ? { ...node, data: { ...node.data, modelIds: ["test"], instruction: "Draw elephant" } } : node) }, generationNodeId: prompt.id, virtualKey: { kind: "local-codex" }, ...context, dispatch: action => actions.push(action) });
  run.cancel(); await run.completed;
  const started = actions.find(action => action.type === "batch/started");
  if (started?.type !== "batch/started") throw new Error("No batch");
  workspace = reduceWorkspace(workspace, started, context);
  const execution = started.batch.executions[0]!;
  const images = extractDrawings(`\`\`\`svg\n${svg}\n\`\`\``).images!;
  workspace = reduceWorkspace(workspace, { type: "execution/succeeded", flowId: flow.id, batchId: started.batch.id, executionId: execution.id, text: "Elephant drawing.", images, durationMs: 1 }, context);
  workspace = reduceWorkspace(workspace, { type: "node/extract-note", flowId: flow.id, sourceNodeId: execution.outputNodeId! }, context);
  workspace = reduceWorkspace(workspace, { type: "generation/continue", flowId: flow.id, sourceNodeId: execution.outputNodeId! }, context);
  const current = workspace.flows[0]!;
  const continuation = current.nodes.filter(node => node.data.kind === "generation").at(-1)!;
  expect(getInputSnapshots(current, continuation.id)[0]?.text).toContain(svg);
  const repository = new IndexedDbWorkspaceRepository();
  await repository.save("image-test", workspace);
  const saved = await repository.load("image-test");
  const withImages = saved!.flows[0]!.nodes.filter(node => node.data.kind === "text" && node.data.images?.length);
  expect(withImages).toHaveLength(2);
});
it("accepts the actual Codex elephant output including inert accessibility labels and comments", async () => {
  const { readFile } = await import("node:fs/promises");
  const output = await readFile("tests/fixtures/codex-elephant.ndjson", "utf8");
  const text = output.split("\n").filter(Boolean).map(line => JSON.parse(line) as { type: string; text?: string }).filter(event => event.type === "delta").map(event => event.text ?? "").join("");
  expect(extractDrawings(text).images).toHaveLength(1);
});
