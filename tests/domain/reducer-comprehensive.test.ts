import { describe, expect, it } from "vitest";
import { canAddInputConnection, hasDirectedPath, normalizeInputOrder, validateWorkspaceInvariants } from "../../src/domain/graph";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { createWorkspaceExport, parseWorkspaceExport } from "../../src/domain/exportFormat";
import { reduceWorkspace, normalizeInterruptedBatches } from "../../src/domain/workspaceReducer";
import type { Clock, ExecutionBatch, PlaygroundNode, WorkspaceDocument } from "../../src/domain/types";

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const ids = (() => { let index = 0; return () => `fixture-${index++}`; })();
const context = { idFactory: ids, clock };

const starter = () => createStarterWorkspace(ids, clock);
const flowOf = (workspace: WorkspaceDocument) => workspace.flows[0]!;
const nodeOf = (workspace: WorkspaceDocument, kind: "text" | "generation") => flowOf(workspace).nodes.find((node) => node.data.kind === kind)!;
const manualNode = (id: string, title: string, x = 40): PlaygroundNode => ({
  id,
  position: { x, y: 360 },
  data: { kind: "text", origin: "manual", title, text: `${title} content` },
  createdAt: clock.now().toISOString(),
  updatedAt: clock.now().toISOString(),
});

describe("comprehensive domain transitions", () => {
  it("edits every mutable node field while preserving generated immutability", () => {
    let workspace = starter();
    const flow = flowOf(workspace);
    const text = nodeOf(workspace, "text");
    const generation = nodeOf(workspace, "generation");
    const added = manualNode("extra-text", "Extra");
    workspace = reduceWorkspace(workspace, { type: "node/add", flowId: flow.id, node: added }, context);
    workspace = reduceWorkspace(workspace, { type: "node/move", flowId: flow.id, nodeId: added.id, position: { x: 900, y: 200 } }, context);
    workspace = reduceWorkspace(workspace, { type: "node/rename", flowId: flow.id, nodeId: added.id, title: "Renamed" }, context);
    workspace = reduceWorkspace(workspace, { type: "node/edit-text", flowId: flow.id, nodeId: added.id, text: "Changed" }, context);
    workspace = reduceWorkspace(workspace, { type: "node/edit-instruction", flowId: flow.id, nodeId: generation.id, instruction: "Do the thing" }, context);
    workspace = reduceWorkspace(workspace, { type: "node/set-models", flowId: flow.id, nodeId: generation.id, modelIds: ["one", "two"] }, context);
    const updated = flowOf(workspace).nodes.find((node) => node.id === added.id)!;
    const updatedGeneration = flowOf(workspace).nodes.find((node) => node.id === generation.id)!;
    expect(updated.position).toEqual({ x: 900, y: 200 });
    expect(updated.data).toEqual({ kind: "text", origin: "manual", title: "Renamed", text: "Changed" });
    expect(updatedGeneration.data).toMatchObject({ kind: "generation", instruction: "Do the thing", modelIds: ["one", "two"] });
    expect(text.data.kind).toBe("text");
  });

  it("adds, reorders, reconnects, and removes ordered inputs", () => {
    let workspace = starter();
    const flow = flowOf(workspace);
    const generation = nodeOf(workspace, "generation");
    const first = nodeOf(workspace, "text");
    const second = manualNode("second-text", "Second");
    const third = manualNode("third-text", "Third", 720);
    workspace = reduceWorkspace(workspace, { type: "node/add", flowId: flow.id, node: second }, context);
    workspace = reduceWorkspace(workspace, { type: "node/add", flowId: flow.id, node: third }, context);
    workspace = reduceWorkspace(workspace, { type: "input/add", flowId: flow.id, edge: { id: "second-edge", kind: "input", source: second.id, target: generation.id, order: 1 } }, context);
    workspace = reduceWorkspace(workspace, { type: "input/move", flowId: flow.id, edgeId: "second-edge", direction: "up" }, context);
    expect(flowOf(workspace).edges.filter((edge) => edge.kind === "input").sort((a, b) => a.order - b.order).map((edge) => edge.source)).toEqual([second.id, first.id]);
    const firstEdge = flowOf(workspace).edges.find((edge) => edge.kind === "input" && edge.source === first.id)!;
    workspace = reduceWorkspace(workspace, { type: "input/reconnect", flowId: flow.id, edgeId: firstEdge.id, source: third.id, target: generation.id }, context);
    expect(flowOf(workspace).edges.filter((edge) => edge.kind === "input").map((edge) => edge.source)).toContain(third.id);
    workspace = reduceWorkspace(workspace, { type: "input/remove", flowId: flow.id, edgeId: "second-edge" }, context);
    expect(flowOf(workspace).edges.filter((edge) => edge.kind === "input")).toHaveLength(1);
    expect(flowOf(workspace).edges.filter((edge) => edge.kind === "input")[0]?.order).toBe(0);
  });

  it("settles successful, failed, and cancelled results without removing siblings", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const generation = nodeOf(workspace, "generation");
    const batchId = "batch-1";
    const outputNodes = ["out-1", "out-2", "out-3"].map((id, index) => ({ ...manualNode(id, ["alpha", "beta", "gamma"][index]!, 800), data: { kind: "text" as const, origin: "generated" as const, title: ["alpha", "beta", "gamma"][index]!, text: "", batchId, executionId: `exec-${index}` } }));
    const batch: ExecutionBatch = {
      id: batchId,
      generationNodeId: generation.id,
      startedAt: clock.now().toISOString(),
      promptFormatVersion: 1,
      instruction: "",
      inputs: [],
      executions: outputNodes.map((node) => ({ id: node.data.executionId, modelId: node.data.title, status: "pending" as const, startedAt: clock.now().toISOString(), outputNodeId: node.id })),
    };
    let next = reduceWorkspace(workspace, { type: "batch/started", flowId: flow.id, batch, outputNodes, resultEdges: outputNodes.map((node) => ({ id: `edge-${node.id}`, kind: "result" as const, source: generation.id, target: node.id })) }, context);
    next = reduceWorkspace(next, { type: "execution/succeeded", flowId: flow.id, batchId, executionId: "exec-0", text: "success", durationMs: 4 }, context);
    next = reduceWorkspace(next, { type: "execution/failed", flowId: flow.id, batchId, executionId: "exec-1", error: { kind: "http", status: 503, message: "down" }, durationMs: 5 }, context);
    next = reduceWorkspace(next, { type: "execution/cancelled", flowId: flow.id, batchId, executionId: "exec-2", error: { kind: "cancelled", message: "stopped" }, durationMs: 6 }, context);
    next = reduceWorkspace(next, { type: "batch/completed", flowId: flow.id, batchId, completedAt: clock.now().toISOString() }, context);
    expect(flowOf(next).nodes.filter((node) => node.data.kind === "text")).toHaveLength(4);
    expect(flowOf(next).nodes.find((node) => node.id === "out-1")?.data).toMatchObject({ text: "success" });
    expect(flowOf(next).nodes.find((node) => node.id === "out-2")?.data).toMatchObject({ text: "Failed: down" });
    expect(flowOf(next).nodes.find((node) => node.id === "out-3")?.data).toMatchObject({ text: "Cancelled: stopped" });
    expect(flowOf(next).batches[0]?.completedAt).toBe(clock.now().toISOString());
  });

  it("removes a result reference and prunes a now-empty batch", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const generation = nodeOf(workspace, "generation");
    const output = { ...manualNode("output", "model-a", 800), data: { kind: "text" as const, origin: "generated" as const, title: "model-a", text: "result", batchId: "batch", executionId: "execution" } };
    const batch: ExecutionBatch = { id: "batch", generationNodeId: generation.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1, instruction: "", inputs: [], executions: [{ id: "execution", modelId: "model-a", status: "success", startedAt: clock.now().toISOString(), outputNodeId: output.id }] };
    const started = reduceWorkspace(workspace, { type: "batch/started", flowId: flow.id, batch, outputNodes: [output], resultEdges: [{ id: "result-edge", kind: "result", source: generation.id, target: output.id }] }, context);
    const removed = reduceWorkspace(started, { type: "node/delete", flowId: flow.id, nodeId: output.id }, context);
    expect(flowOf(removed).nodes.some((node) => node.id === output.id)).toBe(false);
    expect(flowOf(removed).batches).toHaveLength(0);
  });

  it("deleting a generation removes its result batch and generated nodes", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const generation = nodeOf(workspace, "generation");
    const output = { ...manualNode("output", "model-a", 800), data: { kind: "text" as const, origin: "generated" as const, title: "model-a", text: "", batchId: "batch", executionId: "execution" } };
    const batch: ExecutionBatch = { id: "batch", generationNodeId: generation.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1, instruction: "", inputs: [], executions: [{ id: "execution", modelId: "model-a", status: "pending", startedAt: clock.now().toISOString(), outputNodeId: output.id }] };
    const started = reduceWorkspace(workspace, { type: "batch/started", flowId: flow.id, batch, outputNodes: [output], resultEdges: [{ id: "result-edge", kind: "result", source: generation.id, target: output.id }] }, context);
    const removed = reduceWorkspace(started, { type: "node/delete", flowId: flow.id, nodeId: generation.id }, context);
    expect(flowOf(removed).nodes.some((node) => node.id === generation.id || node.id === output.id)).toBe(false);
    expect(flowOf(removed).batches).toHaveLength(0);
  });

  it("rejects direct and multi-hop cycles and normalizes input order", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const generation = nodeOf(workspace, "generation");
    const text = nodeOf(workspace, "text");
    const second = manualNode("second", "Second");
    const third = manualNode("third", "Third");
    const graph = { ...flow, nodes: [...flow.nodes, second, third], edges: [
      { id: "a", kind: "input" as const, source: text.id, target: generation.id, order: 4 },
      { id: "b", kind: "result" as const, source: generation.id, target: second.id },
      { id: "c", kind: "input" as const, source: second.id, target: generation.id, order: 1 },
    ] };
    expect(hasDirectedPath(graph, generation.id, text.id)).toBe(false);
    expect(canAddInputConnection(graph, second.id, generation.id)).toMatchObject({ allowed: false });
    expect(normalizeInputOrder(graph.edges, generation.id).filter((edge) => edge.kind === "input").map((edge) => edge.order).sort()).toEqual([0, 1]);
    expect(validateWorkspaceInvariants({ ...workspace, flows: [{ ...flow, nodes: graph.nodes, edges: graph.edges }] })).toEqual(expect.arrayContaining([expect.stringContaining("cycle")]));
    expect(third.id).toBe("third");
  });

  it("normalizes pending generated output as interrupted", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const generation = nodeOf(workspace, "generation");
    const output = { ...manualNode("output", "model-a", 800), data: { kind: "text" as const, origin: "generated" as const, title: "model-a", text: "", batchId: "batch", executionId: "execution" } };
    const batch: ExecutionBatch = { id: "batch", generationNodeId: generation.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1, instruction: "", inputs: [], executions: [{ id: "execution", modelId: "model-a", status: "pending", startedAt: clock.now().toISOString(), outputNodeId: output.id }] };
    const next = normalizeInterruptedBatches({ ...workspace, flows: [{ ...flow, nodes: [...flow.nodes, output], batches: [batch] }] }, clock);
    expect(next.flows[0]?.batches[0]?.executions[0]?.error?.kind).toBe("interrupted");
    expect(next.flows[0]?.nodes.find((node) => node.id === output.id)?.data).toMatchObject({ text: "Failed: This run was interrupted when the page closed." });
  });

  it("duplicates batch provenance and rejects malformed exports", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const duplicate = duplicateFlowWithFreshIds(flow, ids, clock);
    expect(duplicate.nodes.map((node) => node.id)).not.toEqual(flow.nodes.map((node) => node.id));
    const exported = createWorkspaceExport(workspace, clock);
    expect(() => parseWorkspaceExport({ ...exported, format: "devneya-flow-v2" })).toThrow();
    expect(() => parseWorkspaceExport({ ...exported, workspace: { ...exported.workspace, activeFlowId: "missing" } })).toThrow();
  });
});
