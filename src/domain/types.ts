export type EntityId = string;

export type Position = { x: number; y: number };

export type Viewport = { x: number; y: number; zoom: number };

export type Usage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type PromptData = {
  kind: "prompt";
  title: string;
  prompt: string;
  modelIds: string[];
};

export type ContentData = {
  kind: "content";
  title: string;
  text: string;
  origin: "imported" | "generated";
  modelId?: string;
  batchId?: EntityId;
  executionId?: EntityId;
};

export type NodeData = PromptData | ContentData;

export type PlaygroundNode = {
  id: EntityId;
  position: Position;
  data: NodeData;
  createdAt: string;
  updatedAt: string;
};

export type InputEdge = {
  id: EntityId;
  kind: "input";
  source: EntityId;
  target: EntityId;
  order: number;
};

export type ResultEdge = {
  id: EntityId;
  kind: "result";
  source: EntityId;
  target: EntityId;
};

export type PlaygroundEdge = InputEdge | ResultEdge;

export type InputSnapshot = {
  nodeId: EntityId;
  title: string;
  text: string;
};

export type CompletionMessage = { role: "user"; content: string };

export type ExecutionError = {
  kind: "cancelled" | "network" | "http" | "invalid_response" | "interrupted";
  status?: number;
  code?: string;
  message: string;
};

export type ModelExecution = {
  id: EntityId;
  modelId: string;
  status: "pending" | "success" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  usage?: Usage;
  outputNodeId?: EntityId;
  error?: ExecutionError;
};

export type ExecutionBatch = {
  id: EntityId;
  promptNodeId: EntityId;
  startedAt: string;
  completedAt?: string;
  promptFormatVersion: 1;
  instruction: string;
  inputs: InputSnapshot[];
  executions: ModelExecution[];
};

export type FlowDocument = {
  id: EntityId;
  name: string;
  nodes: PlaygroundNode[];
  edges: PlaygroundEdge[];
  batches: ExecutionBatch[];
  viewport: Viewport;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceDocument = {
  schemaVersion: 2;
  activeFlowId: EntityId;
  flows: FlowDocument[];
  createdAt: string;
  updatedAt: string;
};

export type Model = {
  id: string;
  object: "model";
  created: number;
  owned_by: "devneya";
};

export type Clock = { now(): Date };
export type IdFactory = () => EntityId;

export const isPromptNode = (
  node: PlaygroundNode | undefined,
): node is PlaygroundNode & { data: PromptData } =>
  node?.data.kind === "prompt";

export const isContentNode = (
  node: PlaygroundNode | undefined,
): node is PlaygroundNode & { data: ContentData } =>
  node?.data.kind === "content";

export const isGeneratedContentNode = (
  node: PlaygroundNode | undefined,
): node is PlaygroundNode & { data: ContentData } =>
  node?.data.kind === "content" && node.data.origin === "generated";

export const isFinitePosition = (position: Position) =>
  Number.isFinite(position.x) && Number.isFinite(position.y);

export const allNodeIds = (flow: FlowDocument) => new Set(flow.nodes.map((node) => node.id));

export const allExecutionIds = (workspace: WorkspaceDocument) =>
  new Set(
    workspace.flows.flatMap((flow) =>
      flow.batches.flatMap((batch) => batch.executions.map((execution) => execution.id)),
    ),
  );
