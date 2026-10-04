import { expect, it } from "vitest";
import { buildConversationMessages, getConversationPath, updateInputContexts } from "../../src/domain/conversation";
import { reduceWorkspace, type WorkspaceAction } from "../../src/domain/workspaceReducer";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { parseWorkspace } from "../../src/domain/schemas";
import type { ConversationEntry, PlaygroundNode } from "../../src/domain/types";

const clock = { now: () => new Date("2026-10-04T12:00:00Z") };
const setup = () => {
  let serial = 0;
  const context = { clock, idFactory: () => `id-${serial++}` };
  let workspace = createStarterWorkspace(context.idFactory, clock);
  const flow = workspace.flows[0]!;
  const prompt = flow.nodes[0]!;
  const note = (id: string, text: string): PlaygroundNode => ({ id, position: { x: 0, y: 0 }, createdAt: flow.createdAt, updatedAt: flow.updatedAt, data: { kind: "text", origin: "manual", title: id, text } });
  workspace = { ...workspace, flows: [{ ...flow, nodes: [
    { ...prompt, data: { kind: "generation", title: "Generation 1", instruction: "My question", modelIds: ["model"], context: [{ role: "user", content: "KEEP", nodeId: "keep" }, { role: "user", content: "EXCLUDE", nodeId: "exclude" }] } }, note("keep", "KEEP"), note("exclude", "EXCLUDE"), note("new", "NEW")],
    edges: [{ id: "keep-edge", kind: "input", source: "keep", target: prompt.id, order: 0 }, { id: "exclude-edge", kind: "input", source: "exclude", target: prompt.id, order: 1 }],
  }] };
  const dispatch = (action: WorkspaceAction) => { workspace = reduceWorkspace(workspace, action, context); };
  return { get flow() { return workspace.flows[0]!; }, get workspace() { return workspace; }, promptId: prompt.id, context, dispatch };
};

it("removes a piece from the actual request and survives reload without changing canvas content", () => {
  const s = setup();
  s.dispatch({ type: "generation/remove-context", flowId: s.flow.id, nodeId: s.promptId, index: 1 });
  expect(buildConversationMessages(s.flow, s.promptId)).toEqual([{ role: "user", content: "KEEP" }, { role: "user", content: "My question" }]);
  expect(s.flow.nodes.find(node => node.id === "exclude")?.data).toMatchObject({ text: "EXCLUDE" });
  expect(s.flow.edges.map(edge => edge.id)).toEqual(["keep-edge"]);
  const reloaded = parseWorkspace(JSON.parse(JSON.stringify(s.workspace)));
  expect(buildConversationMessages(reloaded.flows[0]!, s.promptId)).toEqual(buildConversationMessages(s.flow, s.promptId));
});

it("clears only prior context, then accepts a new connection without restoring excluded pieces", () => {
  const s = setup();
  s.dispatch({ type: "generation/clear-context", flowId: s.flow.id, nodeId: s.promptId });
  expect(s.flow.edges).toEqual([]);
  expect(buildConversationMessages(s.flow, s.promptId)).toEqual([{ role: "user", content: "My question" }]);
  s.dispatch({ type: "input/add", flowId: s.flow.id, edge: { id: "new-edge", kind: "input", source: "new", target: s.promptId, order: 0 } });
  expect(getConversationPath(s.flow, s.promptId).map(entry => entry.content)).toEqual(["NEW"]);
  s.dispatch({ type: "input/reconnect", flowId: s.flow.id, edgeId: "new-edge", source: "keep", target: s.promptId });
  expect(getConversationPath(s.flow, s.promptId).map(entry => entry.content)).toEqual(["KEEP"]);
  s.dispatch({ type: "input/remove", flowId: s.flow.id, edgeId: "new-edge" });
  expect(buildConversationMessages(s.flow, s.promptId)).toEqual([{ role: "user", content: "My question" }]);
});

it("cannot alter a sent context or remove a nonexistent piece", () => {
  const s = setup();
  s.dispatch({ type: "generation/remove-context", flowId: s.flow.id, nodeId: s.promptId, index: -1 });
  s.dispatch({ type: "generation/clear-context", flowId: s.flow.id, nodeId: "missing" });
  expect(getConversationPath(s.flow, s.promptId)).toHaveLength(2);
  s.flow.batches.push({ id: "batch", generationNodeId: s.promptId, instruction: "My question", promptFormatVersion: 2, startedAt: clock.now().toISOString(), inputs: [], context: structuredClone(getConversationPath(s.flow, s.promptId)), executions: [] });
  const sent = structuredClone(s.flow);
  s.dispatch({ type: "generation/clear-context", flowId: s.flow.id, nodeId: s.promptId });
  expect(s.flow).toEqual(sent);
});

it("removes an ancestor independently while retaining a reply and shared connected history", () => {
  const s = setup();
  const entries: ConversationEntry[] = [{ role: "user", content: "root", nodeId: "root" }, { role: "assistant", content: "reply", nodeId: "reply", modelId: "model" }];
  const prompt = s.flow.nodes[0]!;
  if (prompt.data.kind !== "generation") throw new Error("Missing prompt");
  prompt.data.context = entries;
  s.dispatch({ type: "generation/remove-context", flowId: s.flow.id, nodeId: s.promptId, index: 0 });
  expect(getConversationPath(s.flow, s.promptId)).toEqual([entries[1]]);
  const unchanged = updateInputContexts(s.flow, s.flow.edges);
  expect(unchanged.nodes).toEqual(s.flow.nodes);
});
