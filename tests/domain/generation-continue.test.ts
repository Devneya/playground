import { describe, expect, it } from "vitest";
import { reduceWorkspace } from "../../src/domain/workspaceReducer";
import { emptyHistory, isHistoryAction, pushHistory } from "../../src/domain/workspaceHistory";
import type { Clock, IdFactory, WorkspaceDocument } from "../../src/domain/types";

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
  it("adds exactly one generation node and one input edge, copying parent modelIds", () => {
    const initial = buildWorkspace();
    const result = reduceWorkspace(initial, { type: "generation/continue", flowId: "flow-1", sourceNodeId: "res-1" }, context);
    const flow = result.flows[0]!;
    expect(flow.nodes).toHaveLength(3);
    expect(flow.edges).toHaveLength(1);

    const newGen = flow.nodes.find((node) => node.id !== "gen-1" && node.id !== "res-1")!;
    expect(newGen.data).toMatchObject({ kind: "generation", title: "Generation 2", instruction: "", modelIds: ["m1", "m2"] });
    // First continuation descends directly below the result; later Continues
    // from the same result fork into a parallel column (the branch index).
    // res at (100,100); RESULT_TO_CONTINUATION_STRIDE = 160 → y 260.
    expect(newGen.position).toEqual({ x: 100, y: 260 });

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
    // First continuation sits directly below the result (res at x:100,y:100, stride 160).
    expect(firstGen.position).toEqual({ x: 100, y: 260 });

    const second = reduceWorkspace(first, { type: "generation/continue", flowId: "flow-1", sourceNodeId: "res-1" }, context);
    const secondGen = second.flows[0]!.nodes.find((node) => node.id !== "gen-1" && node.id !== "res-1" && node.id !== firstGen.id)!;
    // Second continuation forks one column to the right (RESULT_COL_STRIDE = 520), sharing the first's y.
    expect(secondGen.position).toEqual({ x: 620, y: 260 });
    expect(second.flows[0]!.edges).toHaveLength(2);
  });
});
