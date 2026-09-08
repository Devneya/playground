import { describe, expect, it } from "vitest";
import { canAddInputConnection, hasDirectedPath, normalizeInputOrder, validateWorkspaceInvariants } from "../../src/domain/graph";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { createWorkspaceExport, parseWorkspaceExport } from "../../src/domain/exportFormat";
import { reduceWorkspace, normalizeInterruptedBatches } from "../../src/domain/workspaceReducer";
import type { Clock, ExecutionBatch, PlaygroundEdge, PlaygroundNode, WorkspaceDocument } from "../../src/domain/types";

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const ids = (() => { let index = 0; return () => `fixture-${index++}`; })();
const context = { idFactory: ids, clock };

const starter = () => createStarterWorkspace(ids, clock);
const flowOf = (workspace: WorkspaceDocument) => workspace.flows[0]!;
const nodeOf = (workspace: WorkspaceDocument, kind: "generation" | "text") => flowOf(workspace).nodes.find((node) => node.data.kind === kind)!;
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
    const prompt = nodeOf(workspace, "generation");
    const added = manualNode("extra-text", "Extra");
    workspace = reduceWorkspace(workspace, { type: "node/add", flowId: flow.id, node: added }, context);
    workspace = reduceWorkspace(workspace, { type: "node/move", flowId: flow.id, nodeId: added.id, position: { x: 900, y: 200 } }, context);
    workspace = reduceWorkspace(workspace, { type: "node/rename", flowId: flow.id, nodeId: added.id, title: "Renamed" }, context);
    workspace = reduceWorkspace(workspace, { type: "node/edit-instruction", flowId: flow.id, nodeId: prompt.id, instruction: "Do the thing" }, context);
    workspace = reduceWorkspace(workspace, { type: "node/set-models", flowId: flow.id, nodeId: prompt.id, modelIds: ["one", "two"] }, context);
    const updated = flowOf(workspace).nodes.find((node) => node.id === added.id)!;
    const updatedPrompt = flowOf(workspace).nodes.find((node) => node.id === prompt.id)!;
    expect(updated.position).toEqual({ x: 900, y: 200 });
    expect(updated.data).toEqual({ kind: "text", origin: "manual", title: "Renamed", text: "Extra content" });
    expect(updatedPrompt.data).toMatchObject({ kind: "generation", instruction: "Do the thing", modelIds: ["one", "two"] });
    expect(prompt.data.kind).toBe("generation");
    const generated: PlaygroundNode = { ...manualNode("gen-output", "model-a"), data: { kind: "text", origin: "generated", title: "model-a", text: "out", batchId: "b", executionId: "e" } };
    workspace = reduceWorkspace(workspace, { type: "node/add", flowId: flow.id, node: generated }, context);
    workspace = reduceWorkspace(workspace, { type: "node/rename", flowId: flow.id, nodeId: generated.id, title: "Hacked" }, context);
    expect(flowOf(workspace).nodes.find((node) => node.id === generated.id)?.data).toMatchObject({ title: "model-a" });
  });

  it("replaces, reconnects, and removes the single input", () => {
    let workspace = starter();
    const flow = flowOf(workspace);
    const prompt = nodeOf(workspace, "generation");
    const first = manualNode("first-text", "First");
    const second = manualNode("second-text", "Second");
    const third = manualNode("third-text", "Third", 720);
    workspace = reduceWorkspace(workspace, { type: "node/add", flowId: flow.id, node: first }, context);
    workspace = reduceWorkspace(workspace, { type: "node/add", flowId: flow.id, node: second }, context);
    workspace = reduceWorkspace(workspace, { type: "node/add", flowId: flow.id, node: third }, context);
    workspace = reduceWorkspace(workspace, { type: "input/add", flowId: flow.id, edge: { id: "first-edge", kind: "input", source: first.id, target: prompt.id, order: 0 } }, context);
    expect(flowOf(workspace).edges.filter((edge) => edge.kind === "input").map((edge) => edge.source)).toEqual([first.id]);
    workspace = reduceWorkspace(workspace, { type: "input/remove", flowId: flow.id, edgeId: "first-edge" }, context);
    expect(flowOf(workspace).edges.filter((edge) => edge.kind === "input")).toHaveLength(0);
    workspace = reduceWorkspace(workspace, { type: "input/add", flowId: flow.id, edge: { id: "second-edge", kind: "input", source: second.id, target: prompt.id, order: 0 } }, context);
    workspace = reduceWorkspace(workspace, { type: "input/move", flowId: flow.id, edgeId: "second-edge", direction: "up" }, context);
    expect(flowOf(workspace).edges.filter((edge) => edge.kind === "input").map((edge) => edge.source)).toEqual([second.id]);
    workspace = reduceWorkspace(workspace, { type: "input/reconnect", flowId: flow.id, edgeId: "second-edge", source: third.id, target: prompt.id }, context);
    expect(flowOf(workspace).edges.filter((edge) => edge.kind === "input").map((edge) => edge.source)).toEqual([third.id]);
    workspace = reduceWorkspace(workspace, { type: "input/remove", flowId: flow.id, edgeId: "second-edge" }, context);
    expect(flowOf(workspace).edges.filter((edge) => edge.kind === "input")).toHaveLength(0);
  });
  it("records and persists the exact handles a user drew an input edge between", () => {
    let workspace = starter();
    const flow = flowOf(workspace);
    const prompt = nodeOf(workspace, "generation");
    const source = manualNode("first-text", "First");
    workspace = reduceWorkspace(workspace, { type: "node/add", flowId: flow.id, node: source }, context);
    // A user-drawn edge (grabbed from the right dot → left dot) carries the
    // side-dot handle ids so React Flow re-resolves to the same handle on every
    // render instead of silently falling back to a flow handle.
    const drawn: PlaygroundEdge = { id: "drawn-edge", kind: "input", source: source.id, target: prompt.id, sourceHandle: "text-output", targetHandle: "generation-input", order: 0 };
    workspace = reduceWorkspace(workspace, { type: "input/add", flowId: flow.id, edge: drawn }, context);
    const added = flowOf(workspace).edges.find((edge) => edge.id === "drawn-edge")!;
    expect(added).toMatchObject({ kind: "input", source: source.id, target: prompt.id, sourceHandle: "text-output", targetHandle: "generation-input" });

    // Reconnecting to a different source keeps the handles the user grabbed.
    const other = manualNode("second-text", "Second", 720);
    workspace = reduceWorkspace(workspace, { type: "node/add", flowId: flow.id, node: other }, context);
    workspace = reduceWorkspace(workspace, { type: "input/reconnect", flowId: flow.id, edgeId: "drawn-edge", source: other.id, target: prompt.id, sourceHandle: "text-output", targetHandle: "generation-input" }, context);
    const reconnected = flowOf(workspace).edges.find((edge) => edge.id === "drawn-edge")!;
    expect(reconnected).toMatchObject({ source: other.id, target: prompt.id, sourceHandle: "text-output", targetHandle: "generation-input" });
  });

  it("settles successful, failed, and cancelled results without removing siblings", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const prompt = nodeOf(workspace, "generation");
    const batchId = "batch-1";
    const outputNodes = ["out-1", "out-2", "out-3"].map((id, index) => ({ ...manualNode(id, ["alpha", "beta", "gamma"][index]!, 800), data: { kind: "text" as const, origin: "generated" as const, title: ["alpha", "beta", "gamma"][index]!, text: "", batchId, executionId: `exec-${index}` } }));
    const batch: ExecutionBatch = {
      id: batchId,
      generationNodeId: prompt.id,
      startedAt: clock.now().toISOString(),
      promptFormatVersion: 1,
      instruction: "",
      inputs: [],
      executions: outputNodes.map((node) => ({ id: node.data.executionId, modelId: node.data.title, status: "pending" as const, startedAt: clock.now().toISOString(), outputNodeId: node.id })),
    };
    const resultEdges: PlaygroundEdge[] = [{ id: "edge-out-1", kind: "result" as const, source: prompt.id, target: "out-1" }, { id: "edge-out-2", kind: "result" as const, source: prompt.id, target: "out-2" }, { id: "edge-out-3", kind: "result" as const, source: prompt.id, target: "out-3" }];
    let next = reduceWorkspace(workspace, { type: "batch/started", flowId: flow.id, batch, outputNodes, resultEdges }, context);
    next = reduceWorkspace(next, { type: "execution/succeeded", flowId: flow.id, batchId, executionId: "exec-0", text: "success", durationMs: 4 }, context);
    next = reduceWorkspace(next, { type: "execution/failed", flowId: flow.id, batchId, executionId: "exec-1", error: { kind: "http", status: 503, message: "down" }, durationMs: 5 }, context);
    next = reduceWorkspace(next, { type: "execution/cancelled", flowId: flow.id, batchId, executionId: "exec-2", error: { kind: "cancelled", message: "stopped" }, durationMs: 6 }, context);
    next = reduceWorkspace(next, { type: "batch/completed", flowId: flow.id, batchId, completedAt: clock.now().toISOString() }, context);
    expect(flowOf(next).nodes.filter((node) => node.data.kind === "text")).toHaveLength(3);
    expect(flowOf(next).nodes.find((node) => node.id === "out-1")?.data).toMatchObject({ text: "success" });
    expect(flowOf(next).nodes.find((node) => node.id === "out-2")?.data).toMatchObject({ text: "Failed: down" });
    expect(flowOf(next).nodes.find((node) => node.id === "out-3")?.data).toMatchObject({ text: "Cancelled: stopped" });
    expect(flowOf(next).batches[0]?.completedAt).toBe(clock.now().toISOString());
  });

  it("removes a result reference and prunes a now-empty batch", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const prompt = nodeOf(workspace, "generation");
    const output = { ...manualNode("output", "model-a", 800), data: { kind: "text" as const, origin: "generated" as const, title: "model-a", text: "result", batchId: "batch", executionId: "execution" } };
    const batch: ExecutionBatch = { id: "batch", generationNodeId: prompt.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1, instruction: "", inputs: [], executions: [{ id: "execution", modelId: "model-a", status: "success", startedAt: clock.now().toISOString(), outputNodeId: output.id }] };
    const started = reduceWorkspace(workspace, { type: "batch/started", flowId: flow.id, batch, outputNodes: [output], resultEdges: [{ id: "result-edge", kind: "result", source: prompt.id, target: output.id }] }, context);
    const removed = reduceWorkspace(started, { type: "node/delete", flowId: flow.id, nodeId: output.id }, context);
    expect(flowOf(removed).nodes.some((node) => node.id === output.id)).toBe(false);
    expect(flowOf(removed).batches).toHaveLength(0);
  });

  it("deleting a prompt removes its result batch and generated nodes", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const prompt = nodeOf(workspace, "generation");
    const output = { ...manualNode("output", "model-a", 800), data: { kind: "text" as const, origin: "generated" as const, title: "model-a", text: "", batchId: "batch", executionId: "execution" } };
    const batch: ExecutionBatch = { id: "batch", generationNodeId: prompt.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1, instruction: "", inputs: [], executions: [{ id: "execution", modelId: "model-a", status: "pending", startedAt: clock.now().toISOString(), outputNodeId: output.id }] };
    const started = reduceWorkspace(workspace, { type: "batch/started", flowId: flow.id, batch, outputNodes: [output], resultEdges: [{ id: "result-edge", kind: "result", source: prompt.id, target: output.id }] }, context);
    const removed = reduceWorkspace(started, { type: "node/delete", flowId: flow.id, nodeId: prompt.id }, context);
    expect(flowOf(removed).nodes.some((node) => node.id === prompt.id || node.id === output.id)).toBe(false);
    expect(flowOf(removed).batches).toHaveLength(0);
  });

  it("rejects direct and multi-hop cycles and normalizes input order", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const prompt = nodeOf(workspace, "generation");
    const second = manualNode("second", "Second");
    const third = manualNode("third", "Third");
    const graph = { ...flow, nodes: [...flow.nodes, second, third], edges: [
      { id: "a", kind: "input" as const, source: second.id, target: prompt.id, order: 4 },
      { id: "b", kind: "result" as const, source: prompt.id, target: second.id },
      { id: "c", kind: "input" as const, source: third.id, target: prompt.id, order: 1 },
    ] };
    expect(hasDirectedPath(graph, prompt.id, "missing")).toBe(false);
    expect(hasDirectedPath(graph, second.id, second.id)).toBe(true);
    expect(canAddInputConnection(graph, second.id, prompt.id)).toMatchObject({ allowed: false });
    expect(normalizeInputOrder(graph.edges, prompt.id).filter((edge) => edge.kind === "input").map((edge) => edge.order).sort()).toEqual([0, 1]);
    expect(validateWorkspaceInvariants({ ...workspace, flows: [{ ...flow, nodes: graph.nodes, edges: graph.edges }] })).toEqual(expect.arrayContaining([expect.stringContaining("cycle")]));
    expect(third.id).toBe("third");
  });

  it("normalizes pending generated output as interrupted", () => {
    const workspace = starter();
    const flow = flowOf(workspace);
    const prompt = nodeOf(workspace, "generation");
    const output = { ...manualNode("output", "model-a", 800), data: { kind: "text" as const, origin: "generated" as const, title: "model-a", text: "", batchId: "batch", executionId: "execution" } };
    const batch: ExecutionBatch = { id: "batch", generationNodeId: prompt.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1, instruction: "", inputs: [], executions: [{ id: "execution", modelId: "model-a", status: "pending", startedAt: clock.now().toISOString(), outputNodeId: output.id }] };
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
    expect(() => parseWorkspaceExport({ ...exported, format: "devneya-flow-v9" })).toThrow();
    expect(() => parseWorkspaceExport({ ...exported, workspace: { ...exported.workspace, activeFlowId: "missing" } })).toThrow();
  });
});
