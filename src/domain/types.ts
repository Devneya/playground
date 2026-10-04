import type { Surface } from "./surface";
import type { MoveBoard } from "./moveBoard";
import type { Experience } from "./experience";
import type { CanvasArtifact, OutputSuggestions } from "./canvasReply";
import type { StoredImage } from "./images";
import type { ReasoningEffort } from "./reasoning";
import type { StoredFile, UploadInfo } from "./files";
export type EntityId = string;

export type Position = { x: number; y: number };

export type Viewport = { x: number; y: number; zoom: number };

export type Usage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ManualTextData = {
  kind: "text";
  origin: "manual";
  title: string;
  text: string;
  images?: StoredImage[];
  files?: StoredFile[];
  upload?: UploadInfo;
  source?: { nodeId: EntityId; batchId: EntityId; executionId: EntityId; modelId: string; instruction: string; text: string };
};

export type GeneratedTextData = {
  kind: "text";
  origin: "generated";
  title: string;
  text: string;
  images?: StoredImage[];
  batchId: EntityId;
  executionId: EntityId;
  suggestions?: OutputSuggestions;
  heading?: string;
  presentation?: "idea" | "visual" | "support" | "atlas";
  question?: string;
  artifact?: CanvasArtifact;
  wide?: boolean;
  noted?: boolean;
};

export type GenerationData = {
  kind: "generation";
  title: string;
  instruction: string;
  modelIds: string[];
  modelEfforts?: Record<string, ReasoningEffort>;
  context?: ConversationEntry[];
  branchedFrom?: { nodeId: string; batchId: string };
};

export type TextNodeData = ManualTextData | GeneratedTextData;

export type NodeData = TextNodeData | GenerationData;

export type PlaygroundNode = {
  id: EntityId;
  position: Position;
  measuredHeight?: number;
  placement?: { anchorId: string; offsetX: number; direction: "below" | "right" | "above" };
  gridPlacement?: { anchorId: string; col: number; row: number; columns: number; below?: boolean; layout?: "spread" | "atlas"; span?: number };
  data: NodeData;
  createdAt: string;
  updatedAt: string;
};

export type InputEdge = {
  id: EntityId;
  kind: "input";
  source: EntityId;
  target: EntityId;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  order: number;
};

export type ResultEdge = {
  id: EntityId;
  kind: "result";
  source: EntityId;
  target: EntityId;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type PlaygroundEdge = InputEdge | ResultEdge;

export type InputSnapshot = {
  nodeId: EntityId;
  title: string;
  text: string;
  files?: StoredFile[];
};

export type CompletionMessage = { role: "user" | "assistant"; content: string; files?: StoredFile[] };

export type ConversationEntry = CompletionMessage & { nodeId: EntityId; modelId?: string };

export type ExecutionError = {
  kind: "cancelled" | "network" | "http" | "invalid_response" | "interrupted";
  status?: number;
  code?: string;
  message: string;
};

export type ModelExecution = {
  id: EntityId;
  modelId: string;
  reasoningEffort?: ReasoningEffort;
  status: "pending" | "success" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  usage?: Usage;
  outputNodeId?: EntityId;
  additionalOutputNodeIds?: EntityId[];
  error?: ExecutionError;
  progress?: { message: string; characters: number };
};

export type ExecutionBatch = {
  id: EntityId;
  generationNodeId: EntityId;
  startedAt: string;
  completedAt?: string;
  promptFormatVersion: 1 | 2;
  instruction: string;
  inputs: InputSnapshot[];
  context?: ConversationEntry[];
  executions: ModelExecution[];
};

export type FlowDocument = {
  experience?: Experience;
  board?: MoveBoard;
  surface?: Surface;
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
  schemaVersion: 3;
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
  supportedReasoningEfforts?: ReasoningEffort[] | undefined;
  defaultReasoningEffort?: ReasoningEffort | undefined;
};

export type Clock = { now(): Date };
export type IdFactory = () => EntityId;

export const isTextNode = (
  node: PlaygroundNode | undefined,
): node is PlaygroundNode & { data: TextNodeData } =>
  node?.data.kind === "text";

export const isGenerationNode = (
  node: PlaygroundNode | undefined,
): node is PlaygroundNode & { data: GenerationData } =>
  node?.data.kind === "generation";

export const isManualTextNode = (
  node: PlaygroundNode | undefined,
): node is PlaygroundNode & { data: ManualTextData } =>
  node?.data.kind === "text" && node.data.origin === "manual";

export const isGeneratedTextNode = (
  node: PlaygroundNode | undefined,
): node is PlaygroundNode & { data: GeneratedTextData } =>
  node?.data.kind === "text" && node.data.origin === "generated";

export const isFinitePosition = (position: Position) =>
  Number.isFinite(position.x) && Number.isFinite(position.y);

export const allNodeIds = (flow: FlowDocument) => new Set(flow.nodes.map((node) => node.id));

export const allExecutionIds = (workspace: WorkspaceDocument) =>
  new Set(
    workspace.flows.flatMap((flow) =>
      flow.batches.flatMap((batch) => batch.executions.map((execution) => execution.id)),
    ),
  );
