import { describe, expect, it } from "vitest";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { reduceWorkspace } from "../../src/domain/workspaceReducer";
import { emptyHistory, isHistoryAction, pushHistory } from "../../src/domain/workspaceHistory";
import type { Clock, IdFactory } from "../../src/domain/types";

const ids = (() => { let index = 0; return () => `id-${index++}`; })();
const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
const context = { idFactory: ids as IdFactory, clock };

describe("workspace reducer", () => {
  it("creates, activates, duplicates, and deletes named flows", () => {
    const initial = createStarterWorkspace(ids, clock);
    const second = { ...initial.flows[0]!, id: "second", name: "Second" };
    const withSecond = reduceWorkspace(initial, { type: "flow/create", flow: second }, context);
    expect(withSecond.activeFlowId).toBe("second");
    const back = reduceWorkspace(withSecond, { type: "flow/activate", flowId: initial.flows[0]!.id }, context);
    expect(back.activeFlowId).toBe(initial.flows[0]!.id);
    const deleted = reduceWorkspace(back, { type: "flow/delete", flowId: initial.flows[0]!.id }, context);
    expect(deleted.flows).toHaveLength(1);
    expect(deleted.activeFlowId).toBe("second");
  });
  it("persists the viewport into the flow without recording undo history", () => {
    const initial = createStarterWorkspace(ids, clock);
    const flowId = initial.flows[0]!.id;
    const viewport = { x: 120, y: -80, zoom: 0.6 };
    const updated = reduceWorkspace(initial, { type: "viewport/update", flowId, viewport }, context);
    expect(updated.flows[0]!.viewport).toEqual(viewport);

    // The viewport action must not create an undo entry: mirroring the
    // WorkspaceContext dispatch, only history actions push onto the past stack.
    let history = emptyHistory();
    const viewportAction = { type: "viewport/update", flowId, viewport } as const;
    if (isHistoryAction(viewportAction)) history = pushHistory(history, initial);
    expect(history.past).toHaveLength(0);

    // A genuine history action (node/move) still records an entry for contrast.
    const moveAction = { type: "node/move", flowId, nodeId: "n", position: { x: 1, y: 1 } } as const;
    expect(isHistoryAction(moveAction)).toBe(true);
    if (isHistoryAction(moveAction)) history = pushHistory(history, initial);
    expect(history.past).toHaveLength(1);
  });

  it("marks pending executions interrupted on reload", async () => {
    const { normalizeInterruptedBatches } = await import("../../src/domain/workspaceReducer");
    const workspace = createStarterWorkspace(ids, clock);
    const flow = workspace.flows[0]!;
    const pending = { id: "batch", generationNodeId: flow.nodes[0]!.id, startedAt: clock.now().toISOString(), promptFormatVersion: 1 as const, instruction: "", inputs: [], executions: [{ id: "execution", modelId: "model", status: "pending" as const, startedAt: clock.now().toISOString(), outputNodeId: "output" }] };
    const result = normalizeInterruptedBatches({ ...workspace, flows: [{ ...flow, batches: [pending] }] }, clock);
    expect(result.flows[0]!.batches[0]!.executions[0]!.status).toBe("failed");
    expect(result.flows[0]!.batches[0]!.executions[0]!.error?.kind).toBe("interrupted");
  });
});
