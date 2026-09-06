import { describe, expect, it } from "vitest";
import { parseWorkspaceExport } from "../../src/domain/exportFormat";
import { parseWorkspace } from "../../src/domain/schemas";
import { validateWorkspaceInvariants } from "../../src/domain/graph";

const stamp = "2026-01-01T00:00:00.000Z";

const v1Workspace = () => ({
  schemaVersion: 1 as const,
  activeFlowId: "flow",
  flows: [{
    id: "flow",
    name: "Untitled flow",
    nodes: [
      { id: "t1", position: { x: 80, y: 120 }, data: { kind: "text", origin: "manual", title: "Text 1", text: "hello" }, createdAt: stamp, updatedAt: stamp },
      { id: "t2", position: { x: 80, y: 400 }, data: { kind: "text", origin: "manual", title: "Text 2", text: "world" }, createdAt: stamp, updatedAt: stamp },
      { id: "g1", position: { x: 500, y: 120 }, data: { kind: "generation", title: "Generation 1", instruction: "Summarize", modelIds: ["model-a"] }, createdAt: stamp, updatedAt: stamp },
      { id: "r1", position: { x: 860, y: 120 }, data: { kind: "text", origin: "generated", title: "model-a", text: "out", batchId: "b", executionId: "e" }, createdAt: stamp, updatedAt: stamp },
    ],
    edges: [
      { id: "e1", kind: "input", source: "t1", target: "g1", order: 0 },
      { id: "e2", kind: "input", source: "t2", target: "g1", order: 1 },
      { id: "e3", kind: "result", source: "g1", target: "r1" },
    ],
    batches: [{ id: "b", generationNodeId: "g1", startedAt: stamp, promptFormatVersion: 1 as const, instruction: "Summarize", inputs: [], executions: [{ id: "e", modelId: "model-a", status: "success" as const, startedAt: stamp, outputNodeId: "r1" }] }],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: stamp,
    updatedAt: stamp,
  }],
  createdAt: stamp,
  updatedAt: stamp,
});

describe("v1 to v2 migration", () => {
  it("converts generations to prompts and texts to contents with ids intact", () => {
    const migrated = parseWorkspace(v1Workspace());
    expect(migrated.schemaVersion).toBe(2);
    expect(validateWorkspaceInvariants(migrated)).toEqual([]);
    const kinds = migrated.flows[0]!.nodes.map((node) => node.data.kind).sort();
    expect(kinds).toEqual(["content", "content", "content", "prompt"]);
    const prompt = migrated.flows[0]!.nodes.find((node) => node.data.kind === "prompt")!;
    expect(prompt.id).toBe("g1");
    expect(prompt.data).toMatchObject({ title: "Generation 1", prompt: "Summarize", modelIds: ["model-a"] });
    expect(migrated.flows[0]!.edges.filter((edge) => edge.kind === "input")).toHaveLength(1);
    expect(migrated.flows[0]!.batches[0]).toMatchObject({ promptNodeId: "g1" });
  });

  it("accepts v1 exports and emits v2", () => {
    const parsed = parseWorkspaceExport({ format: "devneya-flow-v1", exportedAt: stamp, workspace: v1Workspace() });
    expect(parsed.workspace.schemaVersion).toBe(2);
    expect(validateWorkspaceInvariants(parsed.workspace)).toEqual([]);
  });

  it("rejects documents that are neither v2 nor v1", () => {
    expect(() => parseWorkspace({ schemaVersion: 9, activeFlowId: "x", flows: [], createdAt: stamp, updatedAt: stamp })).toThrow();
    expect(() => parseWorkspaceExport({ format: "devneya-flow-v9", exportedAt: stamp, workspace: v1Workspace() })).toThrow();
  });
});
