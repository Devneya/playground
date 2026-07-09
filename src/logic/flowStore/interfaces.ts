import {APIPromise} from "openai/core";
import {ModelConfiguration} from "../models/modelLibrary";
import {Node} from "@xyflow/react";
import {FlowSnapshot} from "../flowSnapshot";

export type PriorityPair = {
  priority: number;
  value: string;
};

export type TextResponse = {
  text: string;
  thinking?: string;
  type: "text";
};

export type ImageResponse = {
  path: string;
  onImageLoad?: (dimensions: { width: number; height: number }) => void;
  isFromChat?: boolean;
  type: "image";
};

export type AudioResponse = {
  path: string;
  type: "audio";
};

export type PdfResponse = {
  path: string;
  type: "pdf";
};

export type ContentResponse = TextResponse | ImageResponse | AudioResponse | PdfResponse | undefined;

export function isTextResponse(
  resp: ContentResponse
): resp is TextResponse {
  return resp?.type === "text";
}

export function isImageResponse(
  resp: ContentResponse
): resp is ImageResponse {
  return resp?.type === "image";
}

export function isAudioResponse(
  resp: ContentResponse
): resp is AudioResponse {
  return resp?.type === "audio";
}

export function isPdfResponse(
  resp: ContentResponse
): resp is PdfResponse {
  return resp?.type === "pdf";
}

export type PromptNodeData = {
  prompt: string;
  systemPrompt?: string;
  recentModelsList: PriorityPair[];
  isExecuted: boolean;
  selectedModels: ModelConfiguration[];
  storedSingleModel?: ModelConfiguration;
  parentId?: string[];
  isAggregateNode?: boolean;
  areThoughtsShown?: boolean;
  MoAContainerId?: string;
  isContained?: boolean;
  // promptsContainerId?: string;
  isUserDragging?: boolean;
  interactionMode?: string;
  role?: string;
  isHidden?: boolean;
  isFocused?: boolean;
};

export type PromptNode = Node<PromptNodeData, "prompt">;

export type ContentNodeData = {
  parentId: string;
  prompt: string;
  responsePromise: Promise<any> | APIPromise<any> | undefined;
  // | APIPromise<AsyncIterable<Completion> | Completion>
  // | APIPromise<AsyncIterable<ChatCompletionChunk> | ChatCompletion>
  // | APIPromise<ImagesResponse>
  // | Promise<ChatCompletionResponse>
  // | undefined;
  response: ContentResponse;
  viewOnly?: boolean;
  isRegenerated?: boolean;
  areThoughtsShown?: boolean;
  isHidden?: boolean;
  isShowingThoughtsFromContainer?: boolean;
  isContained?: boolean;
  MoAContainerId?: string;
  previousAgentResponse?: string;
  modelUsed?: string;
  isFocused?: boolean;
  isImported?: boolean;
};

export type ContentNode = Node<ContentNodeData, "content">;

export function isPromptNodeData(data: any): data is PromptNodeData {
  return data !== undefined && typeof data.isExecuted === "boolean";
}

export function isPromptNode(node: AppNode | undefined): node is PromptNode {
  return node !== undefined && isPromptNodeData(node.data);
}

export function isContentNodeData(data: any): data is ContentNodeData {
  return (
    data !== undefined &&
    typeof data.parentId === "string" &&
    typeof data.prompt === "string"
  );
}

export function isContentNode(node: AppNode | undefined): node is ContentNode {
  return node !== undefined && isContentNodeData(node.data);
}

export type ContainerNodeData = {
  proposers: string[];
  contentNodes: string[];
  parentPromptId: string;
  areThoughtsShown: boolean;
  isPromptContainer?: boolean;
  isOpen?: boolean;
};

export function isContainerNodeData(data: any): data is ContainerNodeData {
  return (
    data !== undefined &&
    Array.isArray(data.proposers) &&
    data.proposers.every((id: any) => typeof id === "string")
  );
}

export function isContainerNode(node: Node | undefined): node is ContainerNode {
  return node !== undefined && isContainerNodeData(node.data);
}

export type ContainerNode = Node<ContainerNodeData, "container">;
export type AppNodeData = PromptNodeData | ContentNodeData | ContainerNodeData;
export type AppNode = Node<AppNodeData>;

export interface Canvas {
  id: string;
  name: string;
  lastEdit: string;
  snapshotJson?: string; // flow
  screenshotBase64?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  screenshotBase64?: string;
  flow?: FlowSnapshot;
}

export interface TemplateMetadata {
  id: string;
  name: string;
  description: string;
  path: string;
  screenshotPath?: string;
}