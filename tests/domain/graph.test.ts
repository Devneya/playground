import { describe, expect, it } from "vitest";
import { canAddInputConnection, getInputSnapshots, validateWorkspaceInvariants } from "../../src/domain/graph";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { systemClock } from "../../src/domain/ids";

describe("graph invariants", () => {
  it("starts with a valid Text to Generation connection", () => {
    const workspace = createStarterWorkspace(() => "id-" + Math.random(), systemClock);
    expect(validateWorkspaceInvariants(workspace)).toEqual([]);
    const flow = workspace.flows[0]!;
    const text = flow.nodes.find((node) => node.data.kind === "text")!;
    const generation = flow.nodes.find((node) => node.data.kind === "generation")!;
    expect(getInputSnapshots(flow, generation.id)).toEqual([{ nodeId: text.id, title: "Text 1", text: "" }]);
  });

  it("rejects wrong endpoint types and duplicate inputs", () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), systemClock);
    const flow = workspace.flows[0]!;
    const text = flow.nodes.find((node) => node.data.kind === "text")!;
    const generation = flow.nodes.find((node) => node.data.kind === "generation")!;
    expect(canAddInputConnection(flow, generation.id, generation.id)).toEqual({ allowed: false, reason: "Connect Text to Generation only." });
    expect(canAddInputConnection(flow, text.id, generation.id)).toEqual({ allowed: false, reason: "That Text node is already connected." });
  });

  it("rejects a cycle and unavailable generated result as an input", () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), systemClock);
    const flow = workspace.flows[0]!;
    const generation = flow.nodes.find((node) => node.data.kind === "generation")!;
    const text = flow.nodes.find((node) => node.data.kind === "text")!;
    const cycle = canAddInputConnection({ ...flow, edges: flow.edges.filter((edge) => edge.source !== text.id) }, text.id, generation.id);
    expect(cycle.allowed).toBe(true);
    const unavailable = canAddInputConnection(flow, text.id, generation.id);
    expect(unavailable.allowed).toBe(false);
  });
});
