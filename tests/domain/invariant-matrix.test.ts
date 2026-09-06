import { describe, expect, it } from "vitest";
import { canAddInputConnection, getInputSnapshots, hasDirectedPath, normalizeInputOrder, validateWorkspaceInvariants } from "../../src/domain/graph";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { createWorkspaceExport, parseWorkspaceExport } from "../../src/domain/exportFormat";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { emptyHistory, pushHistory, redoHistory, undoHistory } from "../../src/domain/workspaceHistory";
import { LIMITS } from "../../src/domain/limits";
import type { Clock, ExecutionBatch, PlaygroundEdge, PlaygroundNode } from "../../src/domain/types";
import { activeFlow, reduceWorkspace } from "../../src/domain/workspaceReducer";

const clock: Clock = { now: () => new Date("2026-08-19T00:00:00.000Z") };
const id = (() => { let next = 0; return () => `matrix-${next++}`; })();
const starter = () => createStarterWorkspace(id, clock);
const manual = (nodeId: string, text = "text"): PlaygroundNode => ({ id: nodeId, position: { x: 50, y: 50 }, data: { kind: "text", origin: "manual", title: nodeId, text }, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() });

describe("workspace invariant branch matrix", () => {
  it("rejects workspace-level identity and capacity violations", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    expect(validateWorkspaceInvariants({ ...workspace, schemaVersion: 9 } as never)).toContain("Unsupported workspace schema version.");
    expect(validateWorkspaceInvariants({ ...workspace, flows: [], activeFlowId: "missing" })).toEqual(expect.arrayContaining(["Workspace must contain a flow.", "Active flow does not exist."]));
    expect(validateWorkspaceInvariants({ ...workspace, activeFlowId: "missing" })).toContain("Active flow does not exist.");
    const tooManyFlows = Array.from({ length: LIMITS.maxFlows + 1 }, (_, index) => ({ ...flow, id: `flow-${index}` }));
    expect(validateWorkspaceInvariants({ ...workspace, flows: tooManyFlows })).toContain("Too many flows.");
    expect(validateWorkspaceInvariants({ ...workspace, flows: [{ ...flow }, { ...flow }] })).toContain("Duplicate flow IDs.");
  });

  it("rejects node, edge, model, and provenance violations", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    const prompt = flow.nodes[0]!;
    const invalidPrompt = { ...prompt, data: { kind: "generation" as const, title: "p", instruction: "x".repeat(LIMITS.maxTextBytes + 1), modelIds: ["a", "a", "b", "c", "d"] } };
    const invalidContent = { ...manual("bad", "x"), position: { x: Number.NaN, y: 0 }, data: { kind: "text" as const, origin: "manual" as const, title: "x".repeat(LIMITS.maxNodeTitleCodePoints + 1), text: "x".repeat(LIMITS.maxTextBytes + 1) } };
    const generated = { ...manual("result"), data: { kind: "text" as const, origin: "generated" as const, title: "wrong-model", text: "result", batchId: "missing-batch", executionId: "missing-execution" } };
    const edges: PlaygroundEdge[] = [
      { id: "missing", kind: "input", source: "missing", target: prompt.id, order: 0 },
      { id: "wrong-input", kind: "input", source: prompt.id, target: prompt.id, order: 1 },
      { id: "wrong-result", kind: "result", source: generated.id, target: generated.id },
    ];
    const errors = validateWorkspaceInvariants({ ...workspace, flows: [{ ...flow, nodes: [invalidContent, invalidPrompt, generated], edges }] });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining("invalid position"),
      expect.stringContaining("title is too long"),
      expect.stringContaining("instruction is too large"),
      expect.stringContaining("invalid model selection"),
      expect.stringContaining("text is too large"),
      expect.stringContaining("missing endpoint"),
      expect.stringContaining("invalid endpoints"),
      expect.stringContaining("invalid provenance"),
    ]));
  });

  it("rejects unavailable generated inputs, duplicate/order violations, bad batches, and cycles", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    const prompt = flow.nodes[0]!;
    const second = manual("second");
    const generated = { ...manual("result"), data: { kind: "text" as const, origin: "generated" as const, title: "model-a", text: "", batchId: "batch", executionId: "execution" } };
    const batch: ExecutionBatch = { id: "batch", generationNodeId: prompt.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1, instruction: "", inputs: [], executions: [{ id: "execution", modelId: "model-a", status: "pending", startedAt: clock.now().toISOString(), outputNodeId: generated.id }] };
    const edges: PlaygroundEdge[] = [
      { id: "input-a", kind: "input", source: second.id, target: prompt.id, order: 2 },
      { id: "input-b", kind: "input", source: second.id, target: prompt.id, order: 3 },
      { id: "cycle", kind: "result", source: prompt.id, target: second.id },
      { id: "generated-input", kind: "input", source: generated.id, target: prompt.id, order: 4 },
    ];
    const invalidBatch = { ...batch, generationNodeId: "missing-prompt", executions: Array.from({ length: 5 }, (_, index) => ({ ...batch.executions[0]!, id: `execution-${index}`, modelId: index === 4 ? "model-a" : `model-${index}`, outputNodeId: "wrong-output" })) };
    const invalid = { ...workspace, flows: [{ ...flow, nodes: [...flow.nodes, second, generated], edges, batches: [invalidBatch] }] };
    const errors = validateWorkspaceInvariants(invalid);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining("unavailable result"), expect.stringContaining("not contiguous"), expect.stringContaining("duplicate inputs"), expect.stringContaining("missing source"), expect.stringContaining("invalid executions"), expect.stringContaining("wrong output"), expect.stringContaining("cycle")]));
    expect(hasDirectedPath({ ...flow, edges }, prompt.id, second.id, "cycle")).toBe(false);
    expect(hasDirectedPath({ ...flow, edges }, second.id, "missing")).toBe(false);
    expect(normalizeInputOrder(edges, prompt.id).filter((edge) => edge.kind === "input").map((edge) => edge.order)).toEqual([0, 1, 2]);
  });

  it("covers connection rejection reasons and successful reconnection", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    const prompt = flow.nodes[0]!;
    expect(canAddInputConnection(flow, prompt.id, prompt.id)).toMatchObject({ allowed: false, reason: "Connect Text to Generation only." });
    const first = manual("first");
    const connected = { ...flow, nodes: [...flow.nodes, first], edges: [...flow.edges, { id: "first-input", kind: "input" as const, source: first.id, target: prompt.id, order: 0 }] };
    const extra = manual("source-extra");
    expect(canAddInputConnection({ ...connected, nodes: [...connected.nodes, extra] }, extra.id, prompt.id)).toMatchObject({ allowed: false, reason: "A Generation node can have at most 1 inputs." });
    expect(canAddInputConnection(connected, first.id, prompt.id)).toMatchObject({ allowed: false, reason: "That Text node is already connected." });
    const fresh = manual("fresh");
    expect(canAddInputConnection({ ...flow, nodes: [...flow.nodes, fresh] }, fresh.id, prompt.id)).toEqual({ allowed: true });
    const cycleSource = manual("cycle-source");
    expect(canAddInputConnection({ ...flow, nodes: [...flow.nodes, cycleSource], edges: [{ id: "cycle-result", kind: "result" as const, source: prompt.id, target: cycleSource.id }] }, cycleSource.id, prompt.id)).toMatchObject({ allowed: false, reason: "That connection would create a cycle." });
  });

  it("covers export size failures, history empty paths, and duplication without a requested name", () => {
    const workspace = starter();
    expect(duplicateFlowWithFreshIds(workspace.flows[0]!, id, clock).name).toBe("Untitled flow");
    expect(undoHistory(emptyHistory(), workspace)).toBeNull();
    expect(redoHistory(emptyHistory(), workspace)).toBeNull();
    const history = pushHistory(emptyHistory(), workspace);
    expect(undoHistory(history, workspace)).not.toBeNull();
    expect(() => parseWorkspaceExport({ format: "devneya-flow-v2", exportedAt: clock.now().toISOString(), workspace: { ...workspace, activeFlowId: "missing" } })).toThrow();
    const large = { ...workspace, flows: [{ ...workspace.flows[0]!, nodes: [...workspace.flows[0]!.nodes, ...Array.from({ length: 248 }, (_, index) => manual(`large-${index}`, "x".repeat(64 * 1024)))] }] };
    expect(() => createWorkspaceExport(large, clock)).toThrow("This workspace is too large to export.");
  });
  it("covers malformed duplication references and optional provenance fields", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    const generated: PlaygroundNode = {
      id: "generated-unmapped",
      position: { x: 900, y: 120 },
      data: { kind: "text", origin: "generated", title: "model", text: "", batchId: "missing-batch", executionId: "missing-execution" },
      createdAt: clock.now().toISOString(),
      updatedAt: clock.now().toISOString(),
    };
    const malformed = {
      ...flow,
      nodes: [...flow.nodes, generated],
      edges: [...flow.edges, { id: "unmapped-edge", kind: "result" as const, source: "missing-source", target: "missing-target" }],
      batches: [{
        id: "batch",
        generationNodeId: "missing-prompt",
        startedAt: clock.now().toISOString(),
        promptFormatVersion: 1 as const,
        instruction: "",
        inputs: [{ nodeId: "missing-input", title: "missing", text: "" }],
        executions: [
          { id: "execution", modelId: "model", status: "success" as const, startedAt: clock.now().toISOString(), outputNodeId: "missing-output" },
          { id: "execution-without-output", modelId: "other", status: "failed" as const, startedAt: clock.now().toISOString() },
        ],
      }],
    };
    const duplicate = duplicateFlowWithFreshIds(malformed, id, clock);
    expect(duplicate.nodes.find((node) => node.data.kind === "text" && node.data.origin === "generated")?.data).toMatchObject({ batchId: "missing-batch", executionId: "missing-execution" });
    expect(duplicate.edges.find((edge) => edge.source === "missing-source")).toMatchObject({ source: "missing-source", target: "missing-target" });
    expect(duplicate.batches[0]).toMatchObject({ generationNodeId: "missing-prompt", inputs: [{ nodeId: "missing-input" }] });
    expect(duplicate.batches[0]?.executions[0]).toMatchObject({ outputNodeId: "missing-output" });
    expect(duplicate.batches[0]?.executions[1]).not.toHaveProperty("outputNodeId");
  });

  it("covers graph traversal, non-content snapshots, and structural capacity errors", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    const prompt = flow.nodes[0]!;
    const graph = {
      ...flow,
      nodes: [...flow.nodes, manual("branch-a"), manual("branch-b"), manual("branch-c")],
      edges: [
        { id: "branch-1", kind: "result" as const, source: prompt.id, target: "branch-a" },
        { id: "branch-2", kind: "result" as const, source: prompt.id, target: "branch-b" },
        { id: "branch-3", kind: "result" as const, source: "branch-a", target: "branch-c" },
        { id: "branch-4", kind: "result" as const, source: "branch-b", target: "branch-c" },
      ],
    };
    expect(hasDirectedPath(graph, prompt.id, "missing", "branch-1")).toBe(false);
    expect(hasDirectedPath(graph, prompt.id, "branch-c")).toBe(true);
    expect(normalizeInputOrder([{ id: "wrong-source", kind: "input", source: prompt.id, target: prompt.id, order: 3 }])).toEqual([{ id: "wrong-source", kind: "input", source: prompt.id, target: prompt.id, order: 0 }]);
    expect(getInputSnapshots({ ...flow, edges: [{ id: "snapshot-non-content", kind: "input", source: prompt.id, target: prompt.id, order: 0 }, ...flow.edges] }, prompt.id)).toEqual([]);

    const oversizedFlow = {
      ...flow,
      nodes: Array.from({ length: LIMITS.maxNodesPerFlow + 1 }, (_, index) => manual(`capacity-node-${index}`)),
      edges: Array.from({ length: LIMITS.maxEdgesPerFlow + 1 }, (_, index) => ({ id: `capacity-edge-${index}`, kind: "result" as const, source: `capacity-node-${index % 251}`, target: `capacity-node-${(index + 1) % 251}` })),
    };
    const errors = validateWorkspaceInvariants({ ...workspace, flows: [{ ...oversizedFlow, edges: [...oversizedFlow.edges, { ...oversizedFlow.edges[0]! }] }] });
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining("too many nodes"), expect.stringContaining("too many edges"), expect.stringContaining("duplicate edge IDs") ]));
    const generated = { ...manual("generated-success"), data: { kind: "text" as const, origin: "generated" as const, title: "model", text: "", batchId: "batch-success", executionId: "execution-success" } };
    const generatedFlow = { ...flow, nodes: [...flow.nodes, generated], edges: [...flow.edges, { id: "generated-success-input", kind: "input" as const, source: generated.id, target: prompt.id, order: 1 }, { id: "wrong-result", kind: "result" as const, source: prompt.id, target: prompt.id }], batches: [{ id: "batch-success", generationNodeId: prompt.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1 as const, instruction: "", inputs: [], executions: [{ id: "execution-success", modelId: "model", status: "success" as const, startedAt: clock.now().toISOString() }] }] };
    const provenanceErrors = validateWorkspaceInvariants({ ...workspace, flows: [generatedFlow] });
    expect(provenanceErrors).toEqual(expect.arrayContaining([expect.stringContaining("invalid provenance"), expect.stringContaining("invalid endpoints")]));
    const cyclic = { nodes: [manual("cycle-a"), manual("cycle-b")], edges: [{ id: "a-b", kind: "result" as const, source: "cycle-a", target: "cycle-b" }, { id: "b-a", kind: "result" as const, source: "cycle-b", target: "cycle-a" }], batches: [], id: "cycle-flow", name: "cycle", viewport: { x: 0, y: 0, zoom: 1 }, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() };
    expect(hasDirectedPath(cyclic, "cycle-a", "missing")).toBe(false);
  });

  it("covers reducer no-op paths, single-flow reset, and history bounds", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    const prompt = flow.nodes[0]!;
    const reducerContext = { idFactory: id, clock };
    expect(activeFlow({ ...workspace, activeFlowId: "missing" })?.id).toBe(flow.id);
    expect(reduceWorkspace(workspace, { type: "flow/activate", flowId: "missing" }, reducerContext)).toBe(workspace);
    const reset = reduceWorkspace(workspace, { type: "flow/delete", flowId: flow.id }, reducerContext);
    expect(reset.flows).toHaveLength(1);
    expect(reduceWorkspace(workspace, { type: "node/delete", flowId: flow.id, nodeId: "missing" }, reducerContext)).toEqual(expect.objectContaining({ flows: expect.any(Array) }));
    expect(reduceWorkspace(workspace, { type: "input/add", flowId: flow.id, edge: { id: "result", kind: "result", source: prompt.id, target: prompt.id } }, reducerContext)).toEqual(expect.objectContaining({ flows: expect.any(Array) }));
    expect(reduceWorkspace(workspace, { type: "input/reconnect", flowId: flow.id, edgeId: "missing", source: flow.nodes[0]!.id, target: prompt.id }, reducerContext)).toEqual(expect.objectContaining({ flows: expect.any(Array) }));
    expect(reduceWorkspace(workspace, { type: "input/move", flowId: flow.id, edgeId: "missing", direction: "up" }, reducerContext)).toEqual(expect.objectContaining({ flows: expect.any(Array) }));
    let history = emptyHistory();
    for (let index = 0; index < LIMITS.maxHistoryEntries + 1; index += 1) history = pushHistory(history, { ...workspace, updatedAt: `${index}` });
    expect(history.past).toHaveLength(LIMITS.maxHistoryEntries);
    expect(pushHistory(emptyHistory(), { ...workspace, updatedAt: "x".repeat(LIMITS.maxHistoryBytes + 1) })).toEqual(emptyHistory());
    const large = { ...workspace, flows: [{ ...flow, nodes: [...flow.nodes, ...Array.from({ length: 248 }, (_, index) => manual(`parse-large-${index}`, "x".repeat(64 * 1024)))] }] };
    expect(() => parseWorkspaceExport({ format: "devneya-flow-v2", exportedAt: clock.now().toISOString(), workspace: large })).toThrow("This workspace file is invalid.");
  });

});
