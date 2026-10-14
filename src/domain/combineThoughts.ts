import { LIMITS, utf8ByteLength } from "./limits";
import { nextGenerationIndex } from "./graph";
import { cardHeight, layoutAutomaticNodes } from "./spatialLayout";
import { isGeneratedTextNode, isTextNode, type FlowDocument, type InputEdge, type PlaygroundNode } from "./types";
import type { ReducerContext } from "./workspaceReducer";

export const combineThoughts = (flow: FlowDocument, sourceIds: string[], instruction: string, context: ReducerContext): FlowDocument => {
  const ids = [...new Set(sourceIds)];
  if (utf8ByteLength(instruction) > LIMITS.maxTextBytes || !ids.length || ids.length > LIMITS.maxInputsPerGeneration || flow.nodes.length >= LIMITS.maxNodesPerFlow || flow.edges.length + ids.length > LIMITS.maxEdgesPerFlow) return flow;
  const sources = ids.map((id) => flow.nodes.find((node) => node.id === id));
  if (sources.some((node) => !isTextNode(node) || (isGeneratedTextNode(node) && !flow.batches.some((batch) => batch.executions.some((execution) => execution.id === node.data.executionId && execution.status === "success"))))) return flow;
  const nodes = sources as PlaygroundNode[];
  const anchor = nodes.reduce((lowest, node) => node.position.y + cardHeight(node) > lowest.position.y + cardHeight(lowest) ? node : lowest);
  const firstAnswer = nodes.find(isGeneratedTextNode);
  const model = firstAnswer ? flow.batches.flatMap((batch) => batch.executions).find((execution) => execution.id === firstAnswer.data.executionId)?.modelId : undefined;
  const now = context.clock.now().toISOString();
  const id = context.idFactory();
  const x = Math.min(...nodes.map((node) => node.position.x));
  const prompt: PlaygroundNode = { id, createdAt: now, updatedAt: now, position: { x, y: anchor.position.y + cardHeight(anchor) + 8 }, placement: { anchorId: anchor.id, offsetX: x - anchor.position.x, direction: "below" }, data: { kind: "generation", title: `Generation ${nextGenerationIndex(flow)}`, instruction, modelIds: model ? [model] : [] } };
  const edges: InputEdge[] = ids.map((source, order) => ({ id: context.idFactory(), source, target: id, kind: "input", sourceHandle: "flow-bottom", targetHandle: "flow-top", order }));
  return layoutAutomaticNodes({ ...flow, nodes: [...flow.nodes, prompt], edges: [...flow.edges, ...edges] });
};
