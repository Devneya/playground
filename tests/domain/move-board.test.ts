import { expect, it } from "vitest";
import { appendBoardRevision, applyBoardMove, blankPosition, boardChanges, boardLineage, boardPosition, emptyBoard, moveBoardSchema, type BoardRevision } from "../../src/domain/moveBoard";
import { boardMessages } from "../../src/domain/moveBoardPrompt";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { reduceWorkspace } from "../../src/domain/workspaceReducer";
import { createWorkspaceExport, parseWorkspaceExport } from "../../src/domain/exportFormat";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { validateWorkspaceInvariants } from "../../src/domain/graph";
const piece = (id: string) => ({ id, label: id, detail: "A concrete proposal", kind: "idea" as const, basis: "proposal" as const });
const route = (id: string) => ({ id, title: id, premise: "A distinct direction", pieces: [piece(id + "1"), piece(id + "2")], tradeoff: "Requires time", test: "Try it with a real task" });
const move = { label: "Open A", reason: "Compare", routes: [route("a")], remove: [] };
const position = applyBoardMove(blankPosition(), move);
const revision = (id: string, parent: string | null): BoardRevision => ({ id, parent, actor: "model", label: id, reason: "Compare", model: "test", at: "2026-10-03T12:00:00.000Z", position });
it("patches only relevant alternatives, cleans removed marks, and transmits selection", () => {
  expect(boardPosition(emptyBoard())).toEqual(blankPosition());
  const first = applyBoardMove(position, { ...move, title: "Paths", question: "Which?", routes: [route("b")] });
  expect(first.routes.map((r) => r.id)).toEqual(["a", "b"]);
  const updated = applyBoardMove({ ...first, marks: { a1: "question", b1: "dismiss" } }, { ...move, routes: [{ ...route("a"), title: "New A" }], remove: ["b"] });
  expect(updated.routes[0]?.title).toBe("New A");
  expect(applyBoardMove(updated, { ...move, title: "", routes: [] }).title).toBe("Paths");
  expect(updated.marks).toEqual({ a1: "question" });
  expect(JSON.parse(boardMessages(updated, "Combine", ["a1"])[0]!.content)).toMatchObject({ selectedPieces: ["a1"], instruction: "Combine", position: updated });
});
it("preserves older boards, applies a chosen layout and reports actual content differences", () => {
  const sequence = applyBoardMove(position, { ...move, layout: "sequence" });
  expect(sequence.layout).toBe("sequence");
  expect(applyBoardMove(sequence, move).layout).toBe("sequence");
  expect(boardChanges(position, sequence)).toMatchObject({ changed: true, layoutChanged: true, updated: [] });
  expect(() => applyBoardMove(sequence, { ...move, layout: "unknown" })).toThrow();
  expect(boardChanges(position, position)).toMatchObject({ changed: false });
  const changed = applyBoardMove(position, { ...move, routes: [{ ...route("a"), pieces: [{ ...piece("a1"), detail: "A substantive revision" }, piece("a3")] }] });
  const diff = boardChanges(position, changed);
  expect(diff.added.map((p) => p.id)).toEqual(["a3"]);
  expect(diff.removed.map((p) => p.id)).toEqual(["a2"]);
  expect(diff.updated[0]).toEqual({ before: piece("a1"), after: { ...piece("a1"), detail: "A substantive revision" } });
  expect(boardChanges(position, { ...position, question: "Different follow-up" }).changed).toBe(false);
  expect(boardChanges(position, { ...position, title: "New framing" }).framingChanged).toBe(true);
  for (const field of ["title", "premise", "tradeoff", "test"] as const) {
    expect(boardChanges(position, { ...position, routes: [{ ...route("a"), [field]: "Changed" }] }).framingChanged).toBe(true);
  }
  expect(boardChanges(position, blankPosition()).changed).toBe(true);
});
it("preserves kept content and rejects a rewrite, deletion, duplicate or oversized board", () => {
  const kept = { ...position, marks: { a1: "keep" as const } };
  expect(applyBoardMove(kept, move)).toEqual(kept);
  expect(() => applyBoardMove(kept, { ...move, routes: [], remove: ["a"] })).toThrow("kept");
  expect(() => applyBoardMove(kept, { ...move, routes: [{ ...route("a"), pieces: [{ ...piece("a1"), label: "Rewritten" }, piece("a2")] }] })).toThrow("kept");
  expect(() => applyBoardMove(position, { ...move, routes: [{ ...route("b"), pieces: [piece("a1"), piece("b2")] }] })).toThrow("reused");
  expect(() => applyBoardMove(position, { ...move, routes: [route("b"), route("c"), route("d"), route("e")] })).toThrow();
});
it("restores snapshots and branches without destroying the original future", () => {
  const a = appendBoardRevision(emptyBoard(), revision("first", null));
  const b = appendBoardRevision(a, revision("second", "first"));
  const branch = appendBoardRevision({ ...b, head: "first" }, revision("branch", "first"));
  expect(branch.revisions.map((r) => r.id)).toEqual(["first", "second", "branch"]);
  expect(branch.head).toBe("branch");
  expect(boardLineage(branch).map((r) => r.id)).toEqual(["first", "branch"]);
  expect(boardLineage({ ...branch, head: "absent" })).toEqual([]);
  expect(boardLineage(emptyBoard())).toEqual([]);
  expect(boardPosition(branch)).toEqual(position);
  expect(() => appendBoardRevision(b, revision("late", "first"))).toThrow("position changed");
});
it("validates imported history and bounds snapshots without dangling parents", () => {
  expect(moveBoardSchema.safeParse({ head: "absent", revisions: [] }).success).toBe(false);
  expect(moveBoardSchema.safeParse({ head: "first", revisions: [revision("first", "absent")] }).success).toBe(false);
  expect(moveBoardSchema.safeParse({ head: "a", revisions: [revision("a", null), revision("a", null)] }).success).toBe(false);
  expect(moveBoardSchema.safeParse({ head: "a", revisions: [{ ...revision("a", null), position: { ...position, routes: [route("a"), route("a")] } }] }).success).toBe(false);
  let board = emptyBoard();
  for (let i = 0; i < 82; i++) board = appendBoardRevision(board, revision(`r${i}`, board.head));
  expect(board.revisions).toHaveLength(80);
  expect(board.revisions[0]?.parent).toBeNull();
  expect(board.head).toBe("r81");
});

it("persists board history through export and duplication, and rejects stale writes", () => {
  let n = 0;
  const clock = { now: () => new Date("2026-10-03T12:00:00Z") }, idFactory = () => `test-${++n}`;
  const workspace = createStarterWorkspace(idFactory, clock), flowId = workspace.activeFlowId;
  const board = appendBoardRevision(emptyBoard(), revision("first", null));
  const changed = reduceWorkspace(workspace, { type: "board/set", flowId, baseHead: null, board }, { clock, idFactory });
  const stale = reduceWorkspace(changed, { type: "board/set", flowId, baseHead: null, board: emptyBoard() }, { clock, idFactory });
  expect(stale.flows[0]?.board).toEqual(board);
  const restored = parseWorkspaceExport(createWorkspaceExport(changed, clock)).workspace;
  expect(restored.flows[0]?.board).toEqual(board);
  expect(validateWorkspaceInvariants(restored)).toEqual([]);
  const duplicate = duplicateFlowWithFreshIds(restored.flows[0]!, idFactory, clock);
  expect(duplicate.board).toEqual(board);
  expect(duplicate.board).not.toBe(restored.flows[0]?.board);
  const invalid = structuredClone(restored); invalid.flows[0]!.board!.head = "missing";
  expect(validateWorkspaceInvariants(invalid)).toContain("Invalid move board.");
});
