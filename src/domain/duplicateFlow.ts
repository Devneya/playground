import type { Clock, FlowDocument, IdFactory, PlaygroundEdge, PlaygroundNode } from "./types";

export const duplicateFlowWithFreshIds = (flow: FlowDocument, idFactory: IdFactory, clock: Clock, requestedName?: string): FlowDocument => {
  const nodeIds = new Map(flow.nodes.map((node) => [node.id, idFactory()]));
  const edgeIds = new Map(flow.edges.map((edge) => [edge.id, idFactory()]));
  const batchIds = new Map(flow.batches.map((batch) => [batch.id, idFactory()]));
  const executionIds = new Map(flow.batches.flatMap((batch) => batch.executions).map((execution) => [execution.id, idFactory()]));
  const now = clock.now().toISOString();
  const remapNode = (node: PlaygroundNode): PlaygroundNode => {
    const data = node.data.kind === "text" && node.data.origin === "generated"
      ? { ...node.data, batchId: batchIds.get(node.data.batchId) ?? node.data.batchId, executionId: executionIds.get(node.data.executionId) ?? node.data.executionId }
      : node.data.kind === "text" ? { ...node.data } : { ...node.data, modelIds: [...node.data.modelIds] };
    return { ...node, id: nodeIds.get(node.id) ?? node.id, data, position: { ...node.position }, createdAt: now, updatedAt: now };
  };
  const edges: PlaygroundEdge[] = flow.edges.map((edge) => ({ ...edge, id: edgeIds.get(edge.id) ?? edge.id, source: nodeIds.get(edge.source) ?? edge.source, target: nodeIds.get(edge.target) ?? edge.target }));
  const batches = flow.batches.map((batch) => ({
    ...batch,
    id: batchIds.get(batch.id) ?? batch.id,
    generationNodeId: nodeIds.get(batch.generationNodeId) ?? batch.generationNodeId,
    inputs: batch.inputs.map((input) => ({ ...input, nodeId: nodeIds.get(input.nodeId) ?? input.nodeId })),
    executions: batch.executions.map((execution) => ({ ...execution, id: executionIds.get(execution.id) ?? execution.id, ...(execution.outputNodeId ? { outputNodeId: nodeIds.get(execution.outputNodeId) ?? execution.outputNodeId } : {}) })),
  }));
  return { ...flow, id: idFactory(), ...(requestedName ? { name: requestedName } : {}), nodes: flow.nodes.map(remapNode), edges, batches, createdAt: now, updatedAt: now, viewport: { ...flow.viewport } };
};
