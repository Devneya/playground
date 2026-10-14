import { LIMITS } from "./limits";
import { RESULT_COL_STRIDE } from "./resultPlacement";
import { layoutAutomaticNodes } from "./spatialLayout";
import { isGeneratedTextNode, type PlaygroundNode, type ResultEdge, type WorkspaceDocument } from "./types";
import { outputSuggestionsSchema } from "./canvasReply";
import type { ReducerContext, WorkspaceAction } from "./workspaceReducer";

type AcceptAction = Extract<WorkspaceAction, { type: "suggestion/accept" }>;

// Accepting one proposal is one transaction, including the acceptance marker.
// Answer content can be materialized at settlement; exploration never runs a completion.
export const acceptCanvasSuggestion = (workspace: WorkspaceDocument, action: AcceptAction, context: ReducerContext,
  reduce: (workspace: WorkspaceDocument, action: WorkspaceAction, context: ReducerContext) => WorkspaceDocument): WorkspaceDocument => {
  const flow = workspace.flows.find((item) => item.id === action.flowId);
  const source = flow?.nodes.find((node) => node.id === action.sourceNodeId);
  if (!flow || !isGeneratedTextNode(source)) return workspace;
  const batch = flow.batches.find((item) => item.id === source.data.batchId);
  const execution = batch?.executions.find((item) => item.id === source.data.executionId);
  const parsed = outputSuggestionsSchema.safeParse(source.data.suggestions);
  if (!batch || execution?.status !== "success" || !parsed.success) return workspace;
  const suggestions = structuredClone(parsed.data);
  const proposal = action.kind === "grid" ? suggestions.grid : action.kind === "branch" ? suggestions.branches?.[action.index] : suggestions.notes?.[action.index];
  if (!proposal || proposal.accepted) return workspace;
  const count = action.kind === "grid" ? suggestions.grid!.cells.length : 1;
  if (flow.nodes.length + count > LIMITS.maxNodesPerFlow || flow.edges.length + count > LIMITS.maxEdgesPerFlow) return workspace;
  proposal.accepted = true;
  let next = { ...workspace, flows: workspace.flows.map((item) => item.id === flow.id ? { ...item, nodes: item.nodes.map((node) => node.id === source.id ? { ...node, data: { ...source.data, suggestions } } : node) } : item) };
  if (action.kind === "branch") return reduce(next, { type: "generation/continue", flowId: flow.id, sourceNodeId: source.id, instruction: suggestions.branches![action.index]!.instruction }, context);
  if (action.kind === "note") return reduce(next, { type: "node/extract-note", flowId: flow.id, sourceNodeId: source.id, customNote: suggestions.notes![action.index]! }, context);
  const now = context.clock.now().toISOString();
  const grid = suggestions.grid!;
  const nodes: PlaygroundNode[] = grid.cells.map((cell) => ({
    id: context.idFactory(), createdAt: now, updatedAt: now,
    position: { x: source.position.x + RESULT_COL_STRIDE * (cell.col + 1), y: source.position.y },
    gridPlacement: { anchorId: source.id, col: cell.col, row: cell.row, columns: grid.columns, ...(action.automatic ? { below: true, ...(grid.layout === "atlas" ? { layout: "atlas" as const } : grid.cells.some((item) => item.artifact) ? { layout: "spread" as const } : {}), span: cell.span ?? 1 } : {}) },
    data: { kind: "text", origin: "generated", title: execution.modelId, text: cell.text, heading: cell.title, ...(action.automatic ? { wide: cell.artifact ? grid.cells.filter((item) => item.artifact).length === 1 : cell.span === 2 && !grid.cells.some((item) => item.artifact), presentation: grid.layout === "atlas" ? "atlas" as const : cell.artifact ? "visual" as const : grid.cells.some((item) => item.artifact) ? "support" as const : "idea" as const } : {}), ...(cell.question ? { question: cell.question } : {}), ...(cell.artifact ? { artifact: cell.artifact } : {}), noted: cell.noted, batchId: source.data.batchId, executionId: source.data.executionId },
  }));
  const edges: ResultEdge[] = flow.nodes.some((node) => node.id === batch.generationNodeId) ? nodes.map((node) => ({ id: context.idFactory(), kind: "result", source: batch.generationNodeId, target: node.id, sourceHandle: "flow-bottom", targetHandle: "flow-top" })) : [];
  next = { ...next, updatedAt: now, flows: next.flows.map((item) => item.id !== flow.id ? item : layoutAutomaticNodes({
    ...item, updatedAt: now, nodes: [...item.nodes, ...nodes], edges: [...item.edges, ...edges],
    batches: item.batches.map((current) => ({ ...current, executions: current.executions.map((candidate) => candidate.id === execution.id ? { ...candidate, additionalOutputNodeIds: [...(candidate.additionalOutputNodeIds ?? []), ...nodes.map((node) => node.id)] } : candidate) })),
  })) };
  return next;
};
