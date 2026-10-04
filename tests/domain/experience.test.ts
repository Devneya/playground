import { describe, expect, it } from "vitest";
import {
  appendExperience,
  currentExperience,
  emptyExperience,
  experienceLineage,
  experienceReplySchema,
  experienceSchema,
  selectExperience,
  workStateSchema,
  type ExperienceRevision,
  type WorkState,
} from "../../src/domain/experience";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { createWorkspaceExport, parseWorkspaceExport } from "../../src/domain/exportFormat";
import { reduceWorkspace } from "../../src/domain/workspaceReducer";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { emptyHistory, isHistoryAction, pushHistory, redoHistory, undoHistory } from "../../src/domain/workspaceHistory";
import { IndexedDbWorkspaceRepository } from "../../src/persistence/IndexedDbWorkspaceRepository";

const fixedClock = { now: () => new Date("2026-10-03T12:00:00.000Z") };
let fixtureId = 0;
const fixtureIdFactory = () => `fixture-${++fixtureId}`;

const revision = (id: string, parent: string | null = null, overrides: Partial<ExperienceRevision> = {}): ExperienceRevision => ({
  id,
  parent,
  actor: "you",
  label: `Revision ${id}`,
  model: "",
  at: "2026-10-03T12:00:00.000Z",
  title: `Title ${id}`,
  description: "A saved state.",
  html: "<main>Saved experience</main>",
  state: { count: 1 },
  ...overrides,
});

const deepState = (nestedObjects: number): WorkState => {
  const state: Record<string, unknown> = {};
  let cursor = state;
  for (let index = 0; index < nestedObjects; index += 1) {
    const child: Record<string, unknown> = {};
    cursor.child = child;
    cursor = child;
  }
  cursor.value = true;
  return state as WorkState;
};

describe("experience JSON state", () => {
  it("accepts nested JSON values within limits and returns a detached copy", () => {
    const input = { list: [null, true, 3, "hello", { nested: ["world"] }] };
    const output = workStateSchema.parse(input);
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output.list).not.toBe(input.list);
    ((output.list as unknown[])[4] as Record<string, unknown>).nested = [];
    expect(input.list[4]).toEqual({ nested: ["world"] });
  });

  it("bounds depth, UTF-8 bytes, total entries, and individual strings", () => {
    expect(workStateSchema.safeParse(deepState(7)).success).toBe(true);
    expect(workStateSchema.safeParse(deepState(8)).success).toBe(false);
    expect(workStateSchema.safeParse({ first: "é".repeat(7_000), second: "é".repeat(7_000), third: "é".repeat(7_000) }).success).toBe(false);
    expect(workStateSchema.safeParse({ value: "é".repeat(16_001) }).success).toBe(false);
    expect(workStateSchema.safeParse({ value: "x".repeat(8_001) }).success).toBe(false);
    expect(workStateSchema.safeParse({ values: Array.from({ length: 2_001 }, () => 0) }).success).toBe(false);
  });

  it("rejects unsafe keys, non-JSON values, exotic objects, and cycles", () => {
    const dangerous = JSON.parse('{"safe":{"constructor":1}}') as unknown;
    const dangerousProto = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    const dangerousPrototype = JSON.parse('{"nested":{"prototype":1}}') as unknown;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [dangerous, dangerousProto, dangerousPrototype, { value: undefined }, { value: Number.NaN }, { value: Infinity }, { value: 1n }, { value: new Date() }, { value: () => 1 }, cyclic]) {
      expect(workStateSchema.safeParse(value).success).toBe(false);
    }
    const arrayWithExtraKey: unknown[] & { extra?: string } = [];
    arrayWithExtraKey.extra = "not JSON array data";
    expect(workStateSchema.safeParse({ value: arrayWithExtraKey }).success).toBe(false);
    const withGetter = Object.defineProperty({}, "value", { enumerable: true, get: () => "not JSON data" });
    expect(workStateSchema.safeParse(withGetter).success).toBe(false);
  });
});

describe("experience schemas", () => {
  it("strictly validates model replies and preserves supplied HTML as data", () => {
    const html = '<script>parent.postMessage("hello", "*")</script>';
    expect(experienceReplySchema.parse({ title: "A game", description: "A tiny game.", html, state: { score: 0 } }).html).toBe(html);
    expect(experienceReplySchema.safeParse({ title: "", description: "x", html, state: {} }).success).toBe(false);
    expect(experienceReplySchema.safeParse({ title: "x", description: "y", html: "", state: {} }).success).toBe(false);
    expect(experienceReplySchema.safeParse({ title: "x", description: "y", html, state: {}, extra: true }).success).toBe(false);
  });

  it("rejects duplicate ids, forward or missing parents, bad heads, and oversized imports", () => {
    const root = revision("root");
    expect(experienceSchema.safeParse({ head: "root", revisions: [root, root] }).success).toBe(false);
    expect(experienceSchema.safeParse({ head: "child", revisions: [revision("child", "later"), revision("later")] }).success).toBe(false);
    expect(experienceSchema.safeParse({ head: "missing", revisions: [root] }).success).toBe(false);
    expect(experienceSchema.safeParse({ head: null, revisions: [revision("bad id")] }).success).toBe(false);
    expect(experienceSchema.safeParse({ head: null, revisions: [revision("model", null, { actor: "model", model: "" })] }).success).toBe(false);
    const tooLarge = Array.from({ length: 40 }, (_, index) => revision(`r${index}`, null, { html: "x".repeat(48_000) }));
    expect(experienceSchema.safeParse({ head: "r39", revisions: tooLarge }).success).toBe(false);
  });
});

describe("bounded experience history", () => {
  it("starts empty and selects the current revision", () => {
    const empty = emptyExperience();
    expect(empty).toEqual({ head: null, revisions: [] });
    expect(currentExperience(empty)).toBeUndefined();
    const populated = appendExperience(empty, revision("root"));
    expect(currentExperience(populated)?.id).toBe("root");
  });

  it("retains sibling alternatives, selects one, and continues its branch", () => {
    const root = appendExperience(emptyExperience(), revision("root"));
    const first = appendExperience(root, revision("left", "root"));
    const sibling = appendExperience(first, revision("right", "root"), false);
    expect(sibling.head).toBe("left");
    expect(sibling.revisions.map((item) => item.id)).toEqual(["root", "left", "right"]);
    expect(selectExperience(sibling, "right").head).toBe("right");
    const continued = appendExperience(selectExperience(sibling, "right"), revision("right-next", "right"));
    expect(experienceLineage(continued).map((item) => item.id)).toEqual(["root", "right", "right-next"]);
    expect(experienceLineage(selectExperience(sibling, "left")).map((item) => item.id)).toEqual(["root", "left"]);
    expect(() => selectExperience(sibling, "absent")).toThrow();
  });

  it("prunes oldest revisions by count and bytes, repairs dangling parents, and keeps the new head", () => {
    let byCount = emptyExperience();
    for (let index = 0; index < 43; index += 1) {
      byCount = appendExperience(byCount, revision(`count-${index}`, index === 0 ? null : `count-${index - 1}`));
    }
    expect(byCount.revisions).toHaveLength(40);
    expect(byCount.revisions[0]?.id).toBe("count-3");
    expect(byCount.revisions[0]?.parent).toBeNull();
    expect(byCount.head).toBe("count-42");

    let byBytes = emptyExperience();
    for (let index = 0; index < 36; index += 1) {
      byBytes = appendExperience(byBytes, revision(`bytes-${index}`, index === 0 ? null : `bytes-${index - 1}`, { html: "x".repeat(48_000) }));
    }
    expect(byBytes.revisions.length).toBeLessThan(40);
    expect(byBytes.revisions.length).toBeGreaterThan(1);
    expect(byBytes.revisions.at(-1)?.id).toBe("bytes-35");
    expect(experienceSchema.safeParse(byBytes).success).toBe(true);
  });

  it("rejects duplicate, stale-parent, and invalid inputs without mutating callers", () => {
    const original = appendExperience(emptyExperience(), revision("root"));
    const snapshot = structuredClone(original);
    expect(() => appendExperience(original, revision("root"))).toThrow();
    expect(() => appendExperience(original, revision("child", "stale"))).toThrow();
    expect(() => appendExperience(original, revision("bad", "root", { state: { constructor: 1 } }))).toThrow();
    expect(original).toEqual(snapshot);

    const appended = appendExperience(original, revision("child", "root"));
    (appended.revisions[0]!.state as Record<string, unknown>).count = 99;
    expect(original.revisions[0]!.state).toEqual({ count: 1 });
  });
});

describe("experience workspace integration", () => {
  it("persists, exports, and imports an experience without losing revisions or state", async () => {
    const workspace = createStarterWorkspace(fixtureIdFactory, fixedClock);
    const experience = appendExperience(emptyExperience(), revision("root", null, { state: { nested: { score: 7 }, flags: [true, "saved"] } }));
    const withExperience = appendExperience(experience, revision("next", "root", { state: { nested: { score: 8 } } }));
    workspace.flows[0]!.experience = withExperience;

    const exported = createWorkspaceExport(workspace, fixedClock);
    const imported = parseWorkspaceExport(JSON.parse(JSON.stringify(exported)) as unknown);
    expect(imported.workspace.flows[0]!.experience).toEqual(withExperience);

    const repository = new IndexedDbWorkspaceRepository();
    await repository.clearAllBrowserData();
    try {
      await repository.save("experience-user", workspace);
      const loaded = await repository.load("experience-user");
      expect(loaded?.flows[0]?.experience).toEqual(withExperience);
      expect(parseWorkspaceExport(JSON.parse(JSON.stringify(createWorkspaceExport(loaded!, fixedClock)))).workspace.flows[0]!.experience).toEqual(withExperience);
    } finally {
      await repository.clearAllBrowserData();
    }
  });

  it("deep clones revision state when duplicating a flow", () => {
    const workspace = createStarterWorkspace(fixtureIdFactory, fixedClock);
    const flow = workspace.flows[0]!;
    flow.experience = appendExperience(emptyExperience(), revision("root", null, { state: { nested: { score: 7 }, items: ["kept"] } }));

    const duplicate = duplicateFlowWithFreshIds(flow, fixtureIdFactory, fixedClock, "Copy");
    expect(duplicate.experience).toEqual(flow.experience);
    expect(duplicate.experience).not.toBe(flow.experience);
    expect(duplicate.experience!.revisions[0]!.state).not.toBe(flow.experience!.revisions[0]!.state);
    (duplicate.experience!.revisions[0]!.state.nested as Record<string, unknown>).score = 99;
    (duplicate.experience!.revisions[0]!.state.items as unknown[]).push("copy only");
    expect(flow.experience!.revisions[0]!.state).toEqual({ nested: { score: 7 }, items: ["kept"] });
  });

  it("guards set actions against stale head or tail and supports undo/redo", () => {
    const workspace = createStarterWorkspace(fixtureIdFactory, fixedClock);
    const flowId = workspace.flows[0]!.id;
    const context = { idFactory: fixtureIdFactory, clock: fixedClock };
    const first = appendExperience(emptyExperience(), revision("root"));
    const setFirst = { type: "experience/set" as const, flowId, baseHead: null, baseTail: null, experience: first };
    expect(isHistoryAction(setFirst)).toBe(true);
    const changed = reduceWorkspace(workspace, setFirst, context);
    expect(changed.flows[0]!.experience).toEqual(first);

    const history = pushHistory(emptyHistory(), workspace);
    const undone = undoHistory(history, changed)!;
    expect(undone.workspace.flows[0]!.experience).toBeUndefined();
    expect(redoHistory(undone.history, workspace)?.workspace.flows[0]!.experience).toEqual(first);

    const second = appendExperience(first, revision("child", "root"));
    const advanced = reduceWorkspace(changed, { type: "experience/set", flowId, baseHead: "root", baseTail: "root", experience: second }, context);
    expect(advanced.flows[0]!.experience).toEqual(second);

    const staleHead = reduceWorkspace(advanced, { type: "experience/set", flowId, baseHead: "root", baseTail: "child", experience: first }, context);
    const staleTail = reduceWorkspace(advanced, { type: "experience/set", flowId, baseHead: "child", baseTail: "root", experience: first }, context);
    expect(staleHead.flows[0]!.experience).toEqual(second);
    expect(staleTail.flows[0]!.experience).toEqual(second);
  });
});
