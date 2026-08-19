import { describe, expect, it } from "vitest";
import { canAddInputConnection, getNode, getOrderedInputEdges, hasDirectedPath, validateWorkspaceInvariants } from "../../src/domain/graph";
import { createStarterWorkspace, uniqueFlowName } from "../../src/domain/workspaceFactory";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { placeNewResultNodes } from "../../src/domain/resultPlacement";
import { allExecutionIds, allNodeIds, isFinitePosition } from "../../src/domain/types";
import { randomIdFactory, timestamp } from "../../src/domain/ids";
import { LIMITS, codePointLength, utf8ByteLength } from "../../src/domain/limits";
import type { Clock, ExecutionBatch, PlaygroundNode } from "../../src/domain/types";

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const id = (() => { let n = 0; return () => `edge-${n++}`; })();

const generatedFixture = () => {
  const workspace = createStarterWorkspace(id, clock);
  const flow = workspace.flows[0]!;
  const generation = flow.nodes.find((node) => node.data.kind === "generation")!;
  const output: PlaygroundNode = {
    id: "generated",
    position: { x: 900, y: 120 },
    data: { kind: "text", origin: "generated", title: "model-a", text: "result", batchId: "batch", executionId: "execution" },
    createdAt: clock.now().toISOString(),
    updatedAt: clock.now().toISOString(),
  };
  const batch: ExecutionBatch = {
    id: "batch",
    generationNodeId: generation.id,
    startedAt: clock.now().toISOString(),
    promptFormatVersion: 1,
    instruction: "",
    inputs: [],
    executions: [{ id: "execution", modelId: "model-a", status: "success", startedAt: clock.now().toISOString(), outputNodeId: output.id }],
  };
  return { workspace, flow, generation, output, batch };
};

describe("domain edge cases", () => {
  it("places a later result column after occupied rectangles", () => {
    const workspace = createStarterWorkspace(id, clock);
    const flow = workspace.flows[0]!;
    const generation = flow.nodes.find((node) => node.data.kind === "generation")!;
    const occupied: PlaygroundNode = { ...flow.nodes[0]!, id: "occupied", position: { x: 860, y: 120 } };
    expect(placeNewResultNodes({ ...flow, nodes: [...flow.nodes, occupied] }, generation.id, 1)).toEqual([{ x: 1220, y: 120 }]);
  });

  it("covers identity, size, and naming helpers", () => {
    const workspace = createStarterWorkspace(id, clock);
    const flow = workspace.flows[0]!;
    expect(getNode(flow, "missing")).toBeUndefined();
    expect(getOrderedInputEdges(flow, "missing")).toEqual([]);
    expect(uniqueFlowName([], "Flow")).toBe("Flow");
    expect(timestamp(clock)).toBe("2026-01-01T00:00:00.000Z");
    expect(isFinitePosition({ x: 1, y: 2 })).toBe(true);
    expect(isFinitePosition({ x: Number.NaN, y: 2 })).toBe(false);
    expect(codePointLength("🙂a")).toBe(2);
    expect(utf8ByteLength("🙂")).toBe(4);
    expect(LIMITS.maxModelsPerBatch).toBe(4);
    expect(randomIdFactory()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("remaps generated provenance during deep duplication", () => {
    const { flow, generation, output, batch } = generatedFixture();
    const withOutput = { ...flow, nodes: [...flow.nodes, output], edges: [...flow.edges, { id: "result-edge", kind: "result" as const, source: generation.id, target: output.id }], batches: [batch] };
    const duplicate = duplicateFlowWithFreshIds(withOutput, id, clock);
    const duplicatedOutput = duplicate.nodes.find((node) => node.data.kind === "text" && node.data.origin === "generated");
    const duplicatedBatch = duplicate.batches[0];
    expect(duplicatedOutput?.data).toMatchObject({ batchId: duplicatedBatch?.id, executionId: duplicatedBatch?.executions[0]?.id });
    expect(duplicatedBatch?.executions[0]?.outputNodeId).toBe(duplicatedOutput?.id);
  });

  it("allows successful generated results and rejects pending ones", () => {
    const { workspace, flow, output, batch } = generatedFixture();
    const generation = flow.nodes.find((node) => node.data.kind === "generation")!;
    const readyFlow = { ...flow, nodes: [...flow.nodes, output], batches: [batch] };
    expect(canAddInputConnection(readyFlow, output.id, generation.id)).toEqual({ allowed: true });
    const pendingFlow = { ...readyFlow, batches: [{ ...batch, executions: [{ ...batch.executions[0]!, status: "pending" as const }] }] };
    expect(canAddInputConnection(pendingFlow, output.id, generation.id)).toMatchObject({ allowed: false });
    expect(hasDirectedPath(readyFlow, generation.id, generation.id)).toBe(true);
    expect(allNodeIds(readyFlow)).toContain(output.id);
    expect(allExecutionIds({ ...workspace, flows: [readyFlow] })).toContain("execution");
  });

  it("reports cross-reference and limit violations", () => {
    const workspace = createStarterWorkspace(id, clock);
    const flow = workspace.flows[0]!;
    const text = flow.nodes[0]!;
    const generation = flow.nodes[1]!;
    const invalid = { ...workspace, flows: [{ ...flow, nodes: [...flow.nodes, { ...text, id: generation.id }], edges: [{ id: "bad", kind: "input" as const, source: "missing", target: generation.id, order: 5 }], batches: [{ id: "orphan", generationNodeId: "missing", startedAt: clock.now().toISOString(), promptFormatVersion: 1 as const, instruction: "", inputs: [], executions: [] }] }] };
    const errors = validateWorkspaceInvariants(invalid);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining("duplicate node"), expect.stringContaining("missing endpoint"), expect.stringContaining("missing source")]));
  });
});
