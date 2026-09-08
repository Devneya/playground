import { getInputSnapshots } from "./graph";
import { buildCompletionMessagesV1 } from "./completion";
import { isGeneratedTextNode, isGenerationNode, type CompletionMessage, type ConversationEntry, type FlowDocument, type InputSnapshot } from "./types";

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
    if (!batch || execution?.status !== "success") return [{ role: "user", content: input.text, nodeId: input.nodeId }];
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

export const buildConversationMessages = (flow: FlowDocument, generationNodeId: string, context = getConversationPath(flow, generationNodeId)): CompletionMessage[] => {
  const prompt = flow.nodes.find((node) => node.id === generationNodeId);
  if (!isGenerationNode(prompt)) return [];
  // Preserve the established formatting for standalone prompts and notes.
  if (!prompt.data.context && !context.some((entry) => entry.role === "assistant")) return buildCompletionMessagesV1(getInputSnapshots(flow, generationNodeId), prompt.data.instruction);
  return [...context.map(({ role, content }) => ({ role, content })), ...(prompt.data.instruction.trim() ? [{ role: "user" as const, content: prompt.data.instruction }] : [])];
};
