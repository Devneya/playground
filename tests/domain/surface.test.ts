import { surfacePositions } from "../../src/domain/surfaceLayout";
import { describe, expect, it } from "vitest";
import { applySurfaceOperations, emptySurface, evaluateFormula, formulaSchema, surfaceObjectSchema, surfaceProblems, surfaceReplySchema, type Formula, type Surface, type SurfaceObject } from "../../src/domain/surface";
import { surfaceMessages } from "../../src/domain/surfacePrompt";
import { reduceWorkspace } from "../../src/domain/workspaceReducer";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { createWorkspaceExport, parseWorkspaceExport } from "../../src/domain/exportFormat";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { validateWorkspaceInvariants } from "../../src/domain/graph";
import { emptyHistory, pushHistory, redoHistory, undoHistory } from "../../src/domain/workspaceHistory";

const clock = { now: () => new Date("2026-10-03T12:00:00Z") };
let n = 0;
const context = { clock, idFactory: () => `surface-test-${++n}` };
const obj = (id: string, extra: Partial<SurfaceObject> = {}): SurfaceObject => ({ id, kind: "text", title: id, x: 0, y: 0, width: 250, height: 100, color: "ink", ...extra });
const baseline = (): Surface => ({ ...emptySurface(), objects: [obj("rest", { kind: "control", value: 1, min: 0, max: 4, step: .5 }), obj("remaining", { kind: "metric", formula: { op: "subtract", args: [4, { ref: "rest" }] } }), obj("note", { text: "Original example" })] });

describe("live shared calculations", () => {
  it("updates dependent metrics and charts from human changes and preserves negative results", () => {
    const base = baseline();
    const next = applySurfaceOperations(base, base, [{ op: "edit", id: "rest", changes: { value: 3 } }]).surface;
    expect(evaluateFormula({ ref: "remaining" }, base)).toBe(3);
    expect(evaluateFormula({ ref: "remaining" }, next)).toBe(1);
    expect(evaluateFormula({ op: "subtract", args: [2, { ref: "rest" }] }, next)).toBe(-1);
    expect(evaluateFormula({ op: "add", args: [{ ref: "rest" }, { ref: "remaining" }] }, next)).toBe(4);
  });
  it.each<[Formula, number | null]>([
    [{ op: "multiply", args: [2, 3, 4] }, 24], [{ op: "divide", args: [12, 2, 3] }, 2],
    [{ op: "min", args: [3, 4, -1] }, -1], [{ op: "max", args: [3, 4, -1] }, 4],
    [{ op: "divide", args: [1, 0] }, null], [{ ref: "missing" }, null], [{ ref: "note" }, null],
    [{ op: "add", args: [1, { ref: "missing" }] }, null],
  ])("evaluates bounded formulas without executing code: %j", (formula, result) => expect(evaluateFormula(formula, baseline())).toBe(result));
  it("rejects cycles, missing references, and malformed or excessively nested formulas", () => {
    const s = baseline();
    s.objects[1]!.formula = { ref: "remaining" };
    expect(surfaceProblems(s)).toContain("Calculations cannot refer back to themselves.");
    expect(evaluateFormula({ ref: "remaining" }, s)).toBeNull();
    s.objects[1]!.formula = { ref: "note" };
    expect(surfaceProblems(s)).toContain("Calculation refers to unavailable value note.");
    let deep: Formula = 1;
    for (let i = 0; i < 10; i++) deep = { op: "add", args: [1, deep] };
    expect(formulaSchema.safeParse(deep).success).toBe(false);
    expect(formulaSchema.safeParse({ op: "eval", args: ["alert(1)"] }).success).toBe(false);
  });
});

describe("model workspace transactions", () => {
  it("preserves independent edits and rejects a conflicting edit atomically", () => {
    const base = baseline();
    const current = applySurfaceOperations(base, base, [{ op: "edit", id: "rest", changes: { value: 2 } }]).surface;
    const result = applySurfaceOperations(current, base, [{ op: "edit", id: "rest", changes: { title: "Rest time" } }, { op: "create", object: obj("extra") }]);
    expect(result.surface.objects[0]).toMatchObject({ title: "Rest time", value: 2 });
    expect(result.changedIds).toEqual(["rest", "extra"]);
    expect(() => applySurfaceOperations(current, base, [{ op: "create", object: obj("extra") }, { op: "edit", id: "rest", changes: { value: 3 } }])).toThrow("Your work has been kept");
    expect(current.objects).toHaveLength(3);
    // Applying the same value isn't a conflict.
    expect(applySurfaceOperations(current, base, [{ op: "edit", id: "rest", changes: { value: 2 } }]).surface.objects[0]!.value).toBe(2);
  });
  it("creates, edits and connects objects in one transaction, and supports explicit disconnection/removal", () => {
    const base = baseline();
    const next = applySurfaceOperations(base, base, [{ op: "create", object: obj("example") }, { op: "edit", id: "example", changes: { text: "A counterexample" } }, { op: "edit", id: "example", changes: { text: "A refined counterexample" } }, { op: "connect", link: { id: "connection", from: "note", to: "example", label: "challenges" } }]).surface;
    expect(next.objects.at(-1)?.text).toBe("A refined counterexample");
    expect(surfaceProblems(next)).toEqual([]);
    const disconnected = applySurfaceOperations(next, next, [{ op: "disconnect", id: "connection" }]).surface;
    expect(disconnected.links).toEqual([]);
    expect(applySurfaceOperations(next, next, [{ op: "remove", id: "example" }]).surface.links).toEqual([]);
    const revisedLink = { ...next, links: [{ ...next.links[0]!, label: "human correction" }] };
    expect(() => applySurfaceOperations(revisedLink, next, [{ op: "disconnect", id: "connection" }])).toThrow("connection changed");
  });
  it("rejects unavailable objects, duplicate identifiers, broken links, and removal of changed or referenced objects", () => {
    const base = baseline();
    for (const op of [{ op: "edit" as const, id: "missing", changes: { text: "x" } }, { op: "remove" as const, id: "missing" }]) expect(() => applySurfaceOperations(base, base, [op])).toThrow("changed or was removed");
    expect(() => applySurfaceOperations(base, base, [{ op: "create", object: obj("rest") }])).toThrow("already exists");
    expect(() => applySurfaceOperations(base, base, [{ op: "remove", id: "rest" }])).toThrow("unavailable value rest");
    const changed = applySurfaceOperations(base, base, [{ op: "edit", id: "note", changes: { text: "Human words" } }]).surface;
    expect(() => applySurfaceOperations(changed, base, [{ op: "remove", id: "note" }])).toThrow("object you changed");
    expect(() => applySurfaceOperations(base, base, [{ op: "connect", link: { id: "bad", from: "note", to: "missing", label: "bad" } }])).toThrow("two existing objects");
    const linked = applySurfaceOperations(base, base, [{ op: "connect", link: { id: "same", from: "note", to: "rest", label: "relates" } }]).surface;
    expect(() => applySurfaceOperations(linked, linked, [{ op: "connect", link: linked.links[0]! }])).toThrow("already exists");
    expect(surfaceProblems({ ...base, objects: [...base.objects, base.objects[0]!] })).toContain("Object and connection IDs must be unique.");
  });
  it("validates controls, calculations, charts, unsupported operations and transaction sizes", () => {
    for (const object of [obj("bad", { kind: "control" }), obj("bad", { kind: "control", min: 0, max: 1, value: 2, step: 1 }), obj("bad", { kind: "metric" }), obj("bad", { kind: "bars" })]) expect(surfaceObjectSchema.safeParse(object).success).toBe(false);
    const chart = obj("chart", { kind: "bars", series: [{ label: "Rest", formula: { ref: "rest" } }] });
    expect(surfaceProblems({ ...baseline(), objects: [...baseline().objects, chart] })).toEqual([]);
    expect(surfaceReplySchema.safeParse({ summary: "x", operations: [{ op: "fetch", url: "https://example.test" }] }).success).toBe(false);
    expect(surfaceReplySchema.safeParse({ summary: "x", operations: Array(41).fill({ op: "remove", id: "note" }) }).success).toBe(false);
  });
  it("commits in one undo step, preserves edits on conflict, exports and duplicates without shared references", () => {
    let workspace = createStarterWorkspace(context.idFactory, clock);
    const flowId = workspace.activeFlowId;
    const base = baseline();
    workspace.flows[0]!.surface = base;
    const history = pushHistory(emptyHistory(), workspace);
    const next = reduceWorkspace(workspace, { type: "surface/acted", flowId, base, reply: { summary: "Adjusted rest and added an example", operations: [{ op: "edit", id: "rest", changes: { value: 2 } }, { op: "create", object: obj("example") }], actions: [] }, instruction: "Try an alternative", model: "model-a", turnId: "turn-1" }, context);
    expect(next.flows[0]!.surface!.turns).toHaveLength(1);
    const undone = undoHistory(history, next)!;
    expect(undone.workspace.flows[0]!.surface).toEqual(base);
    expect(redoHistory(undone.history, undone.workspace)?.workspace).toEqual(next);
    expect(parseWorkspaceExport(createWorkspaceExport(next, clock)).workspace).toEqual(next);
    const duplicate = duplicateFlowWithFreshIds(next.flows[0]!, context.idFactory, clock);
    duplicate.surface!.objects[0]!.value = 4;
    expect(next.flows[0]!.surface!.objects[0]!.value).toBe(2);
    expect(validateWorkspaceInvariants(next)).toEqual([]);
    const conflict = reduceWorkspace(next, { type: "surface/change", flowId, base, operations: [{ op: "edit", id: "rest", changes: { value: 3 } }] }, context);
    expect(conflict.flows[0]!.surface!.notice).toContain("Your work has been kept");
    expect(conflict.flows[0]!.surface!.objects).toEqual(next.flows[0]!.surface!.objects);
    const invalid = reduceWorkspace(workspace, { type: "surface/change", flowId, base, operations: [{ op: "edit", id: "rest", changes: { value: 99 } }] }, context);
    expect(invalid.flows[0]!.surface!.notice).toContain("invalid");
  });
  it("sends actual current objects and only valid selections, with bounded recent activity", () => {
    const state = baseline();
    const body = JSON.parse(surfaceMessages(state, "Work with this", ["note", "missing"])[0]!.content);
    expect(body.workspace.objects).toEqual(state.objects);
    expect(body.selectedObjectIds).toEqual(["note"]);
    expect(body.recentWork).toEqual([]);
  });
});

it("protects human-added connections from an in-flight model removal", () => {
  const base = baseline();
  const current = applySurfaceOperations(base, base, [{ op: "connect", link: { id: "human-link", from: "note", to: "rest", label: "Keep this relationship" } }]).surface;
  expect(() => applySurfaceOperations(current, base, [{ op: "remove", id: "note" }])).toThrow("Connections to this object changed");
  expect(current.links).toHaveLength(1);
});

it("keeps readable content separated while preserving regions and deliberate overlaps", () => {
  const objects = [obj("title", { height: 70 }), obj("scene", { y: 80, height: 400 }), obj("foot", { y: 500 }), obj("region", { kind: "region", height: 600 }), obj("beside", { x: 500, y: 80 }), obj("overlap", { y: 20 })];
  expect(surfacePositions(objects, {}).scene).toEqual({ x: 0, y: 80 });
  const result = surfacePositions(objects, { title: { height: 110 } });
  expect(result.scene).toEqual({ x: 0, y: 120 });
  expect(result.foot).toEqual({ x: 0, y: 540 });
  expect(result.region).toEqual({ x: 0, y: 0 });
  expect(result.beside).toEqual({ x: 500, y: 80 });
  expect(result.overlap).toEqual({ x: 0, y: 20 });
  expect(objects[1]?.y).toBe(80);
});
