import { LIMITS, codePointLength, utf8ByteLength } from "./limits";
import type { FlowDocument, InputEdge, InputSnapshot, PlaygroundEdge, WorkspaceDocument } from "./types";
import { isGeneratedTextNode, isGenerationNode, isTextNode } from "./types";

export const getNode = (flow: FlowDocument, nodeId: string) => flow.nodes.find((node) => node.id === nodeId);

export const getOrderedInputEdges = (flow: FlowDocument, generationNodeId: string): InputEdge[] =>
  flow.edges.filter((edge): edge is InputEdge => edge.kind === "input" && edge.target === generationNodeId).sort((a, b) => a.order - b.order);

export const getInputSnapshots = (flow: FlowDocument, generationNodeId: string): InputSnapshot[] =>
  getOrderedInputEdges(flow, generationNodeId).flatMap((edge) => {
    const node = getNode(flow, edge.source);
    return isTextNode(node) ? [{ nodeId: node.id, title: node.data.title, text: node.data.text }] : [];
  });

export const hasDirectedPath = (flow: FlowDocument, fromId: string, toId: string, ignoredEdgeId?: string) => {
  if (fromId === toId) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of flow.edges) {
    if (edge.id === ignoredEdgeId) continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (nodeId === toId) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    return (adjacency.get(nodeId) ?? []).some(visit);
  };
  return visit(fromId);
};

export const canAddInputConnection = (flow: FlowDocument, sourceTextId: string, targetGenerationId: string, ignoredEdgeId?: string): { allowed: true } | { allowed: false; reason: string } => {
  const source = getNode(flow, sourceTextId);
  const target = getNode(flow, targetGenerationId);
  if (!isTextNode(source) || !isGenerationNode(target)) return { allowed: false, reason: "Connect Text to Generation only." };
  if (source.id === target.id) return { allowed: false, reason: "A node cannot connect to itself." };
  if (isGeneratedTextNode(source)) {
    const execution = flow.batches.flatMap((batch) => batch.executions).find((item) => item.id === source.data.executionId);
    if (!execution || execution.status !== "success") return { allowed: false, reason: "Only successful results can be used as inputs." };
  }
  if (getOrderedInputEdges(flow, target.id).some((edge) => edge.id !== ignoredEdgeId && edge.source === source.id)) return { allowed: false, reason: "That Text node is already connected." };
  if (getOrderedInputEdges(flow, target.id).filter((edge) => edge.id !== ignoredEdgeId).length >= LIMITS.maxInputsPerGeneration) return { allowed: false, reason: `A Generation node can have at most ${LIMITS.maxInputsPerGeneration} inputs.` };
  if (hasDirectedPath(flow, target.id, source.id, ignoredEdgeId)) return { allowed: false, reason: "That connection would create a cycle." };
  return { allowed: true };
};

export const normalizeInputOrder = (edges: PlaygroundEdge[], generationNodeId?: string): PlaygroundEdge[] => {
  const result = edges.map((edge) => ({ ...edge }));
  const targets = generationNodeId ? [generationNodeId] : Array.from(new Set(result.filter((edge) => edge.kind === "input").map((edge) => edge.target)));
  for (const target of targets) {
    result.filter((edge): edge is InputEdge => edge.kind === "input" && edge.target === target).sort((a, b) => a.order - b.order).forEach((edge, index) => { edge.order = index; });
  }
  return result;
};

const duplicateIds = (values: string[]) => values.filter((value, index) => values.indexOf(value) !== index);

const hasAnyCycle = (flow: FlowDocument) => {
  const adjacency = new Map<string, string[]>();
  for (const edge of flow.edges) adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    if ((adjacency.get(nodeId) ?? []).some(visit)) return true;
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return flow.nodes.some((node) => visit(node.id));
};

export const validateWorkspaceInvariants = (workspace: WorkspaceDocument): string[] => {
  const errors: string[] = [];
  if (workspace.schemaVersion !== 1) errors.push("Unsupported workspace schema version.");
  if (workspace.flows.length === 0) errors.push("Workspace must contain a flow.");
  if (!workspace.flows.some((flow) => flow.id === workspace.activeFlowId)) errors.push("Active flow does not exist.");
  if (workspace.flows.length > LIMITS.maxFlows) errors.push("Too many flows.");
  const flowIds = workspace.flows.map((flow) => flow.id);
  if (duplicateIds(flowIds).length) errors.push("Duplicate flow IDs.");
  for (const flow of workspace.flows) {
    if (flow.nodes.length > LIMITS.maxNodesPerFlow) errors.push(`Flow ${flow.id} has too many nodes.`);
    if (flow.edges.length > LIMITS.maxEdgesPerFlow) errors.push(`Flow ${flow.id} has too many edges.`);
    const nodeIds = flow.nodes.map((node) => node.id);
    if (duplicateIds(nodeIds).length) errors.push(`Flow ${flow.id} has duplicate node IDs.`);
    const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
    const edgeIds = flow.edges.map((edge) => edge.id);
    if (duplicateIds(edgeIds).length) errors.push(`Flow ${flow.id} has duplicate edge IDs.`);
    for (const node of flow.nodes) {
      if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) errors.push(`Node ${node.id} has an invalid position.`);
      if (codePointLength(node.data.title) > LIMITS.maxNodeTitleCodePoints) errors.push(`Node ${node.id} title is too long.`);
      if (node.data.kind === "generation") {
        if (node.data.modelIds.length > LIMITS.maxModelsPerBatch || new Set(node.data.modelIds).size !== node.data.modelIds.length) errors.push(`Node ${node.id} has invalid model selection.`);
        if (utf8ByteLength(node.data.instruction) > LIMITS.maxTextBytes) errors.push(`Node ${node.id} instruction is too large.`);
      } else if (utf8ByteLength(node.data.text) > (node.data.origin === "generated" ? LIMITS.maxGeneratedBytes : LIMITS.maxTextBytes)) errors.push(`Node ${node.id} text is too large.`);
    }
    for (const edge of flow.edges) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target) { errors.push(`Edge ${edge.id} has a missing endpoint.`); continue; }
      if (edge.kind === "input") {
        if (!isTextNode(source) || !isGenerationNode(target)) errors.push(`Input edge ${edge.id} has invalid endpoints.`);
        if (isGeneratedTextNode(source)) {
          const execution = flow.batches.flatMap((batch) => batch.executions).find((item) => item.id === source.data.executionId);
          if (!execution || execution.status !== "success") errors.push(`Input edge ${edge.id} uses an unavailable result.`);
        }
      } else if (!isGenerationNode(source) || !isGeneratedTextNode(target)) errors.push(`Result edge ${edge.id} has invalid endpoints.`);
    }
    for (const generation of flow.nodes.filter(isGenerationNode)) {
      const inputEdges = getOrderedInputEdges(flow, generation.id);
      if (inputEdges.some((edge, index) => edge.order !== index)) errors.push(`Generation ${generation.id} input order is not contiguous.`);
      if (new Set(inputEdges.map((edge) => edge.source)).size !== inputEdges.length) errors.push(`Generation ${generation.id} has duplicate inputs.`);
    }
    for (const node of flow.nodes.filter(isGeneratedTextNode)) {
      const execution = flow.batches.flatMap((batch) => batch.executions).find((item) => item.id === node.data.executionId);
      if (!execution || execution.outputNodeId !== node.id || execution.modelId !== node.data.title) errors.push(`Generated node ${node.id} has an invalid provenance reference.`);
    }
    for (const batch of flow.batches) {
      if (!nodes.has(batch.generationNodeId)) errors.push(`Batch ${batch.id} has a missing source generation node.`);
      if (batch.executions.length > LIMITS.maxModelsPerBatch || new Set(batch.executions.map((execution) => execution.modelId)).size !== batch.executions.length) errors.push(`Batch ${batch.id} has invalid executions.`);
      for (const execution of batch.executions) {
        if (execution.outputNodeId) {
          const output = nodes.get(execution.outputNodeId);
          if (!isGeneratedTextNode(output) || output.data.executionId !== execution.id) errors.push(`Execution ${execution.id} points to the wrong output.`);
        }
      }
    }
    if (hasAnyCycle(flow)) errors.push(`Flow ${flow.id} contains a cycle.`);
  }
  return errors;
};
