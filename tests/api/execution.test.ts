import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { toBifrostVirtualKey } from "../../src/api/credentials";
import { startGenerationRun } from "../../src/features/execution/executeGeneration";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import type { Clock } from "../../src/domain/types";
import type { WorkspaceAction } from "../../src/domain/workspaceReducer";

const server = setupServer(
  http.post("https://api.devneya.com/llm/v1/chat/completions", async ({ request }) => {
    const body = await request.json() as { model?: string };
    if (body.model === "model-fails") return HttpResponse.json({ error: "Provider unavailable", code: "provider_down" }, { status: 503 });
    return HttpResponse.json({ choices: [{ message: { content: `output-${body.model}` } }], usage: { totalTokens: 2 } });
  }),
);

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("generation execution", () => {
  it("runs selected models concurrently and records each settlement", async () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), clock);
    const flow = workspace.flows[0]!;
    const generation = flow.nodes.find((node) => node.data.kind === "generation")!;
    const runFlow = { ...flow, nodes: flow.nodes.map((node) => node.id === generation.id && node.data.kind === "generation" ? { ...node, data: { ...node.data, modelIds: ["model-ok", "model-fails"] } } : node) };
    const actions: WorkspaceAction[] = [];
    const run = startGenerationRun({ flow: runFlow, generationNodeId: generation.id, virtualKey: toBifrostVirtualKey("sk-bf-test"), idFactory: () => crypto.randomUUID(), clock, dispatch: (action) => actions.push(action) });
    await run.completed;
    const started = actions.find((action) => action.type === "batch/started");
    expect(started?.type).toBe("batch/started");
    expect(actions.filter((action) => action.type === "execution/succeeded")).toHaveLength(1);
    expect(actions.filter((action) => action.type === "execution/failed")).toHaveLength(1);
    expect(actions.at(-1)?.type).toBe("batch/completed");
    if (started?.type === "batch/started") expect(started.batch.executions).toHaveLength(2);
  });

  it("cancels in-flight requests without retrying", async () => {
    server.use(http.post("https://api.devneya.com/llm/v1/chat/completions", async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return HttpResponse.json({ choices: [{ message: { content: "late" } }] });
    }));
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), clock);
    const flow = workspace.flows[0]!;
    const generation = flow.nodes.find((node) => node.data.kind === "generation")!;
    const runFlow = { ...flow, nodes: flow.nodes.map((node) => node.id === generation.id && node.data.kind === "generation" ? { ...node, data: { ...node.data, modelIds: ["slow-model"] } } : node) };
    const actions: WorkspaceAction[] = [];
    const run = startGenerationRun({ flow: runFlow, generationNodeId: generation.id, virtualKey: toBifrostVirtualKey("sk-bf-test"), idFactory: () => crypto.randomUUID(), clock, dispatch: (action) => actions.push(action) });
    run.cancel();
    await run.completed;
    expect(actions.filter((action) => action.type === "execution/cancelled")).toHaveLength(1);
    expect(actions.filter((action) => action.type === "execution/succeeded")).toHaveLength(0);
  });
});
