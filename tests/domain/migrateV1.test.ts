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

const v2Workspace = () => ({
  schemaVersion: 2 as const,
  activeFlowId: "flow",
  flows: [{
    id: "flow",
    name: "Untitled flow",
    nodes: [
      { id: "t1", position: { x: 80, y: 120 }, data: { kind: "content", origin: "imported", title: "Text 1", text: "hello" }, createdAt: stamp, updatedAt: stamp },
      { id: "t2", position: { x: 860, y: 120 }, data: { kind: "content", origin: "generated", title: "model-a", text: "out", modelId: "model-a", batchId: "b", executionId: "e" }, createdAt: stamp, updatedAt: stamp },
      { id: "g1", position: { x: 500, y: 120 }, data: { kind: "prompt", title: "Prompt 1", prompt: "Summarize", modelIds: ["model-a"] }, createdAt: stamp, updatedAt: stamp },
    ],
    edges: [
      { id: "e1", kind: "input", source: "t1", target: "g1", order: 0 },
      { id: "e3", kind: "result", source: "g1", target: "t2" },
    ],
    batches: [{ id: "b", promptNodeId: "g1", startedAt: stamp, promptFormatVersion: 1 as const, instruction: "Summarize", inputs: [], executions: [{ id: "e", modelId: "model-a", status: "success" as const, startedAt: stamp, outputNodeId: "t2" }] }],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: stamp,
    updatedAt: stamp,
  }],
  createdAt: stamp,
  updatedAt: stamp,
});

describe("v1 to v3 migration", () => {
  it("bumps a v1 workspace forward to v3 with ids and vocabulary intact", () => {
    const migrated = parseWorkspace(v1Workspace());
    expect(migrated.schemaVersion).toBe(3);
    expect(validateWorkspaceInvariants(migrated)).toEqual([]);
    const kinds = migrated.flows[0]!.nodes.map((node) => node.data.kind).sort();
    expect(kinds).toEqual(["generation", "text", "text", "text"]);
    const generation = migrated.flows[0]!.nodes.find((node) => node.data.kind === "generation")!;
    expect(generation.id).toBe("g1");
    expect(generation.data).toMatchObject({ title: "Generation 1", instruction: "Summarize", modelIds: ["model-a"] });
    expect(migrated.flows[0]!.batches[0]).toMatchObject({ generationNodeId: "g1" });
  });

  it("remaps a v2 workspace to v3 (content/prompt -> text/generation)", () => {
    const migrated = parseWorkspace(v2Workspace());
    expect(migrated.schemaVersion).toBe(3);
    expect(validateWorkspaceInvariants(migrated)).toEqual([]);
    const kinds = migrated.flows[0]!.nodes.map((node) => node.data.kind).sort();
    expect(kinds).toEqual(["generation", "text", "text"]);
    const generation = migrated.flows[0]!.nodes.find((node) => node.data.kind === "generation")!;
    expect(generation.data).toMatchObject({ title: "Prompt 1", instruction: "Summarize", modelIds: ["model-a"] });
    const generated = migrated.flows[0]!.nodes.find((node) => node.data.kind === "text" && node.data.origin === "generated")!;
    expect(generated.data).toMatchObject({ title: "model-a", text: "out", batchId: "b", executionId: "e" });
    expect(migrated.flows[0]!.batches[0]).toMatchObject({ generationNodeId: "g1" });
    expect(JSON.stringify(migrated)).not.toContain("promptNodeId");
  });

  it("accepts v1 and v2 exports and emits v3", () => {
    const parsedV1 = parseWorkspaceExport({ format: "devneya-flow-v1", exportedAt: stamp, workspace: v1Workspace() });
    expect(parsedV1.workspace.schemaVersion).toBe(3);
    expect(validateWorkspaceInvariants(parsedV1.workspace)).toEqual([]);
    const parsedV2 = parseWorkspaceExport({ format: "devneya-flow-v2", exportedAt: stamp, workspace: v2Workspace() });
    expect(parsedV2.workspace.schemaVersion).toBe(3);
    expect(validateWorkspaceInvariants(parsedV2.workspace)).toEqual([]);
  });

  it("rejects documents that are neither v2 nor v1", () => {
    expect(() => parseWorkspace({ schemaVersion: 9, activeFlowId: "x", flows: [], createdAt: stamp, updatedAt: stamp })).toThrow();
    expect(() => parseWorkspaceExport({ format: "devneya-flow-v9", exportedAt: stamp, workspace: v1Workspace() })).toThrow();
  });
});
