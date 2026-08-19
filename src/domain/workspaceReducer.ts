import { canAddInputConnection, getOrderedInputEdges, normalizeInputOrder } from "./graph";
import { createBlankFlow } from "./workspaceFactory";
import type { Clock, ExecutionBatch, ExecutionError, FlowDocument, IdFactory, PlaygroundEdge, PlaygroundNode, WorkspaceDocument } from "./types";
import { isGeneratedTextNode, isGenerationNode, isManualTextNode } from "./types";

export type WorkspaceAction =
  | { type: "flow/create"; flow: FlowDocument }
  | { type: "flow/activate"; flowId: string }
  | { type: "flow/rename"; flowId: string; name: string }
  | { type: "flow/duplicate"; flowId: string; duplicate: FlowDocument }
  | { type: "flow/delete"; flowId: string }
  | { type: "node/add"; flowId: string; node: PlaygroundNode }
  | { type: "node/move"; flowId: string; nodeId: string; position: { x: number; y: number } }
  | { type: "node/rename"; flowId: string; nodeId: string; title: string }
  | { type: "node/edit-text"; flowId: string; nodeId: string; text: string }
  | { type: "node/edit-instruction"; flowId: string; nodeId: string; instruction: string }
  | { type: "node/set-models"; flowId: string; nodeId: string; modelIds: string[] }
  | { type: "node/delete"; flowId: string; nodeId: string }
  | { type: "node/make-editable"; flowId: string; node: PlaygroundNode }
  | { type: "node/duplicate"; flowId: string; node: PlaygroundNode }
  | { type: "input/add"; flowId: string; edge: PlaygroundEdge }
  | { type: "input/reconnect"; flowId: string; edgeId: string; source: string; target: string }
  | { type: "input/remove"; flowId: string; edgeId: string }
  | { type: "input/move"; flowId: string; edgeId: string; direction: "up" | "down" }
  | { type: "viewport/update"; flowId: string; viewport: { x: number; y: number; zoom: number } }
  | { type: "batch/started"; flowId: string; batch: ExecutionBatch; outputNodes: PlaygroundNode[]; resultEdges: PlaygroundEdge[] }
  | { type: "execution/succeeded"; flowId: string; batchId: string; executionId: string; text: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }; durationMs: number }
  | { type: "execution/failed"; flowId: string; batchId: string; executionId: string; error: ExecutionError; durationMs: number }
  | { type: "execution/cancelled"; flowId: string; batchId: string; executionId: string; error: ExecutionError; durationMs: number }
  | { type: "batch/completed"; flowId: string; batchId: string; completedAt: string }
  | { type: "workspace/imported"; workspace: WorkspaceDocument }
  | { type: "workspace/reset"; workspace: WorkspaceDocument };

export type ReducerContext = { idFactory: IdFactory; clock: Clock };

const updateFlow = (workspace: WorkspaceDocument, flowId: string, context: ReducerContext, update: (flow: FlowDocument) => FlowDocument) => {
  const updatedAt = context.clock.now().toISOString();
  return { ...workspace, updatedAt, flows: workspace.flows.map((flow) => {
    if (flow.id !== flowId) return flow;
    return { ...update(flow), updatedAt };
  }) };
};

const removeResultNode = (flow: FlowDocument, nodeId: string) => {
  const node = flow.nodes.find((item) => item.id === nodeId);
  const batchIds = node && isGenerationNode(node) ? new Set(flow.batches.filter((batch) => batch.generationNodeId === nodeId).map((batch) => batch.id)) : new Set<string>();
  const removedNodeIds = new Set([nodeId, ...flow.nodes.filter((item) => isGeneratedTextNode(item) && batchIds.has(item.data.batchId)).map((item) => item.id)]);
  const edges = flow.edges.filter((edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target));
  let batches = flow.batches;
  if (node && isGeneratedTextNode(node)) {
    batches = batches.map((batch) => ({ ...batch, executions: batch.executions.map((execution) => execution.outputNodeId === nodeId ? (({ outputNodeId: _outputNodeId, ...withoutOutput }) => withoutOutput)(execution) : execution) }));
    batches = batches.filter((batch) => batch.executions.some((execution) => execution.outputNodeId));
  }
  if (batchIds.size > 0) batches = batches.filter((batch) => !batchIds.has(batch.id));
  return { ...flow, nodes: flow.nodes.filter((item) => !removedNodeIds.has(item.id)), edges, batches };
};


export const reduceWorkspace = (workspace: WorkspaceDocument, action: WorkspaceAction, context: ReducerContext): WorkspaceDocument => {
  switch (action.type) {
    case "flow/create": return { ...workspace, flows: [...workspace.flows, action.flow], activeFlowId: action.flow.id, updatedAt: context.clock.now().toISOString() };
    case "flow/activate": return workspace.flows.some((flow) => flow.id === action.flowId) ? { ...workspace, activeFlowId: action.flowId } : workspace;
    case "flow/rename": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, name: action.name }));
    case "flow/duplicate": return { ...workspace, flows: [...workspace.flows, action.duplicate], activeFlowId: action.duplicate.id, updatedAt: context.clock.now().toISOString() };
    case "flow/delete": {
      if (workspace.flows.length === 1) {
        const fresh = createBlankFlow(workspace, context.idFactory, context.clock);
        return { ...workspace, flows: [fresh], activeFlowId: fresh.id, updatedAt: context.clock.now().toISOString() };
      }
      const index = workspace.flows.findIndex((flow) => flow.id === action.flowId);
      const flows = workspace.flows.filter((flow) => flow.id !== action.flowId);
      const fallbackFlow = flows[index - 1] ?? flows[0];
      const activeFlowId = workspace.activeFlowId === action.flowId ? (flows[index]?.id ?? fallbackFlow?.id ?? workspace.activeFlowId) : workspace.activeFlowId;
      return { ...workspace, flows, activeFlowId, updatedAt: context.clock.now().toISOString() };
    }
    case "node/add": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: [...flow.nodes, action.node] }));
    case "node/move": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => node.id === action.nodeId ? { ...node, position: { ...action.position } } : node) }));
    case "node/rename": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => node.id === action.nodeId && !isGeneratedTextNode(node) ? { ...node, data: { ...node.data, title: action.title } as typeof node.data } : node) }));
    case "node/edit-text": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => isManualTextNode(node) && node.id === action.nodeId ? { ...node, data: { ...node.data, text: action.text } } : node) }));
    case "node/edit-instruction": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => isGenerationNode(node) && node.id === action.nodeId ? { ...node, data: { ...node.data, instruction: action.instruction } } : node) }));
    case "node/set-models": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => isGenerationNode(node) && node.id === action.nodeId ? { ...node, data: { ...node.data, modelIds: [...action.modelIds] } } : node) }));
    case "node/delete": return updateFlow(workspace, action.flowId, context, (flow) => removeResultNode(flow, action.nodeId));
    case "node/make-editable": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: [...flow.nodes, action.node] }));
    case "node/duplicate": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: [...flow.nodes, action.node] }));
    case "viewport/update": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, viewport: { ...action.viewport } }));
    case "input/add": {
      return updateFlow(workspace, action.flowId, context, (flow) => {
        if (action.edge.kind !== "input") return flow;
        const check = canAddInputConnection(flow, action.edge.source, action.edge.target);
        return check.allowed ? { ...flow, edges: normalizeInputOrder([...flow.edges, action.edge], action.edge.target) } : flow;
      });
    }
    case "input/reconnect": return updateFlow(workspace, action.flowId, context, (flow) => {
      const old = flow.edges.find((edge) => edge.id === action.edgeId);
      if (!old || old.kind !== "input") return flow;
      const without = { ...flow, edges: flow.edges.filter((edge) => edge.id !== action.edgeId) };
      const check = canAddInputConnection(without, action.source, action.target);
      return check.allowed ? { ...without, edges: normalizeInputOrder([...without.edges, { ...old, source: action.source, target: action.target, order: getOrderedInputEdges(without, action.target).length }], action.target) } : flow;
    });
    case "input/remove": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, edges: normalizeInputOrder(flow.edges.filter((edge) => edge.id !== action.edgeId)) }));
    case "input/move": return updateFlow(workspace, action.flowId, context, (flow) => {
      const edge = flow.edges.find((item) => item.id === action.edgeId);
      if (!edge || edge.kind !== "input") return flow;
      const ordered = getOrderedInputEdges(flow, edge.target);
      const index = ordered.findIndex((item) => item.id === edge.id);
      const next = action.direction === "up" ? index - 1 : index + 1;
      if (next < 0 || next >= ordered.length) return flow;
      const current = ordered[index];
      const nextEdge = ordered[next];
      if (!current || !nextEdge) return flow;
      [ordered[index], ordered[next]] = [nextEdge, current];
      const orders = new Map(ordered.map((item, order) => [item.id, order]));
      return { ...flow, edges: flow.edges.map((item) => item.kind === "input" && orders.has(item.id) ? { ...item, order: orders.get(item.id) ?? item.order } : item) };
    });
    case "batch/started": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, batches: [...flow.batches, action.batch], nodes: [...flow.nodes, ...action.outputNodes], edges: [...flow.edges, ...action.resultEdges] }));
    case "execution/succeeded": {
      const settlement: Settlement = { status: "success", text: action.text, durationMs: action.durationMs };
      if (action.usage) settlement.usage = action.usage;
      return settleExecution(workspace, action.flowId, action.batchId, action.executionId, settlement, context);
    }
    case "execution/failed": return settleExecution(workspace, action.flowId, action.batchId, action.executionId, { status: "failed", error: action.error, durationMs: action.durationMs, text: `Failed: ${action.error.message}` }, context);
    case "execution/cancelled": return settleExecution(workspace, action.flowId, action.batchId, action.executionId, { status: "cancelled", error: action.error, durationMs: action.durationMs, text: `Cancelled: ${action.error.message}` }, context);
    case "batch/completed": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, batches: flow.batches.map((batch) => batch.id === action.batchId ? { ...batch, completedAt: action.completedAt } : batch) }));
    case "workspace/imported":
    case "workspace/reset": return action.workspace;
  }
};

type Settlement = { status: "success" | "failed" | "cancelled"; text: string; durationMs: number; error?: ExecutionError; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };

const settleExecution = (workspace: WorkspaceDocument, flowId: string, batchId: string, executionId: string, settlement: Settlement, context: ReducerContext) => updateFlow(workspace, flowId, context, (flow) => {
  const batches = flow.batches.map((batch) => batch.id === batchId ? { ...batch, executions: batch.executions.map((execution) => execution.id === executionId ? { ...execution, status: settlement.status, completedAt: context.clock.now().toISOString(), durationMs: settlement.durationMs, ...(settlement.error ? { error: settlement.error } : {}), ...(settlement.usage ? { usage: settlement.usage } : {}) } : execution) } : batch);
  const execution = batches.flatMap((batch) => batch.executions).find((item) => item.id === executionId);
  return { ...flow, batches, nodes: flow.nodes.map((node) => node.id === execution?.outputNodeId && isGeneratedTextNode(node) ? { ...node, data: { ...node.data, text: settlement.text } } : node) };
});


export const normalizeInterruptedBatches = (workspace: WorkspaceDocument, clock: Clock): WorkspaceDocument => {
  const now = clock.now().toISOString();
  return {
    ...workspace,
    flows: workspace.flows.map((flow) => ({
      ...flow,
      batches: flow.batches.map((batch) => ({ ...batch, executions: batch.executions.map((execution) => execution.status === "pending" ? { ...execution, status: "failed", completedAt: now, error: { kind: "interrupted", message: "This run was interrupted when the page closed." } } : execution) })),
      nodes: flow.nodes.map((node) => {
        if (!isGeneratedTextNode(node)) return node;
        const execution = flow.batches.flatMap((batch) => batch.executions).find((item) => item.id === node.data.executionId);
        return execution?.status === "pending" ? { ...node, data: { ...node.data, text: "Failed: This run was interrupted when the page closed." } } : node;
      }),
    })),
  };
};

export const activeFlow = (workspace: WorkspaceDocument) => workspace.flows.find((flow) => flow.id === workspace.activeFlowId) ?? workspace.flows[0];
