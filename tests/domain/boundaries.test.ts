import { describe, expect, it } from "vitest";
import { createWorkspaceExport, parseWorkspaceExport, WorkspaceExportError } from "../../src/domain/exportFormat";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { createStarterWorkspace, uniqueFlowName } from "../../src/domain/workspaceFactory";
import { placeNewResultNodes } from "../../src/domain/resultPlacement";
import { emptyHistory, pushHistory, redoHistory, undoHistory } from "../../src/domain/workspaceHistory";
import { isGeneratedTextNode, isGenerationNode, isManualTextNode, isTextNode } from "../../src/domain/types";

const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

describe("workspace boundaries", () => {
  it("creates and validates the portable export format", () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), clock);
    const exported = createWorkspaceExport(workspace, clock);
    expect(exported.format).toBe("devneya-flow-v1");
    expect(parseWorkspaceExport(JSON.parse(JSON.stringify(exported))).workspace).toEqual(workspace);
    expect(() => parseWorkspaceExport({ format: "old" })).toThrow(WorkspaceExportError);
  });

  it("duplicates a flow with fresh references and names it uniquely", () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), clock);
    const flow = workspace.flows[0]!;
    const duplicate = duplicateFlowWithFreshIds(flow, () => crypto.randomUUID(), clock, "Untitled flow 2");
    expect(duplicate.id).not.toBe(flow.id);
    expect(duplicate.name).toBe("Untitled flow 2");
    expect(duplicate.nodes.map((node) => node.id)).not.toEqual(flow.nodes.map((node) => node.id));
    expect(uniqueFlowName(["Untitled flow", "Untitled flow 2"])).toBe("Untitled flow 3");
  });

  it("places result nodes in a free column and handles invalid placement requests", () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), clock);
    const flow = workspace.flows[0]!;
    const generation = flow.nodes.find((node) => isGenerationNode(node))!;
    expect(placeNewResultNodes(flow, generation.id, 2)).toEqual([{ x: 860, y: 120 }, { x: 860, y: 380 }]);
    expect(placeNewResultNodes(flow, "missing", 2)).toEqual([]);
    expect(placeNewResultNodes(flow, generation.id, 0)).toEqual([]);
  });

  it("supports bounded undo and redo snapshots", () => {
    const first = createStarterWorkspace(() => crypto.randomUUID(), clock);
    const second = { ...first, updatedAt: "2026-01-01T00:00:01.000Z" };
    const history = pushHistory(emptyHistory(), first);
    const undone = undoHistory(history, second);
    expect(undone?.workspace).toEqual(first);
    const redone = undone && redoHistory(undone.history, undone.workspace);
    expect(redone?.workspace).toEqual(second);
  });

  it("distinguishes manual, generated, text, and generation nodes", () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID(), clock);
    const flow = workspace.flows[0]!;
    const text = flow.nodes.find((node) => isTextNode(node))!;
    const generation = flow.nodes.find((node) => isGenerationNode(node))!;
    expect(isManualTextNode(text)).toBe(true);
    expect(isGeneratedTextNode(text)).toBe(false);
    expect(isGenerationNode(generation)).toBe(true);
  });
});
