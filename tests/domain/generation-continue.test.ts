import { describe, expect, it } from "vitest";
import { reduceWorkspace } from "../../src/domain/workspaceReducer";
import { emptyHistory, isHistoryAction, pushHistory } from "../../src/domain/workspaceHistory";
import type { Clock, IdFactory, WorkspaceDocument } from "../../src/domain/types";
import { RESULT_COL_STRIDE, RESULT_TO_CONTINUATION_STRIDE } from "../../src/domain/resultPlacement";
import { cardHeight, CHAT_GAP } from "../../src/domain/spatialLayout";

const ids = (() => { let index = 0; return () => `id-${index++}`; })();
const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const context = { idFactory: ids as IdFactory, clock };

const buildWorkspace = (): WorkspaceDocument => ({
  schemaVersion: 3,
  activeFlowId: "flow-1",
  createdAt: clock.now().toISOString(),
  updatedAt: clock.now().toISOString(),
  flows: [{
    id: "flow-1",
    name: "Flow",
    nodes: [
      { id: "gen-1", position: { x: 0, y: 0 }, data: { kind: "generation", title: "Generation 1", instruction: "", modelIds: ["m1", "m2"] }, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() },
      { id: "res-1", position: { x: 100, y: 100 }, data: { kind: "text", origin: "generated", title: "Result 1", text: "hello", batchId: "batch-1", executionId: "exec-1" }, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() },
    ],
    edges: [],
    batches: [{
      id: "batch-1",
      generationNodeId: "gen-1",
      startedAt: clock.now().toISOString(),
      promptFormatVersion: 1,
      instruction: "",
      inputs: [],
      executions: [{ id: "exec-1", modelId: "m1", status: "success", startedAt: clock.now().toISOString(), completedAt: clock.now().toISOString(), durationMs: 1, outputNodeId: "res-1" }],
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: clock.now().toISOString(),
    updatedAt: clock.now().toISOString(),
  }],
});

describe("generation/continue", () => {
  it("duplicates the frozen sent prompt without copying its answer into context", () => {
    const initial = buildWorkspace();
    const batch = initial.flows[0]!.batches[0]!;
    batch.instruction = "Original question";
    batch.context = [{ role: "user", content: "Earlier context", nodeId: "prior" }];
    const next = reduceWorkspace(initial, { type: "generation/duplicate", flowId: "flow-1", sourceNodeId: "gen-1" }, context);
    const copy = next.flows[0]!.nodes.at(-1)!;
    expect(copy.data).toMatchObject({ kind: "generation", instruction: "Original question", modelIds: ["m1"], context: batch.context, branchedFrom: { nodeId: "gen-1", batchId: "batch-1" } });
    expect(copy.position.x).toBeGreaterThan(initial.flows[0]!.nodes[0]!.position.x);
    expect(next.flows[0]!.nodes.slice(0, 2)).toEqual(initial.flows[0]!.nodes);
    expect(next.flows[0]!.batches).toEqual(initial.flows[0]!.batches);
    expect(next.flows[0]!.edges.some((edge) => edge.source === "res-1" && edge.target === copy.id)).toBe(false);
  });

  it("adds one generation and input edge, defaulting to the answer's model", () => {
    const initial = buildWorkspace();
    const result = reduceWorkspace(initial, { type: "generation/continue", flowId: "flow-1", sourceNodeId: "res-1" }, context);
    const flow = result.flows[0]!;
    expect(flow.nodes).toHaveLength(3);
    expect(flow.edges).toHaveLength(1);

    const newGen = flow.nodes.find((node) => node.id !== "gen-1" && node.id !== "res-1")!;
    expect(newGen.data).toMatchObject({ kind: "generation", title: "Generation 2", instruction: "", modelIds: ["m1"] });
    // First continuation descends directly below the result; later forks
    // from the same result open a parallel column (the branch index).
    expect(newGen.position).toEqual({ x: 100, y: 100 + cardHeight(initial.flows[0]!.nodes[1]!) + CHAT_GAP });

    const edge = flow.edges[0]!;
    expect(edge).toMatchObject({ kind: "input", source: "res-1", target: newGen.id, sourceHandle: "flow-bottom", targetHandle: "flow-top" });

    // Nothing else changed: the original generation and result remain.
    expect(flow.nodes.find((node) => node.id === "gen-1")).toBeDefined();
    expect(flow.nodes.find((node) => node.id === "res-1")).toBeDefined();
  });

  it("is recorded as a single undo history entry", () => {
    const initial = buildWorkspace();
    const action = { type: "generation/continue", flowId: "flow-1", sourceNodeId: "res-1" } as const;
    expect(isHistoryAction(action)).toBe(true);
    let history = emptyHistory();
    if (isHistoryAction(action)) history = pushHistory(history, initial);
    expect(history.past).toHaveLength(1);
  });

  it("is a no-op when the source is not a successful generated result", () => {
    // Source is a manual Text node, not a generated result.
    const manual = buildWorkspace();
    manual.flows[0]!.nodes[1]!.data = { kind: "text", origin: "manual", title: "Manual", text: "x" };
    const afterManual = reduceWorkspace(manual, { type: "generation/continue", flowId: "flow-1", sourceNodeId: "res-1" }, context);
    expect(afterManual).toBe(manual);

    // Source is a generated result whose execution failed.
    const failed = buildWorkspace();
    failed.flows[0]!.batches[0]!.executions[0]!.status = "failed";
    const afterFailed = reduceWorkspace(failed, { type: "generation/continue", flowId: "flow-1", sourceNodeId: "res-1" }, context);
    expect(afterFailed).toBe(failed);
  });

  it("never auto-spawns a continuation at the reducer level (only the explicit action does)", () => {
    const initial = buildWorkspace();
    // A full run lifecycle driven purely through the reducer must not create
    // generation nodes — auto-continuation is an execution-path concern only.
    const afterSucceeded = reduceWorkspace(
      initial,
      { type: "execution/succeeded", flowId: "flow-1", batchId: "batch-1", executionId: "exec-1", text: "hi", durationMs: 1 },
      context,
    );
    const afterCompleted = reduceWorkspace(
      afterSucceeded,
      { type: "batch/completed", flowId: "flow-1", batchId: "batch-1", completedAt: clock.now().toISOString() },
      context,
    );
    expect(afterCompleted.flows[0]!.nodes).toHaveLength(2);
    expect(afterCompleted.flows[0]!.edges).toHaveLength(0);

    // An imported workspace is left untouched — no continuation spawn.
    const imported = reduceWorkspace(initial, { type: "workspace/imported", workspace: initial }, context);
    expect(imported.flows[0]!.nodes).toHaveLength(2);
  });
  it("forks a second continuation from the same result into a parallel column", () => {
    const initial = buildWorkspace();
    const first = reduceWorkspace(initial, { type: "generation/continue", flowId: "flow-1", sourceNodeId: "res-1" }, context);
    const firstGen = first.flows[0]!.nodes.find((node) => node.id !== "gen-1" && node.id !== "res-1")!;
    expect(firstGen.position).toEqual({ x: 100, y: 100 + cardHeight(initial.flows[0]!.nodes[1]!) + CHAT_GAP });

    const second = reduceWorkspace(first, { type: "generation/continue", flowId: "flow-1", sourceNodeId: "res-1" }, context);
    const secondGen = second.flows[0]!.nodes.find((node) => node.id !== "gen-1" && node.id !== "res-1" && node.id !== firstGen.id)!;
    // Second continuation forks one column to the right, sharing the first's y.
    expect(secondGen.position).toEqual({ x: 100 + RESULT_COL_STRIDE, y: firstGen.position.y });
    expect(second.flows[0]!.edges).toHaveLength(2);
  });
  it("never overlaps a sibling auto-continuation when forking a 2-model result", () => {
    // Mirrors the user's natural 2-model flow: a Generation with two models
    // produces two side-by-side results (model-a @ col 0, model-b @ col 1) and
    // two auto-continuations (gen-a below model-a, gen-b below model-b). The
    // model-a result already carries one input edge (to gen-a), so branchIndex
    // is 1 and the naive placement would drop the fork one RESULT_COL_STRIDE
    // to the right — exactly on top of gen-b. The scan must skip to the next free
    // column.
    const initial = buildTwoModelWorkspace();
    const result = reduceWorkspace(initial, { type: "generation/continue", flowId: "flow-1", sourceNodeId: "res-a" }, context);
    const flow = result.flows[0]!;

    const newGen = flow.nodes.find((node) => !["gen-1", "res-a", "res-b", "gen-a", "gen-b"].includes(node.id))!;
    // source res-a at x:0; branchIndex 1 collides with gen-b at one stride; the
    // first free column is k=2, still on the continuation row.
    expect(newGen.position).toEqual({ x: 0 + 2 * RESULT_COL_STRIDE, y: 300 + cardHeight(initial.flows[0]!.nodes[1]!) + CHAT_GAP });

    // No two nodes share a (x, y) slot.
    const slots = new Set(flow.nodes.map((node) => `${node.position.x},${node.position.y}`));
    expect(slots.size).toBe(flow.nodes.length);

    // The branchIndex-only placement would have collided with gen-b. If someone
    // reverts the scan, newGen.x === RESULT_COL_STRIDE and two nodes share that
    // slot, so this
    // pair of assertions fails — proving the test guards the fix.
    const collisionX = 0 + 1 * RESULT_COL_STRIDE;
    expect(flow.nodes.some((node) => node.position.x === collisionX && node.position.y === 300 + RESULT_TO_CONTINUATION_STRIDE)).toBe(true);
    expect(newGen.position.x).not.toBe(collisionX);
  });
});

const buildTwoModelWorkspace = (): WorkspaceDocument => ({
  schemaVersion: 3,
  activeFlowId: "flow-1",
  createdAt: clock.now().toISOString(),
  updatedAt: clock.now().toISOString(),
  flows: [{
    id: "flow-1",
    name: "Flow",
    nodes: [
      { id: "gen-1", position: { x: 0, y: 0 }, data: { kind: "generation", title: "Generation 1", instruction: "", modelIds: ["model-a", "model-b"] }, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() },
      { id: "res-a", position: { x: 0, y: 300 }, data: { kind: "text", origin: "generated", title: "model-a", text: "a", batchId: "batch-1", executionId: "exec-a" }, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() },
      { id: "res-b", position: { x: RESULT_COL_STRIDE, y: 300 }, data: { kind: "text", origin: "generated", title: "model-b", text: "b", batchId: "batch-1", executionId: "exec-b" }, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() },
      { id: "gen-a", position: { x: 0, y: 465 }, data: { kind: "generation", title: "Generation 2", instruction: "", modelIds: ["model-a", "model-b"] }, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() },
      { id: "gen-b", position: { x: RESULT_COL_STRIDE, y: 465 }, data: { kind: "generation", title: "Generation 3", instruction: "", modelIds: ["model-a", "model-b"] }, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() },
    ],
    edges: [
      { id: "re-a", kind: "result", source: "gen-1", target: "res-a", sourceHandle: "flow-bottom", targetHandle: "flow-top" },
      { id: "re-b", kind: "result", source: "gen-1", target: "res-b", sourceHandle: "flow-bottom", targetHandle: "flow-top" },
      { id: "ie-a", kind: "input", source: "res-a", target: "gen-a", sourceHandle: "flow-bottom", targetHandle: "flow-top", order: 0 },
      { id: "ie-b", kind: "input", source: "res-b", target: "gen-b", sourceHandle: "flow-bottom", targetHandle: "flow-top", order: 0 },
    ],
    batches: [{
      id: "batch-1",
      generationNodeId: "gen-1",
      startedAt: clock.now().toISOString(),
      promptFormatVersion: 1,
      instruction: "",
      inputs: [],
      executions: [
        { id: "exec-a", modelId: "model-a", status: "success", startedAt: clock.now().toISOString(), completedAt: clock.now().toISOString(), durationMs: 1, outputNodeId: "res-a" },
        { id: "exec-b", modelId: "model-b", status: "success", startedAt: clock.now().toISOString(), completedAt: clock.now().toISOString(), durationMs: 1, outputNodeId: "res-b" },
      ],
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: clock.now().toISOString(),
    updatedAt: clock.now().toISOString(),
  }],
});
