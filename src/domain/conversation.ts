import { getInputSnapshots } from "./graph";
import { buildCompletionMessagesV1 } from "./completion";
import { isGeneratedTextNode, isGenerationNode, type CompletionMessage, type ConversationEntry, type FlowDocument, type InputSnapshot, type PlaygroundEdge } from "./types";

export type { ConversationEntry } from "./types";

// Read ancestry from execution snapshots, never from an edited prompt card.
// New runs freeze their context; old workspaces can reconstruct surviving
// ancestors and fall back to the stored input when an ancestor was removed.
export const getContextFromInputs = (flow: FlowDocument, inputs: InputSnapshot[]): ConversationEntry[] => {
  const visited = new Set<string>();
  const visit = (input: InputSnapshot): ConversationEntry[] => {
    if (visited.has(input.nodeId)) return [];
    visited.add(input.nodeId);
    const node = flow.nodes.find((candidate) => candidate.id === input.nodeId);
    const batch = isGeneratedTextNode(node) ? flow.batches.find((candidate) => candidate.id === node.data.batchId) : undefined;
    const execution = isGeneratedTextNode(node) ? batch?.executions.find((candidate) => candidate.id === node.data.executionId) : undefined;
    if (!batch || execution?.status !== "success") return [{ role: "user", content: input.text, nodeId: input.nodeId, ...(input.files ? { files: structuredClone(input.files) } : {}) }];
    const ancestors = batch.context ? batch.context.map((entry) => ({ ...entry })) : batch.inputs.flatMap(visit);
    return [
      ...ancestors,
      ...(batch.instruction.trim() ? [{ role: "user" as const, content: batch.instruction, nodeId: batch.generationNodeId }] : []),
      { role: "assistant", content: input.text, nodeId: input.nodeId, modelId: execution.modelId },
    ];
  };
  return inputs.flatMap(visit);
};

export const getConversationPath = (flow: FlowDocument, generationNodeId: string): ConversationEntry[] => {
  const node = flow.nodes.find((candidate) => candidate.id === generationNodeId);
  return isGenerationNode(node) && node.data.context ? node.data.context.map((entry) => ({ ...entry })) : getContextFromInputs(flow, getInputSnapshots(flow, generationNodeId));
};

// A trimmed context is authoritative. Explicitly adding or removing a wire
// updates that context without reconstructing the pieces the user excluded.
export const updateInputContexts = (flow: FlowDocument, edges: PlaygroundEdge[]): FlowDocument => {
  const next = { ...flow, edges };
  const nodes = flow.nodes.map(node => {
    if (!isGenerationNode(node) || !node.data.context) return node;
    const previousInputs = getInputSnapshots(flow, node.id);
    const nextInputs = getInputSnapshots(next, node.id);
    const removed = previousInputs.filter(input => !nextInputs.some(item => item.nodeId === input.nodeId));
    const added = nextInputs.filter(input => !previousInputs.some(item => item.nodeId === input.nodeId));
    if (!removed.length && !added.length) return node;
    const identity = (entry: ConversationEntry) => `${entry.nodeId}\u0000${entry.role}`;
    const removedIds = new Set(getContextFromInputs(flow, removed).map(identity));
    const retainedIds = new Set(getContextFromInputs(next, nextInputs).map(identity));
    const kept = node.data.context.filter(entry => !removedIds.has(identity(entry)) || retainedIds.has(identity(entry)));
    const merged = [...kept];
    const known = new Set(kept.map(identity));
    for (const entry of getContextFromInputs(next, added)) {
      if (!known.has(identity(entry))) { merged.push(entry); known.add(identity(entry)); }
    }
    return { ...node, data: { ...node.data, context: structuredClone(merged) } };
  });
  return { ...next, nodes };
};

export const buildConversationMessages = (flow: FlowDocument, generationNodeId: string, context = getConversationPath(flow, generationNodeId)): CompletionMessage[] => {
  const prompt = flow.nodes.find((node) => node.id === generationNodeId);
  if (!isGenerationNode(prompt)) return [];
  // Preserve the established formatting for standalone prompts and notes.
  if (!prompt.data.context && !context.some((entry) => entry.role === "assistant")) return buildCompletionMessagesV1(getInputSnapshots(flow, generationNodeId), prompt.data.instruction);
  return [...context.map(({ role, content, files }) => ({ role, content, ...(files ? { files } : {}) })), ...(prompt.data.instruction.trim() ? [{ role: "user" as const, content: prompt.data.instruction }] : [])];
};
