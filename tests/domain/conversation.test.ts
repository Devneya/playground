import { describe, expect, it, vi } from "vitest";
import { toBifrostVirtualKey } from "../../src/api/credentials";
import { startGenerationRun } from "../../src/features/execution/executeGeneration";
import { createChatCompletion } from "../../src/api/completions";
import type { WorkspaceAction } from "../../src/domain/workspaceReducer";
import { buildConversationMessages, getConversationPath } from "../../src/domain/conversation";
import { duplicateFlowWithFreshIds } from "../../src/domain/duplicateFlow";
import { parseWorkspace } from "../../src/domain/schemas";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import type { FlowDocument, PlaygroundNode } from "../../src/domain/types";

vi.mock("../../src/api/completions", () => ({ createChatCompletion: vi.fn(async () => ({ content: "Measure retention." })) }));

const now = "2026-09-07T12:00:00.000Z";
const prompt = (id: string, instruction: string): PlaygroundNode => ({ id, createdAt: now, updatedAt: now, position: { x: 0, y: 0 }, data: { kind: "generation", title: id, instruction, modelIds: ["test-model"] } });
const fixture = (): FlowDocument => ({
  id: "flow", name: "Thread", createdAt: now, updatedAt: now, viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [prompt("question", "Edited after the response"), { ...prompt("answer", ""), data: { kind: "text", origin: "generated", title: "test-model", text: "Use a small launch.", batchId: "batch", executionId: "execution" } }, prompt("followup", "What should we measure?")],
  edges: [{ id: "result", kind: "result", source: "question", target: "answer" }, { id: "input", kind: "input", source: "answer", target: "followup", order: 0 }],
  batches: [{ id: "batch", generationNodeId: "question", startedAt: now, instruction: "How should we launch?", inputs: [], promptFormatVersion: 1, executions: [{ id: "execution", modelId: "test-model", status: "success", startedAt: now, outputNodeId: "answer" }] }],
});

describe("conversation history", () => {
  it("sends the original question and answer before the new message", () => {
    expect(buildConversationMessages(fixture(), "followup")).toEqual([
      { role: "user", content: "How should we launch?" },
      { role: "assistant", content: "Use a small launch." },
      { role: "user", content: "What should we measure?" },
    ]);
  });

  it("does not include sibling answers or mutable upstream prompt text", () => {
    const flow = fixture();
    flow.nodes.push({ ...flow.nodes[1]!, id: "sibling", data: { kind: "text", origin: "generated", title: "other-model", text: "Sibling secret", batchId: "batch", executionId: "other" } });
    flow.batches[0]!.executions.push({ id: "other", modelId: "other-model", status: "success", startedAt: now, outputNodeId: "sibling" });
    expect(JSON.stringify(getConversationPath(flow, "followup"))).not.toMatch(/Sibling secret|Edited after/);
  });

  it("uses frozen context even after its ancestor was removed", () => {
    const flow = fixture();
    flow.batches[0]!.context = [{ role: "user", content: "Keep the budget low.", nodeId: "removed" }];
    expect(getConversationPath(flow, "followup").map((entry) => entry.content)).toEqual(["Keep the budget low.", "How should we launch?", "Use a small launch."]);
    getConversationPath(flow, "followup")[0]!.content = "Mutation";
    expect(flow.batches[0]!.context[0]!.content).toBe("Keep the budget low.");
  });

  it("reconstructs an older multi-turn branch through input snapshots", () => {
    const flow = fixture();
    flow.batches.push({ id: "second-batch", generationNodeId: "followup", startedAt: now, promptFormatVersion: 1, instruction: "What should we measure?", inputs: [{ nodeId: "answer", title: "test-model", text: "Use a small launch." }], executions: [{ id: "second-execution", modelId: "second-model", status: "success", startedAt: now, outputNodeId: "second-answer" }] });
    flow.nodes.push({ ...prompt("second-answer", ""), data: { kind: "text", origin: "generated", title: "second-model", text: "Measure retention.", batchId: "second-batch", executionId: "second-execution" } }, prompt("third", "Explain retention."));
    flow.edges.push({ id: "third-input", kind: "input", source: "second-answer", target: "third", order: 0 });
    expect(buildConversationMessages(flow, "third").map((entry) => entry.content)).toEqual(["How should we launch?", "Use a small launch.", "What should we measure?", "Measure retention.", "Explain retention."]);
  });

  it("preserves standalone formatting and handles a missing generation", () => {
    expect(buildConversationMessages(fixture(), "question")).toEqual([{ role: "user", content: "Edited after the response" }]);
    expect(buildConversationMessages(fixture(), "missing")).toEqual([]);
  });

  it("retains a manual note as explicit context", () => {
    const flow = fixture();
    flow.nodes[1]!.data = { kind: "text", origin: "manual", title: "Budget", text: "Under 100." };
    expect(buildConversationMessages(flow, "followup")).toEqual([{ role: "user", content: "### Input 1: Budget\nUnder 100.\n\n### Instruction\nWhat should we measure?" }]);
  });

  it("bounds reconstruction of malformed legacy cycles", () => {
    const flow = fixture();
    flow.batches[0]!.inputs = [{ nodeId: "answer", title: "Answer", text: "Use a small launch." }];
    expect(getConversationPath(flow, "followup")).toHaveLength(2);
  });

  it("does not turn a failed result into an assistant history turn", () => {
    const flow = fixture();
    flow.batches[0]!.executions[0]!.status = "failed";
    expect(getConversationPath(flow, "followup")[0]!.role).toBe("user");
  });

  it("handles empty frozen instructions and empty current instructions", () => {
    const flow = fixture();
    flow.batches[0]!.instruction = "";
    const followup = flow.nodes.find((node) => node.id === "followup")!;
    if (followup.data.kind === "generation") followup.data.instruction = "";

    expect(getConversationPath(flow, "followup")).toEqual([
      { role: "assistant", content: "Use a small launch.", nodeId: "answer", modelId: "test-model" },
    ]);
    expect(buildConversationMessages(flow, "followup")).toEqual([{ role: "assistant", content: "Use a small launch." }]);
  });

  it("returns no path for a non-generation node", () => {
    expect(getConversationPath(fixture(), "answer")).toEqual([]);
  });

  it("prefers context frozen on the generation node", () => {
    const flow = fixture();
    const followup = flow.nodes.find((node) => node.id === "followup")!;
    if (followup.data.kind === "generation") followup.data.context = [{ role: "user", content: "Frozen input", nodeId: "removed" }];

    expect(getConversationPath(flow, "followup")).toEqual([{ role: "user", content: "Frozen input", nodeId: "removed" }]);
  });

  it("reads saved context and remaps its source references on duplication", () => {
    const flow = fixture();
    flow.batches[0]!.context = [{ role: "user", content: "Original", nodeId: "question" }];
    flow.batches[0]!.promptFormatVersion = 2;
    const workspace = createStarterWorkspace();
    workspace.flows = [flow];
    workspace.activeFlowId = flow.id;
    expect(parseWorkspace(workspace).flows[0]!.batches[0]!.context).toEqual(flow.batches[0]!.context);
    let id = 0;
    const copy = duplicateFlowWithFreshIds(flow, () => `fresh-${id++}`, { now: () => new Date(now) });
    expect(copy.batches[0]!.context![0]!.nodeId).toBe(copy.nodes[0]!.id);
    expect(copy.batches[0]!.context).not.toBe(flow.batches[0]!.context);
  });

  it("rejects oversized history before creating a run or calling the provider", () => {
    const flow = fixture();
    flow.batches[0]!.context = [{ role: "user", content: "x".repeat(256 * 1024), nodeId: "older" }];
    const dispatch = vi.fn();
    expect(() => startGenerationRun({ flow, generationNodeId: "followup", virtualKey: toBifrostVirtualKey("sk-bf-test"), idFactory: () => "unused", clock: { now: () => new Date(now) }, dispatch })).toThrow("This conversation is too large to send.");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("freezes and sends history when starting a threaded run", async () => {
    const flow = fixture();
    const actions: WorkspaceAction[] = [];
    let id = 0;
    const run = startGenerationRun({ flow, generationNodeId: "followup", virtualKey: toBifrostVirtualKey("sk-bf-test"), idFactory: () => `run-${id++}`, clock: { now: () => new Date(now) }, dispatch: (action) => actions.push(action) });
    await run.completed;
    expect(createChatCompletion).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ messages: buildConversationMessages(flow, "followup") }), expect.any(AbortSignal));
    const started = actions.find((action) => action.type === "batch/started");
    expect(started).toMatchObject({ batch: { promptFormatVersion: 2, context: getConversationPath(flow, "followup") } });
  });
});
