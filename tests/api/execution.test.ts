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
  const makeRunOptions = (modelIds: string[]) => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), clock);
    const flow = workspace.flows[0]!;
    const generation = flow.nodes.find((node) => node.data.kind === "generation")!;
    const runFlow = { ...flow, nodes: flow.nodes.map((node) => node.id === generation.id && node.data.kind === "generation" ? { ...node, data: { ...node.data, modelIds } } : node) };
    return { flow: runFlow, generation, virtualKey: toBifrostVirtualKey("sk-bf-test"), idFactory: () => crypto.randomUUID(), clock, dispatch: () => {} };
  };

  it("rejects invalid run inputs before dispatching a batch", () => {
    const valid = makeRunOptions(["model-a"]);
    expect(() => startGenerationRun({ ...valid, generationNodeId: "missing" })).toThrow("Choose a Generation node");
    const empty = makeRunOptions([]);
    expect(() => startGenerationRun({ ...empty, generationNodeId: empty.generation.id })).toThrow("at least one model");
    const tooMany = makeRunOptions(["a", "b", "c", "d", "e"]);
    expect(() => startGenerationRun({ ...tooMany, generationNodeId: tooMany.generation.id })).toThrow("no more than 4 models");
    const oversized = { ...valid, flow: { ...valid.flow, nodes: valid.flow.nodes.map((node) => node.data.kind === "generation" ? { ...node, data: { ...node.data, instruction: "x".repeat(256 * 1024) } } : node) } };
    expect(() => startGenerationRun({ ...oversized, generationNodeId: valid.generation.id })).toThrow("prompt is too large");
  });

  it("records malformed provider responses as invalid-response failures", async () => {
    server.use(http.post("https://api.devneya.com/llm/v1/chat/completions", () => HttpResponse.json({ choices: [] })));
    const actions: WorkspaceAction[] = [];
    const options = makeRunOptions(["model-invalid"]);
    const run = startGenerationRun({ ...options, generationNodeId: options.generation.id, dispatch: (action) => actions.push(action) });
    await run.completed;
    const failed = actions.find((action) => action.type === "execution/failed");
    expect(failed?.type).toBe("execution/failed");
    if (failed?.type === "execution/failed") expect(failed.error.kind).toBe("invalid_response");
  });

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
