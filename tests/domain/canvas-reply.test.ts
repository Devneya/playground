import { describe, expect, it } from "vitest";
import { parseCanvasReply } from "../../src/domain/canvasReply";
import { reduceWorkspace, type WorkspaceAction } from "../../src/domain/workspaceReducer";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { createWorkspaceExport, parseWorkspaceExport } from "../../src/domain/exportFormat";
import { validateWorkspaceInvariants } from "../../src/domain/graph";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { getConversationPath } from "../../src/domain/conversation";
import { emptyHistory, pushHistory, redoHistory, undoHistory } from "../../src/domain/workspaceHistory";
import { cardHeight, cardWidth, CHAT_GAP, layoutAutomaticNodes } from "../../src/domain/spatialLayout";
import { LIMITS } from "../../src/domain/limits";
import type { GeneratedTextData } from "../../src/domain/types";

let counter = 0;
const context = { idFactory: () => `canvas-${++counter}`, clock: { now: () => new Date("2026-10-02T12:00:00Z") } };
const cell = { col: 0, row: 0, title: "Hypothesis", text: "This is an assumption, not a measured fact.", noted: false };
const reply = { reply: "Let's test the idea.", suggested_branches: [{ title: "Try to disprove it", instruction: "Find the strongest counterexample." }], extracted_notes: [{ title: "Uncertainty", text: "We have no evidence yet." }], grid: { columns: 2, cells: [cell, { ...cell, col: 1, title: "Caveat", noted: true }, { ...cell, row: 2, title: "Experiment" }] } };
function fixture(automatic = false) {
  let workspace = createStarterWorkspace(context.idFactory, context.clock);
  const flow = workspace.flows[0]!;
  const prompt = flow.nodes.find((node) => node.data.kind === "generation")!;
  const now = context.clock.now().toISOString();
  workspace = reduceWorkspace(workspace, { type: "batch/started", flowId: flow.id, batch: { id: "batch", generationNodeId: prompt.id, instruction: "Explore a hypothesis", inputs: [], promptFormatVersion: 1, startedAt: now, executions: [{ id: "execution", modelId: "test-model", outputNodeId: "answer", status: "pending", startedAt: now }] }, outputNodes: [{ id: "answer", position: { x: 0, y: 300 }, createdAt: now, updatedAt: now, data: { kind: "text", origin: "generated", title: "test-model", text: "", batchId: "batch", executionId: "execution" } }], resultEdges: [{ id: "result", kind: "result", source: prompt.id, target: "answer" }] }, context);
  const parsed = parseCanvasReply(JSON.stringify(reply));
  const next = reduceWorkspace(workspace, { type: "execution/succeeded", flowId: flow.id, batchId: "batch", executionId: "execution", ...(automatic ? parsed : { text: parsed.text }), durationMs: 100 }, context);
  if (!automatic) (next.flows[0]!.nodes.find((node) => node.id === "answer")!.data as GeneratedTextData).suggestions = parsed.suggestions!;
  return next;
}
const accept = (workspace: ReturnType<typeof fixture>, kind: "branch" | "note" | "grid", index = 0) => reduceWorkspace(workspace, { type: "suggestion/accept", flowId: workspace.activeFlowId, sourceNodeId: "answer", kind, index }, context);
const suggestions = (workspace: ReturnType<typeof fixture>) => (workspace.flows[0]!.nodes.find((node) => node.id === "answer")!.data as GeneratedTextData).suggestions!;

describe("canvas reply parsing", () => {
  it.each(["plain answer", "{broken", "null", "42", "[]", '{"content":"ordinary user JSON"}', '{"reply":""}', '{"reply":9}'])("preserves unsupported output %s", (raw) => expect(parseCanvasReply(raw)).toEqual({ text: raw }));
  it("reads fenced JSON, ignores bad suggestions, limits counts, and cannot self-accept", () => {
    const raw = { ...reply, suggested_branches: [null, ...Array(8).fill({ ...reply.suggested_branches[0], accepted: true }), { title: "", instruction: "x" }], extracted_notes: [{ title: "x" }, ...Array(8).fill({ ...reply.extracted_notes[0], accepted: true })] };
    const parsed = parseCanvasReply(`\n\`\`\`json\n${JSON.stringify(raw)}\n\`\`\`\n`);
    expect(parsed.text).toBe(reply.reply);
    expect(parsed.suggestions?.branches).toHaveLength(3);
    expect(parsed.suggestions?.notes).toHaveLength(2);
    expect(parsed.suggestions?.branches?.[0]?.accepted).toBeUndefined();
    expect(parsed.suggestions?.notes?.[0]?.accepted).toBeUndefined();
  });
  it("rejects invalid, duplicate and out-of-bounds cells without failing the answer", () => {
    const result = parseCanvasReply(JSON.stringify({ reply: "Hello", grid: { columns: 2, cells: [cell, cell, { ...cell, col: 2 }, { ...cell, row: 6 }, { ...cell, row: 1, text: 42 }, { ...cell, row: 2 }] } }));
    expect(result.suggestions?.grid?.cells).toHaveLength(2);
    expect(result.suggestions?.grid?.cells[1]?.row).toBe(2);
    for (const grid of [null, 2, {}, { columns: 5, cells: [cell] }, { columns: 2, cells: [] }, { columns: 2, cells: [null] }]) expect(parseCanvasReply(JSON.stringify({ reply: "Hello", grid }))).toEqual({ text: "Hello" });
  });
  it("keeps plain JSON replies without proposals and bounds oversized input", () => {
    expect(parseCanvasReply('{"reply":"Just an answer."}')).toEqual({ text: "Just an answer." });
    const raw = JSON.stringify({ reply: "a".repeat(LIMITS.maxGeneratedBytes) });
    expect(parseCanvasReply(raw)).toEqual({ text: raw });
  });
});

describe("human-curated canvas suggestions", () => {
  it("creates a draft branch with ancestry without triggering a run, and accepts only once", () => {
    const initial = fixture();
    const next = accept(initial, "branch");
    const flow = next.flows[0]!;
    const draft = flow.nodes.at(-1)!;
    expect(draft.data).toMatchObject({ kind: "generation", instruction: reply.suggested_branches[0]!.instruction, modelIds: ["test-model"] });
    expect(getConversationPath(flow, draft.id).at(-1)?.content).toBe(reply.reply);
    expect(flow.batches).toHaveLength(1);
    expect(suggestions(initial).branches?.[0]?.accepted).toBeUndefined();
    expect(suggestions(next).branches?.[0]?.accepted).toBe(true);
    expect(accept(next, "branch")).toBe(next);
    expect(validateWorkspaceInvariants(next)).toEqual([]);
  });
  it("keeps a bounded editable note with original provenance and atomic undo/redo", () => {
    const initial = fixture();
    const next = accept(initial, "note");
    const note = next.flows[0]!.nodes.at(-1)!;
    expect(note.data).toMatchObject({ kind: "text", origin: "manual", ...reply.extracted_notes[0], source: { nodeId: "answer", text: reply.reply } });
    const undone = undoHistory(pushHistory(emptyHistory(), initial), next)!;
    expect(undone.workspace).toEqual(initial);
    expect(redoHistory(undone.history, initial)?.workspace).toEqual(next);
    expect(accept(next, "note")).toBe(next);
  });
  it("places a grid as generated siblings, preserves gaps and survives export, duplicate and deletion", () => {
    const next = accept(fixture(), "grid");
    const flow = next.flows[0]!;
    const cells = flow.nodes.filter((node) => node.gridPlacement);
    expect(cells).toHaveLength(3);
    expect(cells[0]!.position.y).toBe(cells[1]!.position.y);
    expect(cells[2]!.position.y).toBeGreaterThan(cells[0]!.position.y + cardHeight(cells[0]!) + CHAT_GAP);
    expect(cells[1]!.data).toMatchObject({ origin: "generated", noted: true, heading: "Caveat" });
    expect(flow.edges.filter((edge) => edge.kind === "input")).toHaveLength(0);
    expect(accept(next, "grid")).toBe(next);
    expect(validateWorkspaceInvariants(next)).toEqual([]);
    expect(parseWorkspaceExport(createWorkspaceExport(next, context.clock)).workspace).toEqual(next);
    const duplicated = duplicateFlowWithFreshIds(flow, context.idFactory, context.clock);
    expect(validateWorkspaceInvariants({ ...next, activeFlowId: duplicated.id, flows: [duplicated] })).toEqual([]);
    expect(duplicated.nodes.filter((n) => n.gridPlacement).every((n) => n.gridPlacement!.anchorId !== "answer")).toBe(true);
    let deleted = reduceWorkspace(next, { type: "node/delete", flowId: flow.id, nodeId: "answer" }, context);
    expect(validateWorkspaceInvariants(deleted)).toEqual([]);
    for (const item of cells) deleted = reduceWorkspace(deleted, { type: "node/delete", flowId: flow.id, nodeId: item.id }, context);
    expect(validateWorkspaceInvariants(deleted)).toEqual([]);
    expect(deleted.flows[0]!.batches).toHaveLength(0);
  });
  it("reflows whole grid rows after measurement and leaves dragged cards alone", () => {
    const initial = fixture();
    const flow = initial.flows[0]!;
    // Fixed obstacle occupies part of the planned map rectangle.
    flow.nodes.push({ ...flow.nodes[0]!, id: "obstacle", position: { x: 550, y: 320 }, data: { kind: "text", origin: "manual", title: "Pinned", text: "Leave me here" } });
    let next = accept(initial, "grid");
    let cells = next.flows[0]!.nodes.filter((n) => n.gridPlacement);
    expect(cells[0]!.position.y).toBeGreaterThan(320 + cardHeight(flow.nodes.at(-1)!));
    next = reduceWorkspace(next, { type: "node/measure", flowId: flow.id, sizes: [{ id: cells[0]!.id, height: 700 }] }, context);
    cells = next.flows[0]!.nodes.filter((n) => n.gridPlacement);
    expect(cells[2]!.position.y).toBeGreaterThan(cells[0]!.position.y + 700);
    const moved = reduceWorkspace(next, { type: "node/move", flowId: flow.id, nodeId: cells[0]!.id, position: { x: -700, y: 500 } }, context);
    const reflowed = layoutAutomaticNodes(moved.flows[0]!);
    expect(reflowed.nodes.find((n) => n.id === cells[0]!.id)).toMatchObject({ position: { x: -700, y: 500 } });
    expect(reflowed.nodes.find((n) => n.id === "obstacle")!.position).toEqual({ x: 550, y: 320 });
    const noAnchor = layoutAutomaticNodes({ ...reflowed, nodes: reflowed.nodes.filter((n) => n.id !== "answer") });
    expect(noAnchor.nodes.filter((n) => n.gridPlacement).map((n) => n.position)).toEqual(reflowed.nodes.filter((n) => n.gridPlacement).map((n) => n.position));
  });
  it("rejects unavailable, invalid, out-of-range and over-capacity proposals", () => {
    const initial = fixture();
    expect(accept(initial, "note", 99)).toBe(initial);
    expect(reduceWorkspace(initial, { type: "suggestion/accept", flowId: "missing", sourceNodeId: "answer", kind: "note", index: 0 }, context)).toBe(initial);
    expect(reduceWorkspace(initial, { type: "suggestion/accept", flowId: initial.activeFlowId, sourceNodeId: "missing", kind: "note", index: 0 }, context)).toBe(initial);
    const failed = structuredClone(initial); failed.flows[0]!.batches[0]!.executions[0]!.status = "failed";
    expect(accept(failed, "note")).toBe(failed);
    const invalid = structuredClone(initial); delete (invalid.flows[0]!.nodes.find((n) => n.id === "answer")!.data as GeneratedTextData).suggestions;
    expect(accept(invalid, "note")).toBe(invalid);
    const full = structuredClone(initial); full.flows[0]!.nodes.push(...Array.from({ length: 250 }, (_, i) => ({ ...full.flows[0]!.nodes[0]!, id: `extra-${i}` })));
    expect(accept(full, "grid")).toBe(full);
    const edgesFull = structuredClone(initial); edgesFull.flows[0]!.edges.push(...Array(500).fill(edgesFull.flows[0]!.edges[0]));
    expect(accept(edgesFull, "branch")).toBe(edgesFull);
    const noSourcePrompt = reduceWorkspace(initial, { type: "node/delete", flowId: initial.activeFlowId, nodeId: initial.flows[0]!.batches[0]!.generationNodeId } as WorkspaceAction, context);
    expect(validateWorkspaceInvariants(accept(noSourcePrompt, "grid"))).toEqual([]);
  });
});


describe("gathering ideas", () => {
  it("combines only chosen successful cards and notes into an unsent prompt", () => {
    let initial = accept(fixture(), "grid");
    initial = accept(initial, "note");
    const flow = initial.flows[0]!;
    const cell = flow.nodes.find((node) => node.gridPlacement)!;
    const note = flow.nodes.at(-1)!;
    const next = reduceWorkspace(initial, { type: "generation/combine", flowId: flow.id, sourceNodeIds: [cell.id, note.id, cell.id], instruction: "Compare these two ideas" }, context);
    const draft = next.flows[0]!.nodes.at(-1)!;
    expect(draft.data).toMatchObject({ kind: "generation", instruction: "Compare these two ideas", modelIds: ["test-model"] });
    expect(next.flows[0]!.edges.filter((edge) => edge.target === draft.id).map((edge) => edge.source)).toEqual([cell.id, note.id]);
    expect(validateWorkspaceInvariants(next)).toEqual([]);
    expect(next.flows[0]!.batches).toHaveLength(1);
    const manual = reduceWorkspace(initial, { type: "generation/combine", flowId: flow.id, sourceNodeIds: [note.id], instruction: "Think" }, context);
    expect(manual.flows[0]!.nodes.at(-1)!.data).toMatchObject({ modelIds: [] });
  });
  it("refuses missing, failed, excessive, non-text and oversized selections", () => {
    const initial = fixture();
    const flow = initial.flows[0]!;
    for (const sourceNodeIds of [[], ["missing"], [flow.nodes[0]!.id], Array.from({ length: 9 }, (_, i) => String(i))]) {
      const next = reduceWorkspace(initial, { type: "generation/combine", flowId: flow.id, sourceNodeIds, instruction: "Think" }, context);
      expect(next.flows[0]!.nodes).toEqual(flow.nodes);
    }
    const failed = structuredClone(initial); failed.flows[0]!.batches[0]!.executions[0]!.status = "failed";
    const result = reduceWorkspace(failed, { type: "generation/combine", flowId: flow.id, sourceNodeIds: ["answer"], instruction: "Think" }, context);
    expect(result.flows[0]!.nodes).toEqual(failed.flows[0]!.nodes);
    const tooLong = reduceWorkspace(initial, { type: "generation/combine", flowId: flow.id, sourceNodeIds: ["answer"], instruction: "x".repeat(LIMITS.maxTextBytes + 1) }, context);
    expect(tooLong.flows[0]!.nodes).toEqual(flow.nodes);
    for (const full of ["nodes", "edges"] as const) {
      const crowded = structuredClone(initial);
      if (full === "nodes") crowded.flows[0]!.nodes.push(...Array(250).fill(flow.nodes[0]!));
      else crowded.flows[0]!.edges.push(...Array(500).fill(flow.edges[0]!));
      const unchanged = reduceWorkspace(crowded, { type: "generation/combine", flowId: flow.id, sourceNodeIds: ["answer"], instruction: "Think" }, context);
      expect(unchanged.flows[0]!.nodes).toEqual(crowded.flows[0]!.nodes);
    }
  });
});

describe("automatic spatial answers", () => {
  it("places answer ideas without acceptance and retains execution provenance", () => {
    const next = fixture(true);
    const flow = next.flows[0]!;
    const source = flow.nodes.find((node) => node.id === "answer")!;
    const ideas = flow.nodes.filter((node) => node.gridPlacement);
    expect(ideas).toHaveLength(3);
    expect(ideas.every((node) => node.gridPlacement?.below && node.position.y >= source.position.y + cardHeight(source))).toBe(true);
    expect(ideas[0]!.data).toMatchObject({ presentation: "idea" });
    expect(suggestions(next).grid?.accepted).toBe(true);
    expect(validateWorkspaceInvariants(next)).toEqual([]);
    expect(parseWorkspaceExport(createWorkspaceExport(next, context.clock)).workspace).toEqual(next);
    const branch = reduceWorkspace(next, { type: "generation/continue", flowId: flow.id, sourceNodeId: ideas[0]!.id, instruction: "Explore this assumption" }, context);
    const draft = branch.flows[0]!.nodes.at(-1)!;
    expect(getConversationPath(branch.flows[0]!, draft.id).at(-1)?.content).toBe(cell.text);
    expect(draft.position.y).toBeGreaterThanOrEqual(ideas[0]!.position.y + cardHeight(ideas[0]!));
    expect(draft.position.y + cardHeight(draft)).toBeLessThanOrEqual(ideas[2]!.position.y);
  });
  it("validates spanning artifacts, drops overlapping cells, bounds generated code", () => {
    const artifact = { html: '<button>Try this</button>', height: 300 };
    const parsed = parseCanvasReply(JSON.stringify({ reply: "Explore this.", grid: { columns: 2, cells: [{ ...cell, span: 2, artifact }, { ...cell, col: 1 }, { ...cell, row: 1 }] } }));
    expect(parsed.suggestions?.grid?.cells).toHaveLength(2);
    expect(parsed.suggestions?.grid?.cells[0]?.artifact).toEqual(artifact);
    for (const bad of [{ ...artifact, height: 999 }, { ...artifact, html: "x".repeat(48001) }]) {
      expect(parseCanvasReply(JSON.stringify({ reply: "Fallback", grid: { columns: 2, cells: [{ ...cell, artifact: bad }] } })).suggestions?.grid?.cells[0]).toEqual(cell);
    }
  });
});

it("keeps supporting ideas beside a wide visual, reflows obstacles, and preserves width when dragged", () => {
  const initial = fixture();
  const flow = initial.flows[0]!;
  flow.nodes[0]!.position = { x: 0, y: 0 };
  suggestions(initial).grid = { columns: 2, cells: [
    { ...cell, span: 2, artifact: { html: "<button>Try</button>", height: 300 } },
    { ...cell, row: 1 }, { ...cell, row: 1, col: 1 },
  ] };
  const next = reduceWorkspace(initial, { type: "suggestion/accept", flowId: flow.id, sourceNodeId: "answer", kind: "grid", index: 0, automatic: true }, context);
  const ideas = next.flows[0]!.nodes.filter((node) => node.gridPlacement);
  const visual = ideas[0]!;
  expect(visual.gridPlacement?.layout).toBe("spread");
  expect(cardWidth(visual)).toBe(1000);
  expect(visual.position.x).toBeGreaterThan(ideas[1]!.position.x + cardWidth(ideas[1]!));
  expect(ideas[2]!.position.x).toBeGreaterThan(visual.position.x + cardWidth(visual));
  const measured = reduceWorkspace(next, { type: "node/measure", flowId: flow.id, sizes: [{ id: visual.id, height: 700 }] }, context);
  expect(measured.flows[0]!.nodes.find((node) => node.id === ideas[1]!.id)!.position).toEqual(ideas[1]!.position);
  const obstacle = { ...flow.nodes[0]!, id: "fixed", position: { x: visual.position.x, y: visual.position.y + 100 } };
  const crowded = layoutAutomaticNodes({ ...measured.flows[0]!, nodes: [...measured.flows[0]!.nodes, obstacle] });
  expect(crowded.nodes.find((node) => node.id === visual.id)!.position.y).toBeGreaterThanOrEqual(obstacle.position.y + cardHeight(obstacle));
  expect(crowded.nodes.at(-1)!.position).toEqual(obstacle.position);
  const moved = reduceWorkspace(next, { type: "node/move", flowId: flow.id, nodeId: visual.id, position: { x: 2000, y: 50 } }, context);
  expect(cardWidth(moved.flows[0]!.nodes.find((node) => node.id === visual.id)!)).toBe(1000);
  expect(parseWorkspaceExport(createWorkspaceExport(next, context.clock)).workspace).toEqual(next);
  expect(validateWorkspaceInvariants(next)).toEqual([]);
});

it("arranges multiple generated scenes as separate instruments without overlap", () => {
  const initial = fixture();
  const flow = initial.flows[0]!;
  suggestions(initial).grid = { columns: 2, cells: [0, 1, 2].map((row) => ({ ...cell, row, span: 2, artifact: { html: `<button>Instrument ${row}</button>`, height: 300 } })) };
  const next = reduceWorkspace(initial, { type: "suggestion/accept", flowId: flow.id, sourceNodeId: "answer", kind: "grid", index: 0, automatic: true }, context);
  const scenes = next.flows[0]!.nodes.filter((node) => node.gridPlacement);
  expect(scenes).toHaveLength(3);
  expect(cardWidth(scenes[0]!)).toBe(704);
  expect(scenes[1]!.position.x).toBeGreaterThan(scenes[0]!.position.x + cardWidth(scenes[0]!));
  expect(scenes[2]!.position.y).toBeGreaterThan(scenes[0]!.position.y + cardHeight(scenes[0]!));
  expect(validateWorkspaceInvariants(next)).toEqual([]);
  expect(parseWorkspaceExport(createWorkspaceExport(next, context.clock)).workspace).toEqual(next);
});

it("keeps an atlas as separate answer objects with visible meaning and independent follow-ups", () => {
  const initial = fixture();
  const parsed = parseCanvasReply(JSON.stringify({ reply: "The direct answer.", grid: { layout: "atlas", columns: 3, cells: [0, 1, 2, 3].map((i) => ({ ...cell, col: i % 3, row: Math.floor(i / 3), title: `Subject ${i}`, question: `Explain subject ${i}`, ...(i < 3 ? { artifact: { html: `<svg aria-label="Diagram ${i}"></svg>`, height: 220 } } : {}) })) } }));
  const source = initial.flows[0]!.nodes.find((n) => n.id === "answer")!;
  (source.data as GeneratedTextData).suggestions = parsed.suggestions!;
  const next = reduceWorkspace(initial, { type: "suggestion/accept", flowId: initial.activeFlowId, sourceNodeId: "answer", kind: "grid", index: 0, automatic: true }, context);
  const objects = next.flows[0]!.nodes.filter((n) => n.gridPlacement);
  expect(objects).toHaveLength(4);
  expect(objects.every((n) => n.gridPlacement?.layout === "atlas" && n.data.kind === "text" && n.data.origin === "generated" && n.data.presentation === "atlas")).toBe(true);
  expect(objects.map(cardWidth)).toEqual([384, 384, 384, 384]);
  expect(new Set(objects.slice(0, 3).map((n) => n.position.y)).size).toBe(1);
  expect(objects[1]!.position.x).toBeGreaterThan(objects[0]!.position.x + 384);
  expect(objects[3]!.position.y).toBeGreaterThan(objects[0]!.position.y + cardHeight(objects[0]!));
  expect(objects[0]!.data).toMatchObject({ question: "Explain subject 0", text: cell.text });
  const moved = reduceWorkspace(next, { type: "node/move", flowId: initial.activeFlowId, nodeId: objects[1]!.id, position: { x: -800, y: 60 } }, context);
  expect(cardWidth(moved.flows[0]!.nodes.find((n) => n.id === objects[1]!.id)!)).toBe(384);
  expect(parseWorkspaceExport(createWorkspaceExport(moved, context.clock)).workspace).toEqual(moved);
  expect(validateWorkspaceInvariants(moved)).toEqual([]);
});
