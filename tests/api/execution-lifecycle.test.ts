import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { toBifrostVirtualKey } from "../../src/api/credentials";
import { startGenerationRun } from "../../src/features/execution/executeGeneration";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import type { Clock } from "../../src/domain/types";
import type { WorkspaceAction } from "../../src/domain/workspaceReducer";

const server = setupServer(
  http.post("https://api.devneya.com/llm/v1/chat/completions", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return HttpResponse.json({ choices: [{ message: { content: "late result" } }] });
  }),
);

const clock: Clock = { now: () => new Date("2026-08-19T00:00:00.000Z") };

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("execution lifecycle guard", () => {
  it("drops completion actions after the owning workspace is gone", async () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), clock);
    const flow = workspace.flows[0]!;
    const generation = flow.nodes.find((node) => node.data.kind === "generation")!;
    const runFlow = { ...flow, nodes: flow.nodes.map((node) => node.id === generation.id && node.data.kind === "generation" ? { ...node, data: { ...node.data, modelIds: ["model-a"] } } : node) };
    const actions: WorkspaceAction[] = [];
    let mounted = true;
    const run = startGenerationRun({
      flow: runFlow,
      generationNodeId: generation.id,
      virtualKey: toBifrostVirtualKey("sk-bf-test"),
      idFactory: () => crypto.randomUUID(),
      clock,
      dispatch: (action) => actions.push(action),
      canDispatch: () => mounted,
    });
    mounted = false;
    await run.completed;
    expect(actions.map((action) => action.type)).toEqual(["batch/started"]);
  });
});
