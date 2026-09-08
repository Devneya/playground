import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceExport, parseWorkspaceExport } from "../../src/domain/exportFormat";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { LAYOUT, RESULT_COL_STRIDE } from "../../src/domain/resultPlacement";
import { CHAT_GAP, cardHeight, layoutAutomaticNodes } from "../../src/domain/spatialLayout";
import { reduceWorkspace } from "../../src/domain/workspaceReducer";
import { IndexedDbWorkspaceRepository } from "../../src/persistence/IndexedDbWorkspaceRepository";
import type {
  Clock,
  ExecutionBatch,
  FlowDocument,
  GenerationData,
  IdFactory,
  PlaygroundNode,
  WorkspaceDocument,
} from "../../src/domain/types";

const stamp = "2026-01-01T00:00:00.000Z";
const clock: Clock = { now: () => new Date(stamp) };
const repository = new IndexedDbWorkspaceRepository();

const makeNode = (
  id: string,
  data: PlaygroundNode["data"],
  position: { x: number; y: number },
  extras: Pick<PlaygroundNode, "measuredHeight" | "placement"> = {},
): PlaygroundNode => ({ id, position, ...extras, data, createdAt: stamp, updatedAt: stamp });

const generation = (
  id: string,
  position: { x: number; y: number },
  instruction = "",
  modelIds = ["model-a"],
  extras: Pick<PlaygroundNode, "measuredHeight" | "placement"> = {},
): PlaygroundNode => makeNode(id, { kind: "generation", title: id, instruction, modelIds }, position, extras);

const manual = (id: string, position: { x: number; y: number }, text = id): PlaygroundNode =>
  makeNode(id, { kind: "text", origin: "manual", title: id, text }, position);

const result = (
  id: string,
  position: { x: number; y: number },
  batchId = "batch-1",
  executionId = "execution-1",
  modelId = "model-a",
  extras: Pick<PlaygroundNode, "measuredHeight" | "placement"> = {},
): PlaygroundNode =>
  makeNode(id, { kind: "text", origin: "generated", title: modelId, text: `${id} output`, batchId, executionId }, position, extras);

const makeFlow = (
  nodes: PlaygroundNode[],
  edges: FlowDocument["edges"] = [],
  batches: ExecutionBatch[] = [],
): FlowDocument => ({
  id: "flow-1",
  name: "Flow",
  nodes,
  edges,
  batches,
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: stamp,
  updatedAt: stamp,
});

const makeWorkspace = (flow: FlowDocument): WorkspaceDocument => ({
  schemaVersion: 3,
  activeFlowId: flow.id,
  flows: [flow],
  createdAt: stamp,
  updatedAt: stamp,
});

const reducerContext = (prefix = "generated") => {
  let index = 0;
  const idFactory: IdFactory = () => `${prefix}-${index++}`;
  return { idFactory, clock };
};

const nodeById = (flow: FlowDocument, id: string): PlaygroundNode => {
  const node = flow.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  return node;
};

const overlaps = (first: PlaygroundNode, second: PlaygroundNode) =>
  first.position.x < second.position.x + LAYOUT.nodeWidth &&
  first.position.x + LAYOUT.nodeWidth > second.position.x &&
  first.position.y < second.position.y + cardHeight(second) &&
  first.position.y + cardHeight(first) > second.position.y;

const expectNoCardOverlaps = (flow: FlowDocument) => {
  for (let firstIndex = 0; firstIndex < flow.nodes.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < flow.nodes.length; secondIndex += 1) {
      expect(overlaps(flow.nodes[firstIndex]!, flow.nodes[secondIndex]!)).toBe(false);
    }
  }
};

describe("spatial layout", () => {
  beforeEach(async () => repository.clearAllBrowserData());

  it("uses measured heights and an 8px gap for long result chains", () => {
    const flow = makeFlow([
      generation("root", { x: 0, y: 0 }),
      result("answer", { x: 0, y: 100 }, "batch-1", "execution-1", "model-a", {
        placement: { anchorId: "root", offsetX: 0, direction: "below" },
      }),
      generation("continuation", { x: 0, y: 100 }, "", ["model-a"], {
        placement: { anchorId: "answer", offsetX: 0, direction: "below" },
      }),
    ]);
    const workspace = makeWorkspace(flow);

    const measured = reduceWorkspace(
      workspace,
      {
        type: "node/measure",
        flowId: flow.id,
        sizes: [
          { id: "root", height: 320 },
          { id: "answer", height: 720 },
          { id: "continuation", height: 240 },
        ],
      },
      reducerContext(),
    );
    const laidOut = measured.flows[0]!;
    const root = nodeById(laidOut, "root");
    const answer = nodeById(laidOut, "answer");
    const continuation = nodeById(laidOut, "continuation");

    expect(answer.position.y - (root.position.y + cardHeight(root))).toBe(CHAT_GAP);
    expect(continuation.position.y - (answer.position.y + cardHeight(answer))).toBe(CHAT_GAP);
    expect(answer.position.y).toBe(320 + CHAT_GAP);
    expect(continuation.position.y).toBe(320 + CHAT_GAP + 720 + CHAT_GAP);
  });

  it("detaches a moved node and its direct anchored children", () => {
    const flow = makeFlow([
      generation("root", { x: 0, y: 0 }),
      generation("child", { x: 16, y: 256 }, "", ["model-a"], {
        placement: { anchorId: "root", offsetX: 16, direction: "below" },
      }),
      generation("grandchild", { x: 32, y: 512 }, "", ["model-a"], {
        placement: { anchorId: "child", offsetX: 16, direction: "below" },
      }),
    ]);
    const workspace = makeWorkspace(flow);

    const moved = reduceWorkspace(
      workspace,
      { type: "node/move", flowId: flow.id, nodeId: "root", position: { x: 900, y: 120 } },
      reducerContext(),
    ).flows[0]!;

    expect(nodeById(moved, "root").position).toEqual({ x: 900, y: 120 });
    expect(nodeById(moved, "root").placement).toBeUndefined();
    expect(nodeById(moved, "child").placement).toBeUndefined();
    expect(nodeById(moved, "grandchild").placement).toEqual({ anchorId: "child", offsetX: 16, direction: "below" });
    expect(nodeById(moved, "child").position).toEqual({ x: 16, y: 256 });
    expect(nodeById(moved, "grandchild").position).toEqual({ x: 32, y: 512 });
  });

  it("does not move manually detached cards when another card is measured", () => {
    const flow = makeFlow([
      generation("root", { x: 0, y: 0 }),
      result("answer", { x: 0, y: 256 }, "batch-1", "execution-1", "model-a", {
        placement: { anchorId: "root", offsetX: 0, direction: "below" },
      }),
      generation("continuation", { x: 0, y: 363 }, "", ["model-a"], {
        placement: { anchorId: "answer", offsetX: 0, direction: "below" },
      }),
    ]);
    const workspace = makeWorkspace(flow);
    const manuallyMoved = reduceWorkspace(
      workspace,
      { type: "node/move", flowId: flow.id, nodeId: "answer", position: { x: 1000, y: 40 } },
      reducerContext(),
    );
    const beforeMeasure = manuallyMoved.flows[0]!;

    const afterMeasure = reduceWorkspace(
      manuallyMoved,
      {
        type: "node/measure",
        flowId: flow.id,
        sizes: [
          { id: "root", height: 900 },
          { id: "answer", height: 700 },
          { id: "continuation", height: 240 },
        ],
      },
      reducerContext(),
    ).flows[0]!;

    expect(nodeById(afterMeasure, "answer").position).toEqual({ x: 1000, y: 40 });
    expect(nodeById(afterMeasure, "continuation").position).toEqual(nodeById(beforeMeasure, "continuation").position);
    expect(nodeById(afterMeasure, "answer").placement).toBeUndefined();
    expect(nodeById(afterMeasure, "continuation").placement).toBeUndefined();
  });

  it("branches from a successful answer with frozen instruction, context, and model", () => {
    const context = [
      { role: "user" as const, content: "first input", nodeId: "input" },
      { role: "user" as const, content: "original instruction", nodeId: "root" },
      { role: "assistant" as const, content: "answer", nodeId: "answer", modelId: "model-a" },
    ];
    const flow = makeFlow(
      [
        manual("input", { x: -520, y: 0 }, "first input"),
        generation("root", { x: 0, y: 0 }, "edited parent instruction", ["model-a", "model-b"]),
        result("answer", { x: 0, y: 256 }, "batch-1", "execution-1", "model-a", {
          placement: { anchorId: "root", offsetX: 0, direction: "below" },
        }),
      ],
      [
        { id: "input-edge", kind: "input", source: "input", target: "root", order: 0 },
        { id: "result-edge", kind: "result", source: "root", target: "answer" },
      ],
      [{
        id: "batch-1",
        generationNodeId: "root",
        startedAt: stamp,
        promptFormatVersion: 2,
        instruction: "original instruction",
        inputs: [{ nodeId: "input", title: "input", text: "first input" }],
        context,
        executions: [{ id: "execution-1", modelId: "model-a", status: "success", startedAt: stamp, completedAt: stamp, outputNodeId: "answer" }],
      }],
    );
    const workspace = makeWorkspace(flow);
    const branched = reduceWorkspace(
      workspace,
      { type: "generation/branch", flowId: flow.id, sourceNodeId: "answer" },
      reducerContext("branch"),
    );
    const branchedFlow = branched.flows[0]!;
    const branch = branchedFlow.nodes.find((node) => node.id !== "root" && node.id !== "answer" && node.id !== "input")!;

    expect(branch.position).toEqual({ x: RESULT_COL_STRIDE, y: 0 });
    expect(branch.placement).toEqual({ anchorId: "root", offsetX: RESULT_COL_STRIDE, direction: "right" });
    expect(branch.data).toMatchObject({
      kind: "generation",
      instruction: "original instruction",
      modelIds: ["model-a"],
      context,
      branchedFrom: { nodeId: "root", batchId: "batch-1" },
    });
    expect(nodeById(branchedFlow, "root").data).toMatchObject({ instruction: "edited parent instruction", modelIds: ["model-a", "model-b"] });
    expect(branchedFlow.batches[0]).toEqual(flow.batches[0]);
    expect(branchedFlow.edges).toContainEqual(expect.objectContaining({ kind: "input", source: "input", target: branch.id, order: 0 }));

    const movedBranch = reduceWorkspace(
      branched,
      { type: "node/move", flowId: flow.id, nodeId: branch.id, position: { x: 900, y: 300 } },
      reducerContext("branch-move"),
    ).flows[0]!;
    expect(nodeById(movedBranch, branch.id).data).toEqual(branch.data);
    expect(nodeById(movedBranch, branch.id).data).toMatchObject({ branchedFrom: { nodeId: "root", batchId: "batch-1" } });
  });

  it("preserves request snapshots, edges, and models when moving a node", () => {
    const flow = makeFlow(
      [
        manual("input", { x: -520, y: 0 }, "frozen input"),
        generation("root", { x: 0, y: 0 }, "edited after request", ["model-a", "model-b"]),
        result("answer", { x: 0, y: 256 }, "batch-1", "execution-1", "model-a", {
          placement: { anchorId: "root", offsetX: 0, direction: "below" },
        }),
      ],
      [
        { id: "input-edge", kind: "input", source: "input", target: "root", order: 0 },
        { id: "result-edge", kind: "result", source: "root", target: "answer" },
      ],
      [{
        id: "batch-1",
        generationNodeId: "root",
        startedAt: stamp,
        promptFormatVersion: 1,
        instruction: "original frozen instruction",
        inputs: [{ nodeId: "input", title: "input", text: "frozen input" }],
        executions: [{ id: "execution-1", modelId: "model-a", status: "success", startedAt: stamp, completedAt: stamp, outputNodeId: "answer" }],
      }],
    );
    const workspace = makeWorkspace(flow);
    const batches = structuredClone(flow.batches);
    const edges = structuredClone(flow.edges);
    const moved = reduceWorkspace(
      workspace,
      { type: "node/move", flowId: flow.id, nodeId: "root", position: { x: 400, y: 200 } },
      reducerContext(),
    ).flows[0]!;

    expect(moved.batches).toEqual(batches);
    expect(moved.edges).toEqual(edges);
    expect(nodeById(moved, "root").data).toEqual(nodeById(flow, "root").data);
    expect(nodeById(moved, "answer").data).toEqual(nodeById(flow, "answer").data);
  });

  it("avoids fixed obstacles when resolving below and right placements", () => {
    const flow = makeFlow([
      generation("root", { x: 0, y: 0 }),
      manual("fixed-below", { x: 0, y: 256 }),
      manual("fixed-right", { x: 560, y: 0 }),
      generation("below", { x: 0, y: 256 }, "", ["model-a"], {
        placement: { anchorId: "root", offsetX: 0, direction: "below" },
      }),
      generation("right", { x: 560, y: 0 }, "", ["model-a"], {
        placement: { anchorId: "root", offsetX: 560, direction: "right" },
      }),
    ]);

    const laidOut = layoutAutomaticNodes(flow);
    const below = nodeById(laidOut, "below");
    const right = nodeById(laidOut, "right");
    const fixedBelow = nodeById(laidOut, "fixed-below");

    expect(below.position.y).toBe(fixedBelow.position.y + cardHeight(fixedBelow) + CHAT_GAP);
    expect(right.position.x).toBe(560 + RESULT_COL_STRIDE);
    expect(below.position).not.toEqual({ x: 0, y: 256 });
    expect(right.position).not.toEqual({ x: 560, y: 0 });
  });

  it("keeps an above note and right branch non-overlapping in either insertion order after measuring", () => {
    const buildScenario = (noteFirst: boolean) => {
      const root = generation("root", { x: 0, y: 0 });
      const answer = result("answer", { x: 0, y: 248 }, "batch-1", "execution-1", "model-a", {
        placement: { anchorId: root.id, offsetX: 0, direction: "below" },
      });
      const branch = generation("branch", { x: RESULT_COL_STRIDE, y: 0 }, "", ["model-a"], {
        placement: { anchorId: root.id, offsetX: RESULT_COL_STRIDE, direction: "right" },
      });
      const note = makeNode("note", {
        kind: "text",
        origin: "manual",
        title: "Note",
        text: "Saved answer",
        source: {
          nodeId: answer.id,
          batchId: "batch-1",
          executionId: "execution-1",
          modelId: "model-a",
          instruction: "Original instruction",
          text: "Saved answer",
        },
      }, { x: RESULT_COL_STRIDE, y: 0 }, {
        placement: { anchorId: answer.id, offsetX: RESULT_COL_STRIDE, direction: "above" },
      });
      const batch: ExecutionBatch = {
        id: "batch-1",
        generationNodeId: root.id,
        startedAt: stamp,
        promptFormatVersion: 1,
        instruction: "Original instruction",
        inputs: [],
        executions: [{ id: "execution-1", modelId: "model-a", status: "success", startedAt: stamp, outputNodeId: answer.id }],
      };
      const nodes = noteFirst ? [root, answer, note, branch] : [root, answer, branch, note];
      const flow = makeFlow(nodes, [{ id: "result-edge", kind: "result", source: root.id, target: answer.id }], [batch]);
      return reduceWorkspace(
        makeWorkspace(flow),
        {
          type: "node/measure",
          flowId: flow.id,
          sizes: [
            { id: root.id, height: 320 },
            { id: answer.id, height: 220 },
            { id: branch.id, height: 240 },
            { id: note.id, height: 260 },
          ],
        },
        reducerContext(noteFirst ? "note-first" : "branch-first"),
      ).flows[0]!;
    };

    const noteFirst = buildScenario(true);
    const branchFirst = buildScenario(false);
    for (const flow of [noteFirst, branchFirst]) {
      const answer = nodeById(flow, "answer");
      const note = nodeById(flow, "note");
      expect(note.position.x).toBe(answer.position.x + RESULT_COL_STRIDE);
      expectNoCardOverlaps(flow);
    }
    expect(nodeById(noteFirst, "note").position.y).toBe(nodeById(noteFirst, "answer").position.y - 260 - CHAT_GAP);
  });

  it("ignores invalid measured sizes", () => {
    const flow = makeFlow([
      generation("root", { x: 0, y: 0 }),
      generation("child", { x: 0, y: 256 }, "", ["model-a"], {
        placement: { anchorId: "root", offsetX: 0, direction: "below" },
      }),
    ]);
    const workspace = makeWorkspace(flow);
    const invalidOnly = reduceWorkspace(
      workspace,
      {
        type: "node/measure",
        flowId: flow.id,
        sizes: [
          { id: "root", height: 0 },
          { id: "child", height: -1 },
          { id: "ghost", height: 100 },
          { id: "root", height: Number.NaN },
          { id: "child", height: Number.POSITIVE_INFINITY },
        ],
      },
      reducerContext(),
    );
    expect(invalidOnly).toBe(workspace);

    const mixed = reduceWorkspace(
      workspace,
      { type: "node/measure", flowId: flow.id, sizes: [{ id: "root", height: 300 }, { id: "child", height: -50 }] },
      reducerContext(),
    ).flows[0]!;
    expect(nodeById(mixed, "root").measuredHeight).toBe(300);
    expect(nodeById(mixed, "child").measuredHeight).toBeUndefined();
    expect(nodeById(mixed, "child").position.y).toBe(300 + CHAT_GAP);
  });

  it("terminates on malformed placement cycles", () => {
    const flow = makeFlow([
      generation("a", { x: 0, y: 0 }, "", ["model-a"], {
        placement: { anchorId: "b", offsetX: 560, direction: "right" },
      }),
      generation("b", { x: 560, y: 0 }, "", ["model-a"], {
        placement: { anchorId: "a", offsetX: 0, direction: "below" },
      }),
    ]);

    expect(() => layoutAutomaticNodes(flow)).not.toThrow();
    const laidOut = layoutAutomaticNodes(flow);
    expect(laidOut.nodes).toHaveLength(2);
    expect(laidOut.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
  });

  it("leaves a placement with a missing anchor untouched", () => {
    const flow = makeFlow([
      generation("orphan", { x: 120, y: 240 }, "", ["model-a"], {
        placement: { anchorId: "removed-anchor", offsetX: 560, direction: "right" },
      }),
    ]);

    expect(layoutAutomaticNodes(flow)).toBe(flow);
    expect(nodeById(flow, "orphan").position).toEqual({ x: 120, y: 240 });
  });

  it("preserves layout and frozen GenerationData.context through export/import, persistence, and duplication", async () => {
    const context = [
      { role: "user" as const, content: "first input", nodeId: "input" },
      { role: "user" as const, content: "frozen instruction", nodeId: "root" },
      { role: "assistant" as const, content: "first answer", nodeId: "answer", modelId: "model-a" },
    ];
    const rootData: GenerationData = {
      kind: "generation",
      title: "Generation 1",
      instruction: "edited current instruction",
      modelIds: ["model-a", "model-b"],
      context,
    };
    const branchNode = generation("branch", { x: 560, y: 0 }, "frozen instruction", ["model-a"], {
      placement: { anchorId: "root", offsetX: 560, direction: "right" },
    });
    if (branchNode.data.kind === "generation") branchNode.data = { ...branchNode.data, branchedFrom: { nodeId: "root", batchId: "batch-1" } };
    const flow = makeFlow(
      [
        manual("input", { x: -520, y: 0 }, "first input"),
        makeNode("root", rootData, { x: 0, y: 0 }, { measuredHeight: 320 }),
        result("answer", { x: 0, y: 336 }, "batch-1", "execution-1", "model-a", {
          measuredHeight: 720,
          placement: { anchorId: "root", offsetX: 0, direction: "below" },
        }),
        branchNode,
      ],
      [
        { id: "input-edge", kind: "input", source: "input", target: "root", order: 0 },
        { id: "result-edge", kind: "result", source: "root", target: "answer" },
      ],
      [{
        id: "batch-1",
        generationNodeId: "root",
        startedAt: stamp,
        promptFormatVersion: 2,
        instruction: "frozen instruction",
        inputs: [{ nodeId: "input", title: "input", text: "first input" }],
        context,
        executions: [{ id: "execution-1", modelId: "model-a", status: "success", startedAt: stamp, completedAt: stamp, outputNodeId: "answer" }],
      }],
    );
    const workspace = makeWorkspace(flow);

    const exported = createWorkspaceExport(workspace, clock);
    const imported = parseWorkspaceExport(JSON.parse(JSON.stringify(exported))).workspace;
    expect(imported).toEqual(workspace);

    await repository.save("spatial-layout-test", workspace);
    await expect(repository.load("spatial-layout-test")).resolves.toEqual(workspace);

    let idIndex = 0;
    const duplicate = duplicateFlowWithFreshIds(flow, () => `copy-${idIndex++}`, clock, "Copy");
    const duplicateRoot = nodeById(duplicate, "copy-1");
    const duplicateAnswer = duplicate.nodes.find((node) => node.data.kind === "text" && node.data.origin === "generated")!;
    const duplicateGeneration = duplicateRoot.data as GenerationData;
    expect(duplicate.name).toBe("Copy");
    expect(duplicateAnswer.position).toEqual(nodeById(flow, "answer").position);
    expect(duplicateAnswer.measuredHeight).toBe(720);
    expect(duplicateAnswer.placement?.anchorId).toBe(duplicateRoot.id);
    const duplicateBranch = nodeById(duplicate, "copy-3");
    expect(duplicateBranch.placement?.anchorId).toBe(duplicateRoot.id);
    expect(duplicateBranch.data).toMatchObject({ branchedFrom: { nodeId: duplicateRoot.id, batchId: "copy-6" } });
    expect(duplicateGeneration.context).toEqual([
      { role: "user", content: "first input", nodeId: "copy-0" },
      { role: "user", content: "frozen instruction", nodeId: duplicateRoot.id },
      { role: "assistant", content: "first answer", nodeId: duplicateAnswer.id, modelId: "model-a" },
    ]);

    await repository.clearAllBrowserData();
  });
});
