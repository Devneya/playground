import { describe, expect, it } from "vitest";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { createWorkspaceExport, parseWorkspaceExport } from "../../src/domain/exportFormat";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { reduceWorkspace } from "../../src/domain/workspaceReducer";
import { emptyHistory, isHistoryAction, pushHistory } from "../../src/domain/workspaceHistory";
import { CHAT_GAP, cardHeight } from "../../src/domain/spatialLayout";
import { RESULT_COL_STRIDE } from "../../src/domain/resultPlacement";
import type { Clock, ExecutionBatch, IdFactory, PlaygroundNode, WorkspaceDocument } from "../../src/domain/types";

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

  it("applies a live default model only to empty never-run prompts", () => {
    const initial = createStarterWorkspace(ids, clock);
    const firstFlow = initial.flows[0]!;
    const starterPrompt = firstFlow.nodes[0]!;
    if (starterPrompt.data.kind !== "generation") throw new Error("Starter workspace is missing its generation prompt");

    const selectedPrompt: PlaygroundNode = {
      ...starterPrompt,
      id: "selected-prompt",
      position: { x: 600, y: 120 },
      data: { ...starterPrompt.data, modelIds: ["selected-model"] },
    };
    const sentPrompt: PlaygroundNode = {
      ...starterPrompt,
      id: "sent-prompt",
      position: { x: 1120, y: 120 },
      data: { ...starterPrompt.data, modelIds: [] },
    };
    const sentBatch: ExecutionBatch = {
      id: "sent-batch",
      generationNodeId: sentPrompt.id,
      startedAt: clock.now().toISOString(),
      promptFormatVersion: 1,
      instruction: "Already sent",
      inputs: [],
      executions: [{ id: "sent-execution", modelId: "sent-model", status: "success", startedAt: clock.now().toISOString() }],
    };
    const first: WorkspaceDocument = {
      ...initial,
      flows: [{ ...firstFlow, nodes: [starterPrompt, selectedPrompt, sentPrompt], batches: [sentBatch] }],
    };
    const secondFlow: WorkspaceDocument["flows"][number] = {
      ...firstFlow,
      id: "second-flow",
      nodes: [{ ...starterPrompt, id: "second-empty-prompt", position: { x: 80, y: 420 } }],
      batches: [],
    };
    const workspace = { ...first, flows: [...first.flows, secondFlow] };

    const action = { type: "workspace/default-model", modelId: "live-model" } as const;
    const next = reduceWorkspace(workspace, action, context);
    const nextFirst = next.flows[0]!;
    const nextSecond = next.flows[1]!;

    expect(nextFirst.nodes.find((node) => node.id === starterPrompt.id)?.data).toMatchObject({ modelIds: ["live-model"] });
    expect(nextFirst.nodes.find((node) => node.id === selectedPrompt.id)?.data).toMatchObject({ modelIds: ["selected-model"] });
    expect(nextFirst.nodes.find((node) => node.id === sentPrompt.id)?.data).toMatchObject({ modelIds: [] });
    expect(nextFirst.batches).toEqual([sentBatch]);
    expect(nextSecond.nodes.find((node) => node.id === "second-empty-prompt")?.data).toMatchObject({ modelIds: ["live-model"] });
    expect(isHistoryAction(action)).toBe(false);
  });

  it("treats a missing default model as a history-excluded no-op", () => {
    const initial = createStarterWorkspace(ids, clock);
    const action = { type: "workspace/default-model", modelId: "" } as const;

    expect(reduceWorkspace(initial, action, context)).toBe(initial);
    expect(isHistoryAction(action)).toBe(false);
  });

  it("extracts an editable note without moving the source or its follower", () => {
    const initial = createStarterWorkspace(ids, clock);
    const baseFlow = initial.flows[0]!;
    const root = baseFlow.nodes[0]!;
    const source: PlaygroundNode = {
      id: "answer",
      position: { x: root.position.x, y: root.position.y + cardHeight(root) + CHAT_GAP },
      placement: { anchorId: root.id, offsetX: 0, direction: "below" },
      data: { kind: "text", origin: "generated", title: "model-a", text: "An answer worth keeping", batchId: "answer-batch", executionId: "answer-execution" },
      createdAt: clock.now().toISOString(),
      updatedAt: clock.now().toISOString(),
    };
    const follower: PlaygroundNode = {
      ...root,
      id: "follower",
      position: { x: source.position.x, y: source.position.y + cardHeight(source) + CHAT_GAP },
      placement: { anchorId: source.id, offsetX: 0, direction: "below" },
      data: { ...root.data, title: "Generation 2" },
    };
    const existingRight: PlaygroundNode = {
      ...root,
      id: "existing-right",
      position: { x: source.position.x + RESULT_COL_STRIDE, y: source.position.y },
      data: { kind: "text", origin: "manual", title: "Existing card", text: "Keep this card" },
    };
    const batch: ExecutionBatch = {
      id: "answer-batch",
      generationNodeId: root.id,
      startedAt: clock.now().toISOString(),
      promptFormatVersion: 1,
      instruction: "",
      inputs: [],
      executions: [{ id: "answer-execution", modelId: "model-a", status: "success", startedAt: clock.now().toISOString(), outputNodeId: source.id }],
    };
    const flow = {
      ...baseFlow,
      nodes: [root, source, follower, existingRight],
      edges: [
        { id: "result-edge", kind: "result" as const, source: root.id, target: source.id },
        { id: "follower-edge", kind: "input" as const, source: source.id, target: follower.id, order: 0 },
      ],
      batches: [batch],
    };
    const workspace: WorkspaceDocument = { ...initial, flows: [flow] };
    const contextWithNoteId = { ...context, idFactory: (() => "note-id") as IdFactory };

    const next = reduceWorkspace(workspace, { type: "node/extract-note", flowId: flow.id, sourceNodeId: source.id }, contextWithNoteId);
    const nextFlow = next.flows[0]!;
    const note = nextFlow.nodes.find((node) => node.id === "note-id");

    expect(note).toMatchObject({
      id: "note-id",
      position: { x: source.position.x + RESULT_COL_STRIDE, y: source.position.y - cardHeight(source) - CHAT_GAP },
      placement: { anchorId: source.id, offsetX: RESULT_COL_STRIDE, direction: "above" },
      data: {
        kind: "text",
        origin: "manual",
        title: "Note · model-a",
        text: "An answer worth keeping",
        source: {
          nodeId: source.id,
          batchId: "answer-batch",
          executionId: "answer-execution",
          modelId: "model-a",
          instruction: "",
          text: "An answer worth keeping",
        },
      },
    });
    expect(nextFlow.nodes.find((node) => node.id === source.id)?.position).toEqual(source.position);
    expect(nextFlow.nodes.find((node) => node.id === follower.id)?.position).toEqual(follower.position);
    expect(nextFlow.edges).toEqual(flow.edges);
    expect(nextFlow.batches).toEqual(flow.batches);

    const edited = reduceWorkspace(next, { type: "node/edit-text", flowId: flow.id, nodeId: "note-id", text: "A shorter edited note" }, context);
    const editedNote = edited.flows[0]!.nodes.find((node) => node.id === "note-id")!;
    expect(editedNote.data).toMatchObject({
      text: "A shorter edited note",
      source: {
        nodeId: source.id,
        batchId: "answer-batch",
        executionId: "answer-execution",
        modelId: "model-a",
        instruction: "",
        text: "An answer worth keeping",
      },
    });

    const sourceDeleted = reduceWorkspace(edited, { type: "node/delete", flowId: flow.id, nodeId: source.id }, context);
    const deletedFlow = sourceDeleted.flows[0]!;
    const survivingNote = deletedFlow.nodes.find((node) => node.id === "note-id")!;
    expect(deletedFlow.nodes.some((node) => node.id === source.id)).toBe(false);
    expect(survivingNote.data).toMatchObject({
      kind: "text",
      origin: "manual",
      text: "A shorter edited note",
      source: {
        nodeId: source.id,
        batchId: "answer-batch",
        executionId: "answer-execution",
        modelId: "model-a",
        instruction: "",
        text: "An answer worth keeping",
      },
    });

    const roundTripped = parseWorkspaceExport(createWorkspaceExport(sourceDeleted, clock)).workspace;
    expect(roundTripped.flows[0]!.nodes.find((node) => node.id === "note-id")?.data).toEqual(survivingNote.data);

    let duplicateIndex = 0;
    const duplicate = duplicateFlowWithFreshIds(nextFlow, () => `copy-${duplicateIndex++}`, clock);
    const duplicateNote = duplicate.nodes.find((node) => node.id === "copy-4")!;
    expect(duplicateNote.placement).toEqual({ anchorId: "copy-1", offsetX: RESULT_COL_STRIDE, direction: "above" });
    expect(duplicateNote.data).toMatchObject({
      source: {
        nodeId: "copy-1",
        batchId: "copy-7",
        executionId: "copy-8",
        modelId: "model-a",
        instruction: "",
        text: "An answer worth keeping",
      },
    });
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
