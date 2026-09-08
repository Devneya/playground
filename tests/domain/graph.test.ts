import { describe, expect, it } from "vitest";
import { canAddInputConnection, getInputSnapshots, validateWorkspaceInvariants } from "../../src/domain/graph";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { systemClock } from "../../src/domain/ids";
import type { PlaygroundNode } from "../../src/domain/types";

const content = (id: string, title = id): PlaygroundNode => ({
  id,
  position: { x: 500, y: 120 },
  data: { kind: "text", title, text: `${title} text`, origin: "manual" },
  createdAt: systemClock.now().toISOString(),
  updatedAt: systemClock.now().toISOString(),
});

describe("graph invariants", () => {
  it("starts with a valid prompt flow with no inputs yet", () => {
    const workspace = createStarterWorkspace(() => "id-" + Math.random(), systemClock);
    expect(validateWorkspaceInvariants(workspace)).toEqual([]);
    const flow = workspace.flows[0]!;
    const prompt = flow.nodes.find((node) => node.data.kind === "generation")!;
    expect(prompt.data.title).toBe("Generation 1");
    expect(getInputSnapshots(flow, prompt.id)).toEqual([]);
  });

  it("rejects wrong endpoint types and duplicate inputs", () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), systemClock);
    const flow = workspace.flows[0]!;
    const prompt = flow.nodes.find((node) => node.data.kind === "generation")!;
    expect(canAddInputConnection(flow, prompt.id, prompt.id)).toEqual({ allowed: false, reason: "Connect Text to Generation only." });
    const withContent = { ...flow, nodes: [...flow.nodes, content("c1", "Source")] };
    expect(canAddInputConnection(withContent, "c1", prompt.id)).toEqual({ allowed: true });
    const connected = { ...withContent, edges: [...withContent.edges, { id: "e1", kind: "input" as const, source: "c1", target: prompt.id, order: 0 }] };
    expect(canAddInputConnection(connected, "c1", prompt.id)).toEqual({ allowed: false, reason: "That Text node is already connected." });
    const extra = { ...connected, nodes: [...connected.nodes, content("c2", "Other")] };
    expect(canAddInputConnection(extra, "c2", prompt.id)).toEqual({ allowed: false, reason: "A Generation node can have at most 1 input." });
  });

  it("rejects a cycle and unavailable generated result as an input", () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), systemClock);
    const flow = workspace.flows[0]!;
    const prompt = flow.nodes.find((node) => node.data.kind === "generation")!;
    const result: PlaygroundNode = {
      id: "r1",
      position: { x: 500, y: 120 },
      data: { kind: "text", title: "model", text: "out", origin: "generated", batchId: "b", executionId: "e" },
      createdAt: systemClock.now().toISOString(),
      updatedAt: systemClock.now().toISOString(),
    };
    const produced = {
      ...flow,
      nodes: [...flow.nodes, result],
      edges: [...flow.edges, { id: "re", kind: "result" as const, source: prompt.id, target: result.id }],
      batches: [{ id: "b", generationNodeId: prompt.id, startedAt: systemClock.now().toISOString(), promptFormatVersion: 1 as const, instruction: "", inputs: [], executions: [{ id: "e", modelId: "model", status: "success" as const, startedAt: systemClock.now().toISOString(), outputNodeId: result.id }] }],
    };
    expect(canAddInputConnection(produced, result.id, prompt.id)).toMatchObject({ allowed: false, reason: "That connection would create a cycle." });
    const pending = { ...produced, batches: [{ ...produced.batches[0]!, executions: [{ ...produced.batches[0]!.executions[0]!, status: "pending" as const }] }] };
    expect(canAddInputConnection(pending, result.id, prompt.id)).toMatchObject({ allowed: false });
  });
});
