import { applySurfaceOperations, emptySurface, type Surface, type SurfaceOperation, type SurfaceReply } from "./surface";
import { moveBoardSchema, type MoveBoard } from "./moveBoard";
import { experienceSchema, type Experience } from "./experience";
import type { OutputSuggestions } from "./canvasReply";
import type { ReasoningEffort } from "./reasoning";
import type { StoredImage } from "./images";
import { LIMITS, utf8ByteLength } from "./limits";
import { acceptCanvasSuggestion } from "./canvasSuggestions";
import { combineThoughts } from "./combineThoughts";
import type { Clock, ExecutionBatch, ExecutionError, FlowDocument, IdFactory, InputEdge, PlaygroundEdge, PlaygroundNode, WorkspaceDocument } from "./types";
import { canAddInputConnection, getOrderedInputEdges, nextGenerationIndex, normalizeInputOrder } from "./graph";
import { createBlankFlow } from "./workspaceFactory";
import { RESULT_COL_STRIDE, RESULT_TO_CONTINUATION_STRIDE } from "./resultPlacement";
import { isGeneratedTextNode, isGenerationNode, isManualTextNode, isTextNode } from "./types";
import { detachPlacement, layoutAutomaticNodes } from "./spatialLayout";
import { getContextFromInputs, getConversationPath, updateInputContexts } from "./conversation";

export type WorkspaceAction =
  | { type: "experience/set"; flowId: string; baseHead: string | null; baseTail: string | null; experience: Experience }
  | { type: "board/set"; flowId: string; baseHead: string | null; board: MoveBoard }
  | { type: "surface/viewport"; flowId: string; viewport: { x: number; y: number; zoom: number } }
  | { type: "surface/change"; flowId: string; base: Surface; operations: SurfaceOperation[]; gesture?: string }
  | { type: "surface/acted"; flowId: string; base: Surface; reply: SurfaceReply; instruction: string; model: string; turnId: string }
  | { type: "flow/create"; flow: FlowDocument }
  | { type: "flow/activate"; flowId: string }
  | { type: "flow/rename"; flowId: string; name: string }
  | { type: "flow/duplicate"; flowId: string; duplicate: FlowDocument }
  | { type: "flow/delete"; flowId: string }
  | { type: "node/add"; flowId: string; node: PlaygroundNode }
  | { type: "node/move"; flowId: string; nodeId: string; position: { x: number; y: number } }
  | { type: "node/measure"; flowId: string; sizes: { id: string; height: number }[] }
  | { type: "node/rename"; flowId: string; nodeId: string; title: string }
  | { type: "node/edit-instruction"; flowId: string; nodeId: string; instruction: string }
  | { type: "node/edit-text"; flowId: string; nodeId: string; text: string }
  | { type: "node/set-effort"; flowId: string; nodeId: string; modelId: string; effort: ReasoningEffort }
  | { type: "node/set-models"; flowId: string; nodeId: string; modelIds: string[] }
  | { type: "node/delete"; flowId: string; nodeId: string }
  | { type: "node/make-editable"; flowId: string; node: PlaygroundNode }
  | { type: "node/extract-note"; flowId: string; sourceNodeId: string; customNote?: { title: string; text: string } }
  | { type: "suggestion/accept"; flowId: string; sourceNodeId: string; kind: "branch" | "note" | "grid"; index: number; automatic?: boolean }
  | { type: "workspace/default-model"; modelId: string }
  | { type: "node/duplicate"; flowId: string; node: PlaygroundNode }
  | { type: "generation/continue"; flowId: string; sourceNodeId: string; instruction?: string; position?: { x: number; y: number }; sourceHandle?: string; targetHandle?: string }
  | { type: "generation/combine"; flowId: string; sourceNodeIds: string[]; instruction: string }
  | { type: "generation/branch"; flowId: string; sourceNodeId: string }
  | { type: "generation/duplicate"; flowId: string; sourceNodeId: string }
  | { type: "generation/remove-context"; flowId: string; nodeId: string; index: number }
  | { type: "generation/clear-context"; flowId: string; nodeId: string }
  | { type: "input/add"; flowId: string; edge: PlaygroundEdge }
| { type: "input/reconnect"; flowId: string; edgeId: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
  | { type: "input/remove"; flowId: string; edgeId: string }
  | { type: "input/move"; flowId: string; edgeId: string; direction: "up" | "down" }
  | { type: "viewport/update"; flowId: string; viewport: { x: number; y: number; zoom: number } }
  | { type: "batch/started"; flowId: string; batch: ExecutionBatch; outputNodes: PlaygroundNode[]; resultEdges: PlaygroundEdge[] }
  | { type: "execution/succeeded"; flowId: string; batchId: string; executionId: string; text: string; images?: StoredImage[]; suggestions?: OutputSuggestions; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }; durationMs: number }
  | { type: "execution/failed"; flowId: string; batchId: string; executionId: string; error: ExecutionError; durationMs: number }
  | { type: "execution/progress"; flowId: string; batchId: string; executionId: string; text: string; message: string; characters: number }
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

const removeNode = (flow: FlowDocument, nodeId: string) => {
  const node = flow.nodes.find((item) => item.id === nodeId);
  if (!node) return flow;
  const edges = flow.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
  let batches = flow.batches;
  if (isGeneratedTextNode(node)) {
    batches = batches.map((batch) => ({ ...batch, executions: batch.executions.map((execution) => execution.outputNodeId === nodeId ? (({ outputNodeId: _outputNodeId, ...withoutOutput }) => withoutOutput)(execution) : execution) }));
    batches = batches.map((batch) => ({ ...batch, executions: batch.executions.map((execution) => execution.additionalOutputNodeIds ? { ...execution, additionalOutputNodeIds: execution.additionalOutputNodeIds.filter((id) => id !== nodeId) } : execution) }));
    batches = batches.filter((batch) => batch.executions.some((execution) => execution.outputNodeId || execution.additionalOutputNodeIds?.length));
  }
  return { ...flow, nodes: flow.nodes.filter((item) => item.id !== nodeId), edges, batches };
};

export const reduceWorkspace = (workspace: WorkspaceDocument, action: WorkspaceAction, context: ReducerContext): WorkspaceDocument => {
  switch (action.type) {
    case "experience/set": return updateFlow(workspace, action.flowId, context, (flow) => (flow.experience?.head ?? null) === action.baseHead && (flow.experience?.revisions.at(-1)?.id ?? null) === action.baseTail ? { ...flow, experience: experienceSchema.parse(action.experience) } : flow);
    case "board/set": return updateFlow(workspace, action.flowId, context, (flow) => (flow.board?.head ?? null) === action.baseHead ? { ...flow, board: moveBoardSchema.parse(action.board) } : flow);
    case "surface/viewport": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, surface: { ...(flow.surface ?? emptySurface()), viewport: action.viewport } }));
    case "surface/change":
    case "surface/acted": return updateFlow(workspace, action.flowId, context, (flow) => {
      const current = flow.surface ?? emptySurface();
      try {
        const { surface, changedIds } = applySurfaceOperations(current, action.base, action.type === "surface/change" ? action.operations : action.reply.operations);
        const { notice: _notice, ...clean } = surface;
        return { ...flow, surface: action.type === "surface/change" ? clean : { ...clean, actions: action.reply.actions, turns: [...surface.turns.slice(-29), { id: action.turnId, instruction: action.instruction, summary: action.reply.summary, model: action.model, at: context.clock.now().toISOString(), changedIds }] } };
      } catch (error) {
        return { ...flow, surface: { ...current, notice: error instanceof Error && error.name !== "ZodError" ? error.message.slice(0, 1000) : "The proposed change was invalid. Your workspace has been kept." } };
      }
    });
    case "generation/combine": return updateFlow(workspace, action.flowId, context, (flow) => combineThoughts(flow, action.sourceNodeIds, action.instruction, context));
    case "suggestion/accept": return acceptCanvasSuggestion(workspace, action, context, reduceWorkspace);
    case "workspace/default-model": {
      if (!action.modelId) return workspace;
      let changed = false;
      const flows = workspace.flows.map((flow) => {
        const nodes = flow.nodes.map((node) => {
          if (!isGenerationNode(node) || node.data.modelIds.length || flow.batches.some((batch) => batch.generationNodeId === node.id)) return node;
          changed = true;
          return { ...node, data: { ...node.data, modelIds: [action.modelId] } };
        });
        return nodes.every((node, index) => node === flow.nodes[index]) ? flow : { ...flow, nodes };
      });
      return changed ? { ...workspace, flows } : workspace;
    }
    case "node/extract-note": {
      const flow = workspace.flows.find((item) => item.id === action.flowId);
      const source = flow?.nodes.find((item) => item.id === action.sourceNodeId);
      if (!flow || !isGeneratedTextNode(source)) return workspace;
      const batch = flow.batches.find((item) => item.id === source.data.batchId);
      const execution = batch?.executions.find((item) => item.id === source.data.executionId);
      const now = context.clock.now().toISOString();
      const note: PlaygroundNode = { id: context.idFactory(), createdAt: now, updatedAt: now,
        position: { x: source.position.x + RESULT_COL_STRIDE, y: source.position.y },
        placement: { anchorId: source.id, offsetX: RESULT_COL_STRIDE, direction: "right" },
        data: { kind: "text", origin: "manual", title: action.customNote?.title ?? `Note · ${source.data.title}`, text: action.customNote?.text ?? source.data.text, ...(source.data.images ? { images: structuredClone(source.data.images) } : {}),
          source: { nodeId: source.id, batchId: source.data.batchId, executionId: source.data.executionId, modelId: execution?.modelId ?? source.data.title, instruction: batch?.instruction ?? "", text: source.data.text } },
      };
      return updateFlow(workspace, flow.id, context, (current) => layoutAutomaticNodes({ ...current, nodes: [...current.nodes, note] }));
    }
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
    case "node/move": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => node.id === action.nodeId ? { ...detachPlacement(node), position: { ...action.position } } : (node.placement?.anchorId === action.nodeId || node.gridPlacement?.anchorId === action.nodeId) ? detachPlacement(node) : node) }));
    case "node/measure": {
      const flow = workspace.flows.find((candidate) => candidate.id === action.flowId);
      if (!flow) return workspace;
      const sizes = new Map(action.sizes.filter((size) => Number.isFinite(size.height) && size.height > 0).map((size) => [size.id, size.height]));
      if (!flow.nodes.some((node) => sizes.has(node.id) && sizes.get(node.id) !== node.measuredHeight)) return workspace;
      return updateFlow(workspace, action.flowId, context, (current) => layoutAutomaticNodes({ ...current, nodes: current.nodes.map((node) => sizes.has(node.id) ? { ...node, measuredHeight: sizes.get(node.id)! } : node) }));
    }
    case "node/rename": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => node.id === action.nodeId && !isGeneratedTextNode(node) ? { ...node, data: { ...node.data, title: action.title } } : node) }));
    case "node/edit-instruction": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => isGenerationNode(node) && node.id === action.nodeId ? { ...node, data: { ...node.data, instruction: action.instruction } } : node) }));
    case "node/edit-text": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => node.id === action.nodeId && isManualTextNode(node) ? { ...node, data: { ...node.data, text: action.text } } : node) }));
    case "node/set-effort": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => isGenerationNode(node) && node.id === action.nodeId ? { ...node, data: { ...node.data, modelEfforts: { ...node.data.modelEfforts, [action.modelId]: action.effort } } } : node) }));
    case "node/set-models": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: flow.nodes.map((node) => isGenerationNode(node) && node.id === action.nodeId ? { ...node, data: { ...node.data, modelIds: [...action.modelIds] } } : node) }));
    case "node/delete": return updateFlow(workspace, action.flowId, context, (flow) => removeNode(flow, action.nodeId));
    case "node/make-editable": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: [...flow.nodes, action.node] }));
    case "node/duplicate": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, nodes: [...flow.nodes, action.node] }));
    case "generation/remove-context":
    case "generation/clear-context": return updateFlow(workspace, action.flowId, context, (flow) => {
      const prompt = flow.nodes.find(node => node.id === action.nodeId);
      if (!isGenerationNode(prompt) || flow.batches.some(batch => batch.generationNodeId === prompt.id)) return flow;
      const entries = getConversationPath(flow, prompt.id);
      if (action.type === "generation/remove-context" && (!Number.isInteger(action.index) || !entries[action.index])) return flow;
      const removed = action.type === "generation/remove-context" ? entries[action.index] : undefined;
      const kept = action.type === "generation/clear-context" ? [] : entries.filter((_entry, index) => index !== action.index);
      const edges = flow.edges.filter(edge => edge.kind !== "input" || edge.target !== prompt.id || (action.type !== "generation/clear-context" && (edge.source !== removed?.nodeId || kept.some(entry => entry.nodeId === edge.source))));
      return { ...flow, edges: normalizeInputOrder(edges, prompt.id), nodes: flow.nodes.map(node => node.id === prompt.id && isGenerationNode(node) ? { ...node, data: { ...node.data, context: structuredClone(kept) } } : node) };
    });
    case "generation/duplicate":
    case "generation/branch": {
      const flow = workspace.flows.find((candidate) => candidate.id === action.flowId);
      const answer = flow?.nodes.find((node) => node.id === action.sourceNodeId);
      if (!flow || !answer) return workspace;
      const duplicate = action.type === "generation/duplicate";
      if (duplicate ? !isGenerationNode(answer) : !isGeneratedTextNode(answer)) return workspace;
      const batch = duplicate
        ? flow.batches.filter((candidate) => candidate.generationNodeId === answer.id).reduce<ExecutionBatch | undefined>((latest, candidate) => !latest || candidate.startedAt >= latest.startedAt ? candidate : latest, undefined)
        : flow.batches.find((candidate) => isGeneratedTextNode(answer) && candidate.id === answer.data.batchId);
      const execution = batch?.executions.find((candidate) => isGeneratedTextNode(answer) && candidate.id === answer.data.executionId);
      const parent = flow.nodes.find((node) => node.id === batch?.generationNodeId);
      if (!batch || (!duplicate && execution?.status !== "success") || !isGenerationNode(parent)) return workspace;
      const id = context.idFactory();
      const now = context.clock.now().toISOString();
      const node: PlaygroundNode = { id, position: { x: parent.position.x + RESULT_COL_STRIDE, y: parent.position.y }, placement: { anchorId: parent.id, offsetX: RESULT_COL_STRIDE, direction: "right" }, createdAt: now, updatedAt: now, data: { kind: "generation", title: `Generation ${nextGenerationIndex(flow)}`, instruction: batch.instruction, ...(parent.data.modelEfforts ? { modelEfforts: structuredClone(parent.data.modelEfforts) } : {}), modelIds: duplicate ? batch.executions.map((item) => item.modelId) : [execution!.modelId], context: structuredClone(batch.context ?? getContextFromInputs(flow, batch.inputs)), branchedFrom: { nodeId: parent.id, batchId: batch.id } } };
      const edges: InputEdge[] = batch.inputs.filter((input) => flow.nodes.some((candidate) => candidate.id === input.nodeId)).map((input, order) => ({ id: context.idFactory(), kind: "input", source: input.nodeId, target: id, sourceHandle: "flow-bottom", targetHandle: "flow-top", order }));
      return updateFlow(workspace, flow.id, context, (current) => layoutAutomaticNodes({ ...current, nodes: [...current.nodes, node], edges: [...current.edges, ...edges] }));
    }
    case "generation/continue": {
      const flow = workspace.flows.find((candidate) => candidate.id === action.flowId);
      if (!flow) return workspace;
      const source = flow.nodes.find((node) => node.id === action.sourceNodeId);
      if (!isTextNode(source)) return workspace;
      let modelIds: string[] = [];
      let modelEfforts: Record<string, ReasoningEffort> | undefined;
      if (isGeneratedTextNode(source)) {
        const batch = flow.batches.find((candidate) => candidate.id === source.data.batchId);
        const execution = batch?.executions.find((candidate) => candidate.id === source.data.executionId);
        if (!execution || execution.status !== "success") return workspace;
        // Continuing one answer defaults to that answer's model. Comparing
        // models is an explicit choice for each reply, not inherited fan-out.
        modelIds = [execution.modelId];
        if (execution.reasoningEffort) modelEfforts = { [execution.modelId]: execution.reasoningEffort };
      }
      // A continuation descends below its result. The first continuation from a
      // result sits directly below it; every further Continue from the same
      // result opens a new parallel column to the right (a fork), keeping each
      // answer thread readable top→down. The branch index is the number of
      // existing continuation edges already descending from this result.
      const branchIndex = flow.edges.filter((edge) => edge.kind === "input" && edge.source === source.id).length;
      // The continuation row sits one stride below the result. Never land on a
      // column that already holds a node at that row — scan outward from the
      // branch index for the first free slot. A 2-model run leaves each model's
      // auto-continuation one column over, so a parallel fork from the first
      // result would otherwise drop exactly on top of its sibling.
      const continuationY = source.position.y + RESULT_TO_CONTINUATION_STRIDE;
      let branchColumn = branchIndex;
      while (flow.nodes.some((node) => node.position.x === source.position.x + branchColumn * RESULT_COL_STRIDE && node.position.y === continuationY)) {
        branchColumn += 1;
      }
      const position = {
        x: source.position.x + branchColumn * RESULT_COL_STRIDE,
        y: continuationY,
      };
      const newId = context.idFactory();
      const now = context.clock.now().toISOString();
      const newGeneration: PlaygroundNode = {
        id: newId,
        position: action.position ?? position,
        ...(!action.position ? { placement: { anchorId: source.id, offsetX: branchColumn * RESULT_COL_STRIDE, direction: "below" as const } } : {}),
        data: { kind: "generation", title: `Generation ${nextGenerationIndex(flow)}`, instruction: action.instruction ?? "", modelIds, ...(modelEfforts ? { modelEfforts } : {}) },
        createdAt: now,
        updatedAt: now,
      };
      const edge: InputEdge = { id: context.idFactory(), kind: "input", source: source.id, target: newId, sourceHandle: action.sourceHandle ?? "flow-bottom", targetHandle: action.targetHandle ?? (action.position ? "generation-input" : "flow-top"), order: getOrderedInputEdges(flow, newId).length };
      return updateFlow(workspace, action.flowId, context, (targetFlow) => layoutAutomaticNodes({ ...targetFlow, nodes: [...targetFlow.nodes, newGeneration], edges: normalizeInputOrder([...targetFlow.edges, edge], newId) }));
    }
    case "viewport/update": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, viewport: { ...action.viewport } }));
    case "input/add": {
      return updateFlow(workspace, action.flowId, context, (flow) => {
        if (action.edge.kind !== "input") return flow;
        const check = canAddInputConnection(flow, action.edge.source, action.edge.target);
        return check.allowed ? updateInputContexts(flow, normalizeInputOrder([...flow.edges, action.edge], action.edge.target)) : flow;
      });
    }
    case "input/reconnect": return updateFlow(workspace, action.flowId, context, (flow) => {
      const old = flow.edges.find((edge) => edge.id === action.edgeId);
      if (!old || old.kind !== "input") return flow;
      const without = { ...flow, edges: flow.edges.filter((edge) => edge.id !== action.edgeId) };
      const check = canAddInputConnection(without, action.source, action.target);
      return check.allowed ? updateInputContexts(flow, normalizeInputOrder([...without.edges, { ...old, source: action.source, target: action.target, sourceHandle: action.sourceHandle ?? null, targetHandle: action.targetHandle ?? null, order: getOrderedInputEdges(without, action.target).length }], action.target)) : flow;
    });
    case "input/remove": return updateFlow(workspace, action.flowId, context, (flow) => updateInputContexts(flow, normalizeInputOrder(flow.edges.filter((edge) => edge.id !== action.edgeId))));
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
    case "batch/started": return updateFlow(workspace, action.flowId, context, (flow) => layoutAutomaticNodes({
      ...flow,
      batches: [...flow.batches, action.batch],
      nodes: [...flow.nodes.map((node) => node.id === action.batch.generationNodeId ? { ...node, updatedAt: action.batch.startedAt } : node), ...action.outputNodes],
      edges: [...flow.edges, ...action.resultEdges],
    }));
    case "execution/succeeded": {
      const settlement: Settlement = { status: "success", text: action.text, durationMs: action.durationMs };
      if (action.usage) settlement.usage = action.usage;
      if (action.suggestions) settlement.suggestions = action.suggestions;
      if (action.images) settlement.images = action.images;
      const next = settleExecution(workspace, action.flowId, action.batchId, action.executionId, settlement, context);
      const execution = next.flows.find((flow) => flow.id === action.flowId)?.batches.find((batch) => batch.id === action.batchId)?.executions.find((item) => item.id === action.executionId);
      return execution?.outputNodeId && action.suggestions?.grid ? acceptCanvasSuggestion(next, { type: "suggestion/accept", flowId: action.flowId, sourceNodeId: execution.outputNodeId, kind: "grid", index: 0, automatic: true }, context, reduceWorkspace) : next;
    }
    case "execution/progress": return updateFlow(workspace, action.flowId, context, (flow) => {
      const execution = flow.batches.find((batch) => batch.id === action.batchId)?.executions.find((item) => item.id === action.executionId);
      if (execution?.status !== "pending" || utf8ByteLength(action.text) > LIMITS.maxGeneratedBytes) return flow;
      return { ...flow, batches: flow.batches.map((batch) => batch.id !== action.batchId ? batch : { ...batch, executions: batch.executions.map((item) => item.id !== action.executionId ? item : { ...item, progress: { message: action.message, characters: action.characters } }) }), nodes: flow.nodes.map((node) => node.id !== execution.outputNodeId || !isGeneratedTextNode(node) ? node : { ...node, data: { ...node.data, text: action.text } }) };
    });
    case "execution/failed": return settleExecution(workspace, action.flowId, action.batchId, action.executionId, { status: "failed", error: action.error, durationMs: action.durationMs, text: `Failed: ${action.error.message}` }, context);
    case "execution/cancelled": return settleExecution(workspace, action.flowId, action.batchId, action.executionId, { status: "cancelled", error: action.error, durationMs: action.durationMs, text: `Cancelled: ${action.error.message}` }, context);
    case "batch/completed": return updateFlow(workspace, action.flowId, context, (flow) => ({ ...flow, batches: flow.batches.map((batch) => batch.id === action.batchId ? { ...batch, completedAt: action.completedAt } : batch) }));
    case "workspace/imported":
    case "workspace/reset": return action.workspace;
  }
};

type Settlement = { status: "success" | "failed" | "cancelled"; text: string; images?: StoredImage[]; suggestions?: OutputSuggestions; durationMs: number; error?: ExecutionError; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };

const settleExecution = (workspace: WorkspaceDocument, flowId: string, batchId: string, executionId: string, settlement: Settlement, context: ReducerContext) => updateFlow(workspace, flowId, context, (flow) => {
  const batches = flow.batches.map((batch) => batch.id === batchId ? { ...batch, executions: batch.executions.map((execution) => execution.id === executionId ? { ...execution, status: settlement.status, completedAt: context.clock.now().toISOString(), durationMs: settlement.durationMs, ...(settlement.error ? { error: settlement.error } : {}), ...(settlement.usage ? { usage: settlement.usage } : {}) } : execution) } : batch);
  const execution = batches.flatMap((batch) => batch.executions).find((item) => item.id === executionId);
  return { ...flow, batches, nodes: flow.nodes.map((node) => node.id === execution?.outputNodeId && isGeneratedTextNode(node) ? { ...node, data: { ...node.data, text: settlement.text, ...(settlement.images ? { images: settlement.images } : {}), ...(settlement.suggestions ? { suggestions: settlement.suggestions } : {}) } } : node) };
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
