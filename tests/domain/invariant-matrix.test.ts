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
    expect(validateWorkspaceInvariants({ ...workspace, schemaVersion: 2 } as never)).toContain("Unsupported workspace schema version.");
    expect(validateWorkspaceInvariants({ ...workspace, flows: [], activeFlowId: "missing" })).toEqual(expect.arrayContaining(["Workspace must contain a flow.", "Active flow does not exist."]));
    expect(validateWorkspaceInvariants({ ...workspace, activeFlowId: "missing" })).toContain("Active flow does not exist.");
    const tooManyFlows = Array.from({ length: LIMITS.maxFlows + 1 }, (_, index) => ({ ...flow, id: `flow-${index}` }));
    expect(validateWorkspaceInvariants({ ...workspace, flows: tooManyFlows })).toContain("Too many flows.");
    expect(validateWorkspaceInvariants({ ...workspace, flows: [{ ...flow }, { ...flow }] })).toContain("Duplicate flow IDs.");
  });

  it("rejects node, edge, model, and provenance violations", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    const text = flow.nodes[0]!;
    const generation = flow.nodes[1]!;
    const invalidGeneration = { ...generation, data: { kind: "generation" as const, title: "g", instruction: "x".repeat(LIMITS.maxTextBytes + 1), modelIds: ["a", "a", "b", "c", "d"] } };
    const invalidText = { ...text, position: { x: Number.NaN, y: 0 }, data: { kind: "text" as const, origin: "manual" as const, title: "x".repeat(LIMITS.maxNodeTitleCodePoints + 1), text: "x".repeat(LIMITS.maxTextBytes + 1) } };
    const generated = { ...manual("generated", "result"), data: { kind: "text" as const, origin: "generated" as const, title: "wrong-model", text: "result", batchId: "missing-batch", executionId: "missing-execution" } };
    const edges: PlaygroundEdge[] = [
      { id: "missing", kind: "input", source: "missing", target: generation.id, order: 0 },
      { id: "wrong-input", kind: "input", source: generation.id, target: generation.id, order: 1 },
      { id: "wrong-result", kind: "result", source: text.id, target: text.id },
    ];
    const errors = validateWorkspaceInvariants({ ...workspace, flows: [{ ...flow, nodes: [invalidText, invalidGeneration, generated], edges }] });
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
    const text = flow.nodes[0]!;
    const generation = flow.nodes[1]!;
    const second = manual("second");
    const generated = { ...manual("result"), data: { kind: "text" as const, origin: "generated" as const, title: "model-a", text: "", batchId: "batch", executionId: "execution" } };
    const batch: ExecutionBatch = { id: "batch", generationNodeId: generation.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1, instruction: "", inputs: [], executions: [{ id: "execution", modelId: "model-a", status: "pending", startedAt: clock.now().toISOString(), outputNodeId: generated.id }] };
    const edges: PlaygroundEdge[] = [
      { id: "input-a", kind: "input", source: text.id, target: generation.id, order: 2 },
      { id: "input-b", kind: "input", source: text.id, target: generation.id, order: 3 },
      { id: "cycle", kind: "result", source: generation.id, target: text.id },
      { id: "generated-input", kind: "input", source: generated.id, target: generation.id, order: 4 },
    ];
    const invalidBatch = { ...batch, generationNodeId: "missing-generation", executions: Array.from({ length: 5 }, (_, index) => ({ ...batch.executions[0]!, id: `execution-${index}`, modelId: index === 4 ? "model-a" : `model-${index}`, outputNodeId: "wrong-output" })) };
    const invalid = { ...workspace, flows: [{ ...flow, nodes: [...flow.nodes, second, generated], edges, batches: [invalidBatch] }] };
    const errors = validateWorkspaceInvariants(invalid);
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining("unavailable result"), expect.stringContaining("not contiguous"), expect.stringContaining("duplicate inputs"), expect.stringContaining("missing source"), expect.stringContaining("invalid executions"), expect.stringContaining("wrong output"), expect.stringContaining("cycle")]));
    expect(hasDirectedPath({ ...flow, edges }, generation.id, text.id, "cycle")).toBe(false);
    expect(hasDirectedPath({ ...flow, edges }, text.id, "missing")).toBe(false);
    expect(normalizeInputOrder(edges, generation.id).filter((edge) => edge.kind === "input").map((edge) => edge.order)).toEqual([0, 1, 2]);
  });

  it("covers connection rejection reasons and successful reconnection", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    const text = flow.nodes[0]!;
    const generation = flow.nodes[1]!;
    expect(canAddInputConnection(flow, generation.id, generation.id)).toMatchObject({ allowed: false, reason: "Connect Text to Generation only." });
    expect(canAddInputConnection(flow, text.id, text.id)).toMatchObject({ allowed: false, reason: "Connect Text to Generation only." });
    const second = manual("second");
    const withSecond = { ...flow, nodes: [...flow.nodes, second], edges: [...flow.edges, { id: "second-input", kind: "input" as const, source: second.id, target: generation.id, order: 1 }] };
    expect(canAddInputConnection(withSecond, text.id, generation.id)).toMatchObject({ allowed: false, reason: "That Text node is already connected." });
    const full = { ...withSecond, edges: Array.from({ length: LIMITS.maxInputsPerGeneration }, (_, index) => ({ id: `edge-${index}`, kind: "input" as const, source: index === 0 ? text.id : `source-${index}`, target: generation.id, order: index })) };
    const withNodes = { ...full, nodes: [...full.nodes, ...Array.from({ length: LIMITS.maxInputsPerGeneration }, (_, index) => manual(`source-${index}`)), manual("source-extra")] };
    expect(canAddInputConnection(withNodes, "source-extra", generation.id)).toMatchObject({ allowed: false, reason: "A Generation node can have at most 32 inputs." });
    const cycleSource = manual("cycle-source");
    expect(canAddInputConnection({ ...flow, nodes: [...flow.nodes, cycleSource], edges: [{ id: "cycle-result", kind: "result" as const, source: generation.id, target: cycleSource.id }] }, cycleSource.id, generation.id)).toMatchObject({ allowed: false, reason: "That connection would create a cycle." });
  });

  it("covers export size failures, history empty paths, and duplication without a requested name", () => {
    const workspace = starter();
    expect(duplicateFlowWithFreshIds(workspace.flows[0]!, id, clock).name).toBe("Untitled flow");
    expect(undoHistory(emptyHistory(), workspace)).toBeNull();
    expect(redoHistory(emptyHistory(), workspace)).toBeNull();
    const history = pushHistory(emptyHistory(), workspace);
    expect(undoHistory(history, workspace)).not.toBeNull();
    expect(() => parseWorkspaceExport({ format: "devneya-flow-v1", exportedAt: clock.now().toISOString(), workspace: { ...workspace, activeFlowId: "missing" } })).toThrow();
    const large = { ...workspace, flows: [{ ...workspace.flows[0]!, nodes: [...workspace.flows[0]!.nodes, ...Array.from({ length: 248 }, (_, index) => manual(`large-${index}`, "x".repeat(64 * 1024)))] }] };
    expect(() => createWorkspaceExport(large, clock)).toThrow("too large");
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
        generationNodeId: "missing-generation",
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
    expect(duplicate.batches[0]).toMatchObject({ generationNodeId: "missing-generation", inputs: [{ nodeId: "missing-input" }] });
    expect(duplicate.batches[0]?.executions[0]).toMatchObject({ outputNodeId: "missing-output" });
    expect(duplicate.batches[0]?.executions[1]).not.toHaveProperty("outputNodeId");
  });

  it("covers graph traversal, non-text snapshots, and structural capacity errors", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    const text = flow.nodes[0]!;
    const generation = flow.nodes[1]!;
    const graph = {
      ...flow,
      nodes: [...flow.nodes, manual("branch-a"), manual("branch-b"), manual("branch-c")],
      edges: [
        { id: "branch-1", kind: "result" as const, source: text.id, target: "branch-a" },
        { id: "branch-2", kind: "result" as const, source: text.id, target: "branch-b" },
        { id: "branch-3", kind: "result" as const, source: "branch-a", target: "branch-c" },
        { id: "branch-4", kind: "result" as const, source: "branch-b", target: "branch-c" },
      ],
    };
    expect(hasDirectedPath(graph, text.id, "missing", "branch-1")).toBe(false);
    expect(hasDirectedPath(graph, text.id, "branch-c")).toBe(true);
    expect(normalizeInputOrder([{ id: "wrong-source", kind: "input", source: generation.id, target: generation.id, order: 3 }])).toEqual([{ id: "wrong-source", kind: "input", source: generation.id, target: generation.id, order: 0 }]);
    expect(getInputSnapshots({ ...flow, edges: [{ id: "snapshot-non-text", kind: "input", source: generation.id, target: generation.id, order: 0 }, ...flow.edges] }, generation.id)).toEqual([{ nodeId: text.id, title: "Text 1", text: "" }]);

    const oversizedFlow = {
      ...flow,
      nodes: Array.from({ length: LIMITS.maxNodesPerFlow + 1 }, (_, index) => manual(`capacity-node-${index}`)),
      edges: Array.from({ length: LIMITS.maxEdgesPerFlow + 1 }, (_, index) => ({ id: `capacity-edge-${index}`, kind: "result" as const, source: `capacity-node-${index % 251}`, target: `capacity-node-${(index + 1) % 251}` })),
    };
    const errors = validateWorkspaceInvariants({ ...workspace, flows: [{ ...oversizedFlow, edges: [...oversizedFlow.edges, { ...oversizedFlow.edges[0]! }] }] });
    expect(errors).toEqual(expect.arrayContaining([expect.stringContaining("too many nodes"), expect.stringContaining("too many edges"), expect.stringContaining("duplicate edge IDs") ]));
    const generated = { ...manual("generated-success"), data: { kind: "text" as const, origin: "generated" as const, title: "model", text: "", batchId: "batch-success", executionId: "execution-success" } };
    const generatedFlow = { ...flow, nodes: [...flow.nodes, generated], edges: [...flow.edges, { id: "generated-success-input", kind: "input" as const, source: generated.id, target: generation.id, order: 1 }, { id: "wrong-result", kind: "result" as const, source: generation.id, target: text.id }], batches: [{ id: "batch-success", generationNodeId: generation.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1 as const, instruction: "", inputs: [], executions: [{ id: "execution-success", modelId: "model", status: "success" as const, startedAt: clock.now().toISOString() }] }] };
    const provenanceErrors = validateWorkspaceInvariants({ ...workspace, flows: [generatedFlow] });
    expect(provenanceErrors).toEqual(expect.arrayContaining([expect.stringContaining("invalid provenance"), expect.stringContaining("invalid endpoints")]));
    const cyclic = { nodes: [manual("cycle-a"), manual("cycle-b")], edges: [{ id: "a-b", kind: "result" as const, source: "cycle-a", target: "cycle-b" }, { id: "b-a", kind: "result" as const, source: "cycle-b", target: "cycle-a" }], batches: [], id: "cycle-flow", name: "cycle", viewport: { x: 0, y: 0, zoom: 1 }, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() };
    expect(hasDirectedPath(cyclic, "cycle-a", "missing")).toBe(false);
  });

  it("covers reducer no-op paths, single-flow reset, and history bounds", () => {
    const workspace = starter();
    const flow = workspace.flows[0]!;
    const generation = flow.nodes[1]!;
    const reducerContext = { idFactory: id, clock };
    expect(activeFlow({ ...workspace, activeFlowId: "missing" })?.id).toBe(flow.id);
    expect(reduceWorkspace(workspace, { type: "flow/activate", flowId: "missing" }, reducerContext)).toBe(workspace);
    const reset = reduceWorkspace(workspace, { type: "flow/delete", flowId: flow.id }, reducerContext);
    expect(reset.flows).toHaveLength(1);
    expect(reduceWorkspace(workspace, { type: "node/delete", flowId: flow.id, nodeId: "missing" }, reducerContext)).toEqual(expect.objectContaining({ flows: expect.any(Array) }));
    expect(reduceWorkspace(workspace, { type: "input/add", flowId: flow.id, edge: { id: "result", kind: "result", source: generation.id, target: flow.nodes[0]!.id } }, reducerContext)).toEqual(expect.objectContaining({ flows: expect.any(Array) }));
    expect(reduceWorkspace(workspace, { type: "input/reconnect", flowId: flow.id, edgeId: "missing", source: flow.nodes[0]!.id, target: generation.id }, reducerContext)).toEqual(expect.objectContaining({ flows: expect.any(Array) }));
    expect(reduceWorkspace(workspace, { type: "input/move", flowId: flow.id, edgeId: "missing", direction: "up" }, reducerContext)).toEqual(expect.objectContaining({ flows: expect.any(Array) }));
    let history = emptyHistory();
    for (let index = 0; index < LIMITS.maxHistoryEntries + 1; index += 1) history = pushHistory(history, { ...workspace, updatedAt: `${index}` });
    expect(history.past).toHaveLength(LIMITS.maxHistoryEntries);
    expect(pushHistory(emptyHistory(), { ...workspace, updatedAt: "x".repeat(LIMITS.maxHistoryBytes + 1) })).toEqual(emptyHistory());
    const large = { ...workspace, flows: [{ ...flow, nodes: [...flow.nodes, ...Array.from({ length: 248 }, (_, index) => manual(`parse-large-${index}`, "x".repeat(64 * 1024)))] }] };
    expect(() => parseWorkspaceExport({ format: "devneya-flow-v1", exportedAt: clock.now().toISOString(), workspace: large })).toThrow("too large");
  });

});
