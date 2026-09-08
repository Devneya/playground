import type { Clock, FlowDocument, GeneratedTextData, IdFactory, PlaygroundEdge, PlaygroundNode } from "./types";

export const duplicateFlowWithFreshIds = (flow: FlowDocument, idFactory: IdFactory, clock: Clock, requestedName?: string): FlowDocument => {
  const nodeIds = new Map(flow.nodes.map((node) => [node.id, idFactory()]));
  const edgeIds = new Map(flow.edges.map((edge) => [edge.id, idFactory()]));
  const batchIds = new Map(flow.batches.map((batch) => [batch.id, idFactory()]));
  const executionIds = new Map(flow.batches.flatMap((batch) => batch.executions).map((execution) => [execution.id, idFactory()]));
  const now = clock.now().toISOString();
  const remapNode = (node: PlaygroundNode): PlaygroundNode => {
    const base: PlaygroundNode = { ...node, id: nodeIds.get(node.id) ?? node.id, position: { ...node.position }, ...(node.placement ? { placement: { ...node.placement, anchorId: nodeIds.get(node.placement.anchorId) ?? node.placement.anchorId } } : {}), createdAt: now, updatedAt: now };
    if (node.data.kind === "generation") return { ...base, data: { ...node.data, ...(node.data.context ? { context: node.data.context.map((entry) => ({ ...entry, nodeId: nodeIds.get(entry.nodeId) ?? entry.nodeId })) } : {}), ...(node.data.branchedFrom ? { branchedFrom: { nodeId: nodeIds.get(node.data.branchedFrom.nodeId) ?? node.data.branchedFrom.nodeId, batchId: batchIds.get(node.data.branchedFrom.batchId) ?? node.data.branchedFrom.batchId } } : {}) } };
    if (node.data.kind === "text" && node.data.origin === "generated") {
      const batchId = node.data.batchId ? batchIds.get(node.data.batchId) ?? node.data.batchId : undefined;
      const executionId = node.data.executionId ? executionIds.get(node.data.executionId) ?? node.data.executionId : undefined;
      const data: GeneratedTextData = { ...node.data };
      if (batchId !== undefined) data.batchId = batchId;
      if (executionId !== undefined) data.executionId = executionId;
      return { ...base, data };
    }
    if (node.data.kind === "text" && node.data.origin === "manual" && node.data.source) {
      const source = node.data.source;
      return { ...base, data: { ...node.data, source: { ...source, nodeId: nodeIds.get(source.nodeId) ?? source.nodeId, batchId: batchIds.get(source.batchId) ?? source.batchId, executionId: executionIds.get(source.executionId) ?? source.executionId } } };
    }
    return base;
  };
  const edges: PlaygroundEdge[] = flow.edges.map((edge) => ({ ...edge, id: edgeIds.get(edge.id) ?? edge.id, source: nodeIds.get(edge.source) ?? edge.source, target: nodeIds.get(edge.target) ?? edge.target }));
  const batches = flow.batches.map((batch) => ({
    ...batch,
    id: batchIds.get(batch.id) ?? batch.id,
    generationNodeId: nodeIds.get(batch.generationNodeId) ?? batch.generationNodeId,
    inputs: batch.inputs.map((input) => ({ ...input, nodeId: nodeIds.get(input.nodeId) ?? input.nodeId })),
    ...(batch.context ? { context: batch.context.map((entry) => ({ ...entry, nodeId: nodeIds.get(entry.nodeId) ?? entry.nodeId })) } : {}),
    executions: batch.executions.map((execution) => ({ ...execution, id: executionIds.get(execution.id) ?? execution.id, ...(execution.outputNodeId ? { outputNodeId: nodeIds.get(execution.outputNodeId) ?? execution.outputNodeId } : {}) })),
  }));
  return { ...flow, id: idFactory(), ...(requestedName ? { name: requestedName } : {}), nodes: flow.nodes.map(remapNode), edges, batches, createdAt: now, updatedAt: now, viewport: { ...flow.viewport } };
};
