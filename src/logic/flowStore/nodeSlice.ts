import { StateCreator } from "zustand";
import {
  applyNodeChanges,
  getNodesBounds,
  getViewportForBounds,
  NodeChange,
  OnNodesChange,
  Viewport,
  XYPosition,
} from "@xyflow/react";
import useFlowStore from "./flowStore";
import {
  DEFAULT_CONTAINER_NODE_SIZE,
  DEFAULT_CONTENT_NODE_SIZE,
  DEFAULT_MOA_PROMPT_NODE_HEIGHT,
  DEFAULT_NODE_SIZE,
  DEFAULT_PROMPT_NODE_SIZE,
} from "../../config/nodeSize";
import { EdgeSlice } from "./edgeSlice";
import { ViewportSlice } from "./viewportSlice";
import { SharedSlice } from "./sharedSlice";
import { defaultModelConfigurations, XSSizeModelConfiguration } from "../models/defaultParams";
import { ModelConfiguration } from "../models/modelLibrary";
import { CSSProperties } from "react";
import {
  AppNode,
  AppNodeData,
  ContainerNode,
  ContainerNodeData,
  ContentNode,
  ContentNodeData,
  ContentResponse, isAudioResponse,
  isContainerNode,
  isContainerNodeData,
  isContentNode,
  isContentNodeData, isImageResponse, isPdfResponse,
  isPromptNode,
  isPromptNodeData,
  PriorityPair,
  PromptNode,
  PromptNodeData,
} from "./interfaces";
import { makeRequest } from "../../components/Nodes/PromptNode/Request/makeRequest";
import { EnqueueSnackbar } from "notistack";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { makeTranscriptionRequest } from "../../components/Nodes/PromptNode/Request/makeTranscriptionRequest";
import { makeVisionRequest } from "../../components/Nodes/PromptNode/Request/makeVisionRequest";
import { ContentAction } from "../../components/Buttons/ContentNodeActionButton";
import { AttachmentSource } from "../../components/Nodes/PromptNode/Request/singleAgentRequest";

// import {ContentAction} from "../models/interfaces";

function parsePx(value?: string): number | undefined {
  return value ? parseFloat(value.replace("px", "")) : undefined;
}

export type NodeSlice = {
  nodes: AppNode[];
  setNodeToFocus: (id: string) => void;

  _changeNodeProperty: (
    id: string,
    property: string,
    newValue: any,
    nodes: AppNode[]
  ) => void;
  changeNodeExecutionStatus: (id: string, isExecuted: boolean) => void;
  changeNodeSelectedModels: (id: string, selectedModels: ModelConfiguration[]) => void;

  _changeNodeStyle: (
    id: string,
    style: CSSProperties,
    nodes: AppNode[]
  ) => void;

  _setNodes: (transform: AppNode[] | ((nodes: AppNode[]) => AppNode[])) => void;

  onNodesChange: OnNodesChange;
  onNodeDragStop: (
    event: React.MouseEvent,
    node: AppNode,
    nodes: AppNode[]
  ) => void;

  _addNewNode: (
    nodeType: "prompt" | "content",
    position: XYPosition,
    data: AppNodeData,
    size?: { width: number; height: number }
  ) => AppNode;

  addPromptNode: (
    position: XYPosition,
    data?: PromptNodeData,
    size?: { width: number; height: number }
  ) => PromptNode;

  addContentNode: (
    position: XYPosition,
    data: ContentNodeData,
    size?: { width: number; height: number }
  ) => ContentNode;

  _addNewContainerNode: (
    nodeType: "container",
    position: XYPosition,
    data: AppNodeData,
    size?: { width: number; height: number }
  ) => AppNode;

  addContainerNode: (
    position: XYPosition,
    data?: ContainerNodeData,
    size?: { width: number; height: number }
  ) => ContainerNode;
  getContainerIsOpen: (containerId: string) => boolean;
  changeContainerIsOpen: (id: string, newValue: boolean) => void;

  changeNodePrompt: (id: string, newValue: string) => void;
  changeNodeSystemPrompt: (id: string, newValue: string) => void;
  changeNodeResponse: (id: string, newValue: ContentResponse) => void;
  clearContentResponsePromise: (id: string) => void;
  changeNodeSelectedIndex: (id: string, newValue: number) => void;
  togglePromptModelsMode: (id: string) => void;
  changeContainedNodeModelConfiguration: (
    id: string,
    newValue: ModelConfiguration
  ) => void;

  changeNodeModelConfiguration: (
    id: string,
    newValue: ModelConfiguration
  ) => void;

  addModelToNode: (id: string, model: ModelConfiguration) => void;
  removeModelFromNode: (id: string, modelName: string) => void;
  changeAreThoughtsShownForModel: (id: string, model: ModelConfiguration, newValue: boolean) => void;

  markPromptNodeAsAggregateNode: (id: string, value: boolean) => void;
  changeNodeStyle: (id: string, newValue: CSSProperties) => void;

  changeNodeRecentModelsList: (id: string, newValue: string) => void;

  getNodeSize: (id: string) => {
    width: number | null | undefined;
    height: number | null | undefined;
  };

  updateNodeSize: (id: string, { width, height }: {
    width?: number | null;
    height?: number | null;
  }) => void;

  getNodeCopyById: (id: string) => AppNode | undefined;
  getContent: () => { prompt: string; response: ContentResponse }[];
  getViewportBasedOnRectOfNodes: (
    imageWidth: number,
    imageHeight: number,
    minZoom?: number,
    maxZoom?: number
  ) => Viewport;
  getNodeData: (id: string) => AppNodeData | undefined;
  getNodeById: (id: string) => AppNode | undefined;

  setIsUserDraggingContainer: (id: string, value: boolean) => void;
  changeAreThoughtsShown: (id: string, newValue: boolean) => void;
  createAndGetContainerNodeForPromptNode: (
    id: string,
    position: XYPosition
  ) => string;
  addProposerToContainer: (containerId: string, proposerId: string) => void;
  addContentNodeToContainer: (contentNodeId: string) => void;
  getContainerProposersNodes: (containerId: string) => AppNode[];
  getContainerContentNodes: (containerId: string) => AppNode[];
  getContainerPromptNodes: (containerId: string) => AppNode[];
  getContainerProposersIds: (containerId: string) => string[];
  updateNodePosition: (id: string, position: XYPosition) => void;
  moveNodeInContainer: (
    containerId: string,
    fromIndex: number,
    toIndex: number
  ) => void;
  getContentNodeInContainerPosition: (proposerId: string) => XYPosition;
  getProposerSizeForContentNode: (proposerId: string) => {
    width: number;
    height: number;
  };
  updateContainerContentNodesVisibility: (
    containerId: string,
    value: boolean
  ) => void;
  updateContainerPromptNodesVisibility: (
    containerId: string,
    value: boolean
  ) => void;
  updateContainerHeight: (
    containerId: string,
    value?: number,
    isDeleting?: boolean
  ) => void;
  updateContainerNodesPositions: (containerId: string) => void;
  deleteProposerWithContent: (promptNodeId: string) => void;
  setInteractionModeFromContainer: (promptNodeId: string, mode: string) => void;
  getInteractionModeFromContainer: (containerId: string) => string;
  setRoleForProposer: (proposerId: string, role: string) => void;
  getProposerRoles: (containerNodeId: string) => string[];
  getNodeChildren: (id: string, model?: string) => string[];
  getLastNodeOnSide: (children: string[], parentId: string, side: string) => string | undefined;
  prepareAndMakeRequest: (
    promptNodeId: string,
    virtualKey: string | null,
    enqueueSnackbar: EnqueueSnackbar,
    buildContext: (id: string) => any,
    getProposersDataAndContext: (promptNodeId: string) => [PromptNodeData, string, ChatCompletionMessageParam[]][],
    getNewContentNodePosition: (promptNodeId: string, childType: string) => XYPosition,
    getAttachmentPathFromAncestor: (id: string) => AttachmentSource | undefined,
    isRegenerated: boolean,
    modelUsed?: string
  ) => void;
  transcribeAudio: (
    contentNodeId: string,
    model: ContentAction,
    newContentNodePosition: (promptNodeId: string, childType: string) => XYPosition,
    virtualKey: string
  ) => void;
  visionPdfOrImage: (
    contentNodeId: string,
    model: ContentAction,
    newContentNodePosition: (promptNodeId: string, childType: string) => XYPosition,
    virtualKey: string
  ) => void;

  getXPositionForDuplicatedPromptNode: (promptId: string) => number | undefined;
};

const generateNewNodeId = () =>
  `randomnode_${Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
const CONTENT_ITEM_REDUCTION = 14;
const DEFAULT_EMPTY_CONTAINER_HEIGHT = 68;
const CONTAINER_HEADER_HEIGHT = 60;

export const createNodeSlice: StateCreator<
  NodeSlice & EdgeSlice & ViewportSlice & SharedSlice,
  [],
  [],
  NodeSlice
> = ((set, get) => {

  function updateModelInNode(
    id: string,
    updater: (models: ModelConfiguration[]) => ModelConfiguration[]
  ) {
    const node = get().getNodeById(id);
    if (!node || !isPromptNode(node)) return;

    const nodeModels = node.data.selectedModels ?? [];
    const updatedModels = updater(nodeModels);
    get()._changeNodeProperty(id, "selectedModels", updatedModels, get().nodes);
    return updatedModels;
  }

  const detectSide = (
    nodeId: string,
    parentId: string
  ): "bottom" | "top" | "left" | "right" => {
    const parent = get().getNodeById(parentId);
    const node = get().getNodeById(nodeId);
    if (!parent || !node) return "bottom";

    const dx = node.position.x - parent.position.x;
    const dy = node.position.y - parent.position.y;

    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? "right" : "left";
    } else {
      return dy > 0 ? "bottom" : "top";
    }
  };

  const linkContentNodeToSiblingOrParent = (newNodeId: string) => {
    const data = get().getNodeData(newNodeId);
    if (!data || !isContentNodeData(data)) return;
    const parentId = data.parentId;
    const siblings = get().getNodeChildren(parentId).filter(id => id !== newNodeId);

    const side = detectSide(newNodeId, parentId);

    const targetNodeId = get().getLastNodeOnSide(siblings, parentId, side);
    get().addNewEdge(targetNodeId || parentId, newNodeId);
  };

  return {
    nodes: [],
    setNodeToFocus: (id: string) => {
      get().nodes.forEach(n => {
        if ((isPromptNode(n) || isContentNode(n)) && n.data.isFocused) {
          get()._changeNodeProperty(n.id, "isFocused", false, get().nodes);
        }
      });
      get()._changeNodeProperty(id, "isFocused", true, get().nodes);
    },

    _changeNodeProperty(
      id: string,
      property: string,
      newValue: any,
      nodes: AppNode[]
    ) {
      // console.log(`Node with id "${id}" props change:`, `{${property}: ${newValue}}`);
      useFlowStore.setState({
        nodes: nodes.map((node) =>
          node.id === id
            ? {
              ...node,
              data: {
                ...node.data,
                [property]: newValue,
              },
            }
            : node
        ),
      });
      get().scheduleSave();
    },

    _changeNodeStyle(id: string, style: CSSProperties, nodes: AppNode[]) {
      useFlowStore.setState({
        nodes: nodes.map((node) =>
          node.id === id
            ? {
              ...node,
              width: style.width
                ? typeof style.width === "string"
                  ? parsePx(style.width)
                  : style.width
                : node.width,
              height: style.height
                ? typeof style.height === "string"
                  ? parsePx(style.height)
                  : style.height
                : node.height,
              style: { ...node.style, ...style },
            }
            : node
        ),
      });
      get().scheduleSave();
    },

    getNodeData(id) {
      return get().nodes.find((node) => node.id === id)?.data;
    },

    getNodeById(id: string) {
      return get().nodes.find((node) => node.id === id);
    },

    getNodeSize(id) {
      let node = get().nodes.find((node) => node.id === id);
      return {
        width: node?.measured?.width ?? node?.width,
        height: node?.measured?.height ?? node?.height,
      };
    },

    updateNodeSize(id, { width, height }) {
      set({
        nodes: get().nodes.map((node) =>
          node.id === id
            ? {
              ...node,
              measured: {
                width: width ?? node.measured?.width ?? undefined,
                height: height ?? node.measured?.height ?? undefined,
              },
            }
            : node
        ),
      });
    },

    changeNodeExecutionStatus(id, isExecuted) {
      get()._changeNodeProperty(id, "isExecuted", isExecuted, get().nodes);
    },

    changeNodeSelectedModels(id, selectedModels) {
      get()._changeNodeProperty(id, "selectedModels", selectedModels, get().nodes);
    },

    _setNodes(transform: AppNode[] | ((nodes: AppNode[]) => AppNode[])) {
      if (Array.isArray(transform))
        set({
          nodes: transform,
        });
      else
        set({
          nodes: transform(get().nodes),
        });
    },

    onNodesChange(changes: NodeChange[]) {
      set({
        nodes: applyNodeChanges(changes, get().nodes) as AppNode[],
      });
      if (changes.some(c => c.type === "position" || c.type === "dimensions")) {
        get().scheduleSave();
      }
    },

    onNodeDragStop(
      _event: React.MouseEvent,
      _node: AppNode,
      _nodes: AppNode[]
    ) {
    },

    _addNewNode(nodeType, position, data, size = DEFAULT_NODE_SIZE) {
      const newId = generateNewNodeId();
      const newNode: AppNode = {
        id: newId,
        type: nodeType,
        data: data,
        position: position,
        width: size.width,
        height: size.height,
        style: {
          width: size.width,
          height: size.height,
          ...(((isPromptNodeData(data) || isContentNodeData(data)) && data.isContained) ?
            { zIndex: 3 }
            : isContainerNodeData(data) ?
              { zIndex: 1 }
              : {}),
          ...((isPromptNodeData(data) || isContentNodeData(data)) && data.isHidden ? {
            opacity: 0,
            visibility: "hidden",
            pointerEvents: "none"
          } : {})
        },
      };
      set({
        nodes: [...get().nodes, newNode],
      });
      // console.log(
      //   `New node with id '${newId}' created at ${newNode.position.x}, ${newNode.position.y}`
      // );
      get().scheduleSave();
      return newNode;
    },

    addPromptNode(
      position,
      data = {
        isExecuted: false,
        prompt: "",
        selectedModels:
          [defaultModelConfigurations.text],
        recentModelsList:
          [{
            value: defaultModelConfigurations.text.name,
            priority: 0,
          }],
        areThoughtsShown: false,
      },
      size = DEFAULT_PROMPT_NODE_SIZE
    ) {
      return get()._addNewNode("prompt", position, data, size) as PromptNode;
    },

    addContentNode(position, data, size = DEFAULT_CONTENT_NODE_SIZE) {
      const newNode = get()._addNewNode(
        "content",
        position,
        data,
        size
      ) as ContentNode;
      if (newNode && data.isContained && data.MoAContainerId) {
        get().addContentNodeToContainer(newNode.id);
        get().updateContainerHeight(data.MoAContainerId);
      }
      return newNode;
    },

    _addNewContainerNode(
      nodeType,
      position,
      data,
      size = DEFAULT_CONTAINER_NODE_SIZE
    ) {
      const newNode: AppNode = {
        id: `container_` + generateNewNodeId(),
        type: nodeType,
        data: data,
        position: position,
        width: size.width,
        height: size.height,
        style: {
          width: size.width,
          height: size.height,
          zIndex: 2,
        },
        draggable: true,
      };
      set({
        nodes: [...get().nodes, newNode],
      });
      return newNode;
    },

    addContainerNode(
      position,
      data = {
        proposers: [],
        contentNodes: [],
        parentPromptId: "",
        areThoughtsShown: true,
      },
      size = DEFAULT_CONTAINER_NODE_SIZE
    ) {
      return get()._addNewContainerNode(
        "container",
        position,
        data,
        size
      ) as ContainerNode;
    },

    getContainerIsOpen(containerId) {
      const data = get().getNodeData(containerId);
      if (!data || !isContainerNodeData(data)) return false;
      return data.isOpen ?? false;
    },

    changeContainerIsOpen(id, value) {
      get()._changeNodeProperty(id, "isOpen", value, get().nodes);
    },

    markPromptNodeAsAggregateNode(id, value) {
      get()._changeNodeProperty(id, "isAggregateNode", value, get().nodes);
    },

    changeNodePrompt(id, newValue) {
      get()._changeNodeProperty(id, "prompt", newValue, get().nodes);
    },

    changeNodeSystemPrompt(id, newValue) {
      get()._changeNodeProperty(id, "systemPrompt", newValue, get().nodes);
    },

    changeNodeResponse(id, newValue) {
      get()._changeNodeProperty(id, "response", newValue, get().nodes);
    },

    clearContentResponsePromise(id) {
      get()._changeNodeProperty(id, "responsePromise", undefined, get().nodes);
    },

    changeNodeSelectedIndex(id, newValue) {
      get()._changeNodeProperty(id, "selectedIndex", newValue, get().nodes);
    },

    changeContainedNodeModelConfiguration(id, newValue) {
      get()._changeNodeProperty(id, "selectedModels", [newValue], get().nodes);
      get()._changeNodeProperty(id, "areThoughtsShown", newValue.areThoughtsShown, get().nodes);
    },

    togglePromptModelsMode(id) {
      const node = get().getNodeById(id);
      const data = node?.data;
      if (!node || !isPromptNode(node) || !isPromptNodeData(data)) {
        return;
      }
      const isMulti = data.selectedModels.length > 1;
      if (isMulti) {
        const singleModel =
          data.storedSingleModel
            ? data.storedSingleModel
            : defaultModelConfigurations.text;
        get()._changeNodeProperty(id, "selectedModels", [singleModel], get().nodes);
        get()._changeNodeProperty(id, "recentModelsList",
          [{
            value: singleModel.name,
            priority: 0,
          }],
          get().nodes
        );
      } else {
        get()._changeNodeProperty(id, "storedSingleModel", data.selectedModels[0], get().nodes);
        const multiModels = [...XSSizeModelConfiguration.text];
        get()._changeNodeProperty(id, "selectedModels", multiModels, get().nodes);
        get()._changeNodeProperty(id, "recentModelsList",
          multiModels.map((m, index) => ({
            value: m.name,
            priority: index,
          })),
          get().nodes
        );
      }
    },

    changeNodeModelConfiguration(id, newValue) {
      updateModelInNode(id, (models) => {
        const isExisting = models.some((m) => m.name === newValue.name);
        if (isExisting) {
          return models.map((m) => (m.name === newValue.name ? { ...m, ...newValue } : m));
        }
        return [...models, newValue];
      });
    },

    addModelToNode(id, model) {
      updateModelInNode(id, (models) => {
        if (models.some((m) => m.name === model.name)) return models;
        const node = get().getNodeById(id);
        return [
          ...models,
          {
            ...model,
            areThoughtsShown: node?.data?.areThoughtsShown ?? false,
          }
        ];
      });
    },

    removeModelFromNode(id, modelName) {
      updateModelInNode(id, (models) => {
        const updatedModels = models.filter((m) => m.name !== modelName);
        const anyWithThoughts = updatedModels.some((m) => m.areThoughtsShown);
        get()._changeNodeProperty(id, "areThoughtsShown", anyWithThoughts, get().nodes);
        return updatedModels;
      });
    },

    changeAreThoughtsShownForModel(id, model, newValue) {
      const updatedModels = updateModelInNode(id, (models) => {
        const exists = models.some((m) => m.name === model.name);
        let newModels = exists ? models : [...models, model];
        return newModels.map((m) =>
          m.name === model.name ? { ...m, areThoughtsShown: newValue } : m
        );
      });

      if (updatedModels) {
        const anyWithThoughts = updatedModels.some((m) => m.areThoughtsShown);
        get()._changeNodeProperty(id, "areThoughtsShown", anyWithThoughts, get().nodes);
      }
    },

    changeNodeStyle(id, newValue) {
      get()._changeNodeStyle(id, newValue, get().nodes);
    },
    changeNodeRecentModelsList(id, newValue, capacity = 3): void {
      const nodeData = get().nodes.find((node) => node.id === id)?.data;
      if (isPromptNodeData(nodeData)) {
        const tempRecentModelsList: PriorityPair[] = JSON.parse(
          JSON.stringify(nodeData.recentModelsList)
        );
        let hasModel =
          tempRecentModelsList.find((pp) => pp.value === newValue) !== undefined;

        if (hasModel) {
          tempRecentModelsList.forEach((pp) => {
            if (pp.value === newValue) {
              pp.priority = 0;
            } else {
              pp.priority++;
            }
          });
        } else {
          if (tempRecentModelsList.length === capacity) {
            tempRecentModelsList.pop();
          }

          tempRecentModelsList.unshift({ priority: -1, value: newValue });
          tempRecentModelsList.forEach((pp) => pp.priority++);
        }

        tempRecentModelsList.sort((a, b) => a.priority - b.priority);
        get()._changeNodeProperty(
          id,
          "recentModelsList",
          tempRecentModelsList,
          get().nodes
        );
      }
    },

    getNodeCopyById(id: string) {
      try {
        const node = structuredClone(get().nodes.find((node) => node.id === id));
        if (!node) {
          console.error(
            `Unable to get node copy: there is no node with given id ${id}`
          );
        }
        return node;
      } catch (err: any) {
        console.error(`Unable to get node copy: ${err.toString()}`);
      }
    },
    getContent() {
      return get().nodes.reduce(function (
        filtered: { prompt: string; response: ContentResponse }[],
        node
      ) {
        if (isContentNode(node)) {
          var data = { prompt: node.data.prompt, response: node.data.response };
          filtered.push(data);
        }
        return filtered;
      },
        []);
    },
    getViewportBasedOnRectOfNodes(
      imageWidth,
      imageHeight,
      minZoom = 0.2,
      maxZoom = 2,
      padding = 2
    ) {
      const nodesBounds = getNodesBounds(get().nodes);
      return getViewportForBounds(
        nodesBounds,
        imageWidth,
        imageHeight,
        minZoom,
        maxZoom,
        padding
      );
    },

    changeAreThoughtsShown(id, newValue) {
      const node = get().getNodeById(id);
      if (!node || !isPromptNode(node)) return;

      get()._changeNodeProperty(id, "areThoughtsShown", newValue, get().nodes);
      const updatedModels = (node.data.selectedModels || []).map((m) => ({
        ...m,
        areThoughtsShown: newValue,
      }));
      get()._changeNodeProperty(id, "selectedModels", updatedModels, get().nodes);
    },

    createAndGetContainerNodeForPromptNode(id, position) {
      const promptNodeData = get().getNodeData(id);
      const containerId = isPromptNodeData(promptNodeData)
        ? promptNodeData.MoAContainerId
        : undefined;
      if (containerId) {
        const existingContainer = get().getNodeById(containerId);
        if (existingContainer && isContainerNode(existingContainer)) {
          return existingContainer.id;
        }
      }
      const newContainer = get().addContainerNode(
        {
          x: position.x,
          y: position.y,
        },
        {
          proposers: [],
          contentNodes: [],
          parentPromptId: id,
          areThoughtsShown: true,
        }
      );
      get()._changeNodeProperty(
        id,
        "MoAContainerId",
        newContainer.id,
        get().nodes
      );
      get().addNewEdge(newContainer.id, id);
      return newContainer.id;
    },

    addProposerToContainer(containerId, proposerId) {
      const container = get().getNodeById(containerId);
      if (!container || !isContainerNode(container)) {
        console.log(`Container with id ${containerId} not found`);
        return;
      }
      get()._changeNodeProperty(
        containerId,
        "proposers",
        [...container.data.proposers, proposerId],
        get().nodes
      );
      const { height } = get().getNodeSize(containerId);
      const proposerHeight =
        get().getNodeSize(proposerId).height || DEFAULT_MOA_PROMPT_NODE_HEIGHT;
      const proposerData = get().getNodeData(proposerId);
      if (!proposerData || !isPromptNodeData(proposerData)) return;

      if (!proposerData.isHidden) {
        if (height && container.data.proposers.length >= 1) {
          get().changeNodeStyle(containerId, {
            height: height + proposerHeight,
          });
        }
      }
    },

    addContentNodeToContainer(contentNodeId) {
      const contentData = get().getNodeData(contentNodeId);
      if (!contentData || !isContentNodeData(contentData)) return;

      const parentData = get().getNodeData(contentData.parentId);
      if (!parentData || !isPromptNodeData(parentData)) return;
      const containerId = parentData.MoAContainerId;
      if (!containerId) return;

      const container = get().getNodeById(containerId);
      if (!container || !isContainerNode(container)) {
        console.log(`Container with id ${containerId} not found`);
        return;
      }
      get()._changeNodeProperty(
        containerId,
        "contentNodes",
        [...container.data.contentNodes, contentNodeId],
        get().nodes
      );
    },

    getContainerProposersNodes(containerId) {
      const container = get().getNodeById(containerId);
      if (!container || !isContainerNode(container)) {
        console.log(`Container with id ${containerId} not found`);
        return [];
      }
      return container.data.proposers
        .map((nodeId: string) => get().getNodeById(nodeId))
        .filter((node): node is AppNode => node !== undefined);
    },

    getContainerContentNodes(containerId) {
      const container = get().getNodeById(containerId);
      if (!container || !isContainerNode(container)) {
        console.log(`Container with id ${containerId} not found`);
        return [];
      }
      return container.data.contentNodes
        .map((nodeId: string) => {
          const data = get().getNodeData(nodeId);
          if (!data || !isContentNodeData(data)) {
            return undefined;
          }
          return get().getNodeById(nodeId);
        })
        .filter((node): node is AppNode => node !== undefined);
    },

    getContainerPromptNodes(containerId) {
      const container = get().getNodeById(containerId);
      if (!container || !isContainerNode(container)) {
        console.log(`Container with id ${containerId} not found`);
        return [];
      }
      return container.data.proposers
        .map((nodeId: string) => {
          const data = get().getNodeData(nodeId);
          if (!data || !isPromptNodeData(data)) {
            return undefined;
          }
          return get().getNodeById(nodeId);
        })
        .filter((node): node is AppNode => node !== undefined);
    },

    getContainerProposersIds(containerId) {
      const container = get().getNodeById(containerId);
      if (!container || !isContainerNode(container)) {
        console.log(`Container with id ${containerId} not found`);
        return [];
      }
      return container.data.proposers;
    },

    updateNodePosition(id: string, position: XYPosition) {
      set({
        nodes: get().nodes.map((node) =>
          node.id === id ? { ...node, position: position } : node
        ),
      });
    },

    moveNodeInContainer(containerId, fromIndex, toIndex) {
      const containerNodes = get().getContainerProposersIds(containerId);
      const containerNode = get().getNodeById(containerId);
      if (!containerNode) return;
      get().setIsUserDraggingContainer(containerId, false);
      const [movedNode] = containerNodes.splice(fromIndex, 1);
      containerNodes.splice(toIndex, 0, movedNode);

      containerNodes.forEach((nodeId, index) => {
        const node = get().getNodeById(nodeId);
        if (node) {
          get().updateNodePosition(nodeId, {
            x: node.position.x,
            y:
              containerNode.position.y +
              index * DEFAULT_MOA_PROMPT_NODE_HEIGHT +
              48,
          });
        }
      });
      get()._changeNodeProperty(
        containerId,
        "proposers",
        containerNodes,
        get().nodes
      );
    },

    setIsUserDraggingContainer(id: string, value: boolean) {
      get()
        .getContainerProposersIds(id)
        .forEach((nodeId) => {
          get()._changeNodeProperty(nodeId, "isUserDragging", value, get().nodes);
        });
    },

    getContentNodeInContainerPosition(proposerId: string) {
      const proposerNode = get().getNodeById(proposerId);
      if (!proposerNode) {
        console.log(`Proposer node with id ${proposerId} not found`);
        return { x: 0, y: 0 };
      }
      return {
        x: proposerNode.position.x,
        y:
          proposerNode.position.y +
          (proposerNode.height || DEFAULT_MOA_PROMPT_NODE_HEIGHT) -
          14,
      };
    },

    getProposerSizeForContentNode(proposerId: string) {
      const node = get().getNodeById(proposerId);
      if (!node) {
        console.log(`Proposer node with id ${proposerId} not found`);
        return DEFAULT_CONTENT_NODE_SIZE;
      }
      const style = get().getNodeSize(proposerId);
      return {
        width: style.width || node.width || DEFAULT_CONTENT_NODE_SIZE.width,
        height: DEFAULT_CONTENT_NODE_SIZE.height,
      };
    },

    updateContainerHeight(containerId, value, isDeleting) {
      console.log(
        `Updating container height for ${containerId} with value ${value} and isDeleting ${isDeleting}`
      );
      if (!value) {
        const proposerNodes = get().getContainerProposersNodes(containerId);
        const contentNodes = get().getContainerContentNodes(containerId);

        const proposersHeight = proposerNodes.reduce((sum, node) => {
          if (!node.data || !isPromptNodeData(node.data)) return sum;
          if (node.data.isHidden) return sum;
          const height = node.measured?.height ?? DEFAULT_MOA_PROMPT_NODE_HEIGHT;
          return sum + height;
        }, 0);
        const contentHeight = contentNodes.reduce((sum, node) => {
          if (!node.data || !isContentNodeData(node.data)) return sum;
          if (node.data.isHidden) return sum;
          const height =
            (node.measured?.height ?? DEFAULT_CONTENT_NODE_SIZE.height) -
            CONTENT_ITEM_REDUCTION;
          return sum + height;
        }, 0);

        const totalContainerHeight = proposersHeight + contentHeight;
        const newHeight =
          totalContainerHeight > 0
            ? totalContainerHeight + CONTAINER_HEADER_HEIGHT
            : DEFAULT_EMPTY_CONTAINER_HEIGHT;

        const containerStyle = get().getNodeSize(containerId);
        if (containerStyle.height !== newHeight) {
          get().updateNodeSize(containerId, {
            height: newHeight,
          });
          get().changeNodeStyle(containerId, {
            height: newHeight,
          });
        }
      } else {
        const currentHeight =
          get().getNodeSize(containerId).height ??
          DEFAULT_CONTAINER_NODE_SIZE.height;
        get().updateNodeSize(containerId, {
          height: currentHeight + value - CONTENT_ITEM_REDUCTION,
        });
        get().changeNodeStyle(containerId, {
          height: currentHeight + value - CONTENT_ITEM_REDUCTION,
        });
      }
      get().updateContainerNodesPositions(containerId);
    },

    updateContainerContentNodesVisibility(containerId, value) {
      const contentNodes = get().getContainerContentNodes(containerId);
      contentNodes.forEach((contentNode) => {
        get()._changeNodeProperty(
          contentNode.id,
          "isHidden",
          !value,
          get().nodes
        );
        get().changeNodeStyle(contentNode.id, {
          visibility: value ? "visible" : "hidden",
          opacity: value ? 1 : 0,
          pointerEvents: value ? "auto" : "none",
        })
      });
      get().updateContainerHeight(containerId, undefined, value);
      get()._changeNodeProperty(containerId, "areThoughtsShown", value, get().nodes);
    },

    updateContainerPromptNodesVisibility(containerId, value) {
      const promptNodes = get().getContainerPromptNodes(containerId);
      promptNodes.forEach((promptNode) => {
        get()._changeNodeProperty(
          promptNode.id,
          "isHidden",
          !value,
          get().nodes
        );
        get().changeNodeStyle(promptNode.id, {
          visibility: value ? "visible" : "hidden",
          opacity: value ? 1 : 0,
          pointerEvents: value ? "auto" : "none",
        })
      });
      get().updateContainerHeight(containerId, undefined, value);
    },

    updateContainerNodesPositions(containerId) {
      const container = get().getNodeById(containerId);
      if (!container) return;

      const proposerNodes = get().getContainerProposersIds(containerId);
      const contentNodes = get().getContainerContentNodes(containerId);
      let currentY = container.position.y + 48;
      const containerX = container.position.x + 8;

      proposerNodes.forEach((proposerId) => {
        if (!get().getNodeById(proposerId)) return;
        get().updateNodePosition(proposerId, {
          x: containerX,
          y: currentY,
        });

        const proposerHeight =
          get().getNodeSize(proposerId).height || DEFAULT_MOA_PROMPT_NODE_HEIGHT;
        const contentNode = contentNodes.find((node) => {
          const data = get().getNodeData(node.id);
          if (!data || !isContentNodeData(data)) return false;
          return data.parentId === proposerId && !data.isHidden;
        });
        if (contentNode) {
          currentY += proposerHeight - CONTENT_ITEM_REDUCTION;
          get().updateNodePosition(contentNode.id, {
            x: containerX,
            y: currentY,
          });
          currentY +=
            get().getNodeSize(contentNode.id).height ||
            DEFAULT_CONTENT_NODE_SIZE.height;
        } else {
          currentY += proposerHeight;
        }
      });
    },

    deleteProposerWithContent(promptNodeId) {
      const promptNodeData = get().getNodeData(promptNodeId);
      if (!promptNodeData || !isPromptNodeData(promptNodeData)) return;

      const containerId = promptNodeData.MoAContainerId;
      if (!containerId) return;
      const contentNodes = get().getContainerContentNodes(containerId);

      const relatedContentNode = contentNodes.find(
        (node) => isContentNode(node) && node.data.parentId === promptNodeId
      );
      if (relatedContentNode) {
        get().deleteNodeWithEdges(relatedContentNode.id);
      }
      get().deleteNodeWithEdges(promptNodeId);
    },

    setInteractionModeFromContainer(promptNodeId, mode) {
      const promptNodeData = get().getNodeData(promptNodeId);
      if (
        isPromptNodeData(promptNodeData) &&
        promptNodeData.MoAContainerId &&
        !promptNodeData.isContained
      ) {
        get()._changeNodeProperty(
          promptNodeId,
          "interactionMode",
          mode,
          get().nodes
        );
        const containerNode = get().getNodeById(promptNodeData.MoAContainerId);
        if (containerNode) {
          const children = get().getContainerProposersIds(containerNode.id);
          children.forEach((child) => {
            get()._changeNodeProperty(
              child,
              "interactionMode",
              mode,
              get().nodes
            );
          });
        }
      }
    },

    getInteractionModeFromContainer(containerId) {
      const containerNodeData = get().getNodeData(containerId);
      if (isContainerNodeData(containerNodeData)) {
        const parentPromptNodeData = get().getNodeData(
          containerNodeData.parentPromptId
        );
        if (
          isPromptNodeData(parentPromptNodeData) &&
          parentPromptNodeData.MoAContainerId &&
          !parentPromptNodeData.isContained
        ) {
          return parentPromptNodeData.interactionMode ?? "";
        }
      }
      return "";
    },

    setRoleForProposer(proposerId, role) {
      const promptNodeData = get().getNodeData(proposerId);
      if (
        isPromptNodeData(promptNodeData) &&
        promptNodeData.MoAContainerId &&
        promptNodeData.isContained
      ) {
        get()._changeNodeProperty(proposerId, "role", role, get().nodes);
      }
    },

    getProposerRoles(containerNodeId) {
      const proposers = get().getContainerProposersIds(containerNodeId);
      return proposers.flatMap((id) => {
        const data = get().getNodeData(id);
        return isPromptNodeData(data) && data.role ? [data.role] : [];
      });
    },

    getNodeChildren(id) {
      return get()
        .nodes
        .filter((node) => {
          const data = node.data;
          return (isPromptNodeData(data) && !!data.parentId?.some(parentId => parentId === id)) || (isContentNodeData(data) && data.parentId === id);
        })
        .map((node) => node.id);
    },

    getLastNodeOnSide(children, parentId, side) {
      const sameSideChildren = children.filter(childId =>
        detectSide(childId, parentId) === side
      );

      let targetNodeId: string;
      if (sameSideChildren.length === 0) {
        return;
      } else {
        let distantNode = get().getNodeById(sameSideChildren[0]);

        for (const ch of sameSideChildren) {
          const chNode = get().getNodeById(ch);
          if (!chNode || !distantNode) continue;

          if (side === "bottom" && chNode.position.y > distantNode.position.y) distantNode = chNode;
          if (side === "top" && chNode.position.y < distantNode.position.y) distantNode = chNode;
          if (side === "right" && chNode.position.x > distantNode.position.x) distantNode = chNode;
          if (side === "left" && chNode.position.x < distantNode.position.x) distantNode = chNode;
        }
        if (!distantNode) return;
        targetNodeId = distantNode.id;
      }
      return targetNodeId;
    },

    prepareAndMakeRequest(
      promptNodeId,
      virtualKey,
      enqueueSnackbar,
      buildContext,
      getProposersDataAndContext,
      getNewContentNodePosition,
      getAttachmentPathFromAncestor,
      isRegenerated = false,
      modelUsed
    ) {
      const node = get().getNodeById(promptNodeId);
      if (!node || !isPromptNode(node)) {
        console.warn(`makePromptRequest: node ${promptNodeId} not found or not a prompt node`);
        return;
      }

      let promptNodeData = get().getNodeData(node.id);
      if (!promptNodeData || !isPromptNodeData(promptNodeData)) {
        return;
      }
      let fromPromptsContainer = false;
      if (promptNodeData.selectedModels.length > 1 && !promptNodeData.isAggregateNode) {
        fromPromptsContainer = true;
      }

      if (isRegenerated && modelUsed) {
        const models = Array.isArray(promptNodeData.selectedModels) ? promptNodeData.selectedModels : [];
        const newSelectedModels = models.find((m) => m.name === modelUsed);
        if (newSelectedModels) {
          promptNodeData = {
            ...promptNodeData,
            selectedModels: [newSelectedModels],
          }
        }
      }
      return makeRequest({
        promptNodeData,
        promptNodeId,
        virtualKey: virtualKey,
        enqueueSnackbar: enqueueSnackbar,
        buildContext: buildContext,
        addNewEdge: get().addNewEdge,
        addContentNode: get().addContentNode,
        changeNodeExecutionStatus: get().changeNodeExecutionStatus,
        proposersDataAndContext: getProposersDataAndContext(promptNodeId),
        getContentNodePosition: get().getContentNodeInContainerPosition,
        getProposerSize: get().getProposerSizeForContentNode,
        changeAreThoughtsShown: get().changeAreThoughtsShown,
        addContentNodeToContainer: get().addContentNodeToContainer,
        newContentNodePosition: getNewContentNodePosition,
        isRegenerated: isRegenerated,
        getProposerRoles: get().getProposerRoles,
        directAncestorAttachment: getAttachmentPathFromAncestor(promptNodeId),
        isFromPromptContainer: fromPromptsContainer,
        linkContentNodeToSiblingOrParent: linkContentNodeToSiblingOrParent,
        changeNodeSelectedModels: get().changeNodeSelectedModels,
      });
    },

    transcribeAudio(contentNodeId, action, newContentNodePosition, virtualKey) {
      const node = get().getNodeById(contentNodeId);
      if (!node) {
        console.warn(`Node ${contentNodeId} not found`);
        return;
      }
      const contentData = get().getNodeData(contentNodeId);
      if (!contentData || !isContentNodeData(contentData) || !isAudioResponse(contentData.response)) {
        console.warn(`Node ${contentNodeId} is not audio`);
        return;
      }
      const pos = newContentNodePosition(contentNodeId, "text");
      const promise = makeTranscriptionRequest({
        filePath: contentData.response.path,
        action,
        virtualKey
      });
      const newNode = get().addContentNode(
        pos,
        {
          parentId: contentNodeId,
          prompt: action.description,
          responsePromise: promise,
          response: undefined,
          isRegenerated: false,
          areThoughtsShown: false,
          modelUsed: action.model.name,
        },
        DEFAULT_CONTENT_NODE_SIZE
      );
      get().addNewEdge(contentNodeId, newNode.id);
    },

    visionPdfOrImage(contentNodeId, action, newContentNodePosition, virtualKey) {
      const node = get().getNodeById(contentNodeId);
      if (!node) {
        console.warn(`Node ${contentNodeId} not found`);
        return;
      }

      const contentData = get().getNodeData(contentNodeId);
      if (!contentData || !isContentNodeData(contentData) || !(isPdfResponse(contentData.response) || isImageResponse(contentData.response))) {
        console.warn(`Node ${contentNodeId} is not a PDF or an image`);
        return;
      }
      const pos = newContentNodePosition(contentNodeId, "text");

      const promise = makeVisionRequest({
        filePath: contentData.response.path,
        action,
        virtualKey
      });

      const newNode = get().addContentNode(
        pos,
        {
          parentId: contentNodeId,
          prompt: action.description,
          responsePromise: promise,
          response: undefined,
          isRegenerated: false,
          areThoughtsShown: false,
          modelUsed: action.model.name,
        },
        DEFAULT_CONTENT_NODE_SIZE
      );
      get().addNewEdge(contentNodeId, newNode.id);
    },

    getXPositionForDuplicatedPromptNode(promptId) {
      const promptNode = get().getNodeById(promptId);
      if (!promptNode || !isPromptNode(promptNode)) return;

      const sameRowPrompts = get().nodes
        .filter((n) => isPromptNode(n))
        .filter((n) => n.data.prompt === promptNode.data.prompt)
        .filter(
          (n) =>
            Math.abs(n.position.y - promptNode.position.y) < DEFAULT_PROMPT_NODE_SIZE.height
        );

      return sameRowPrompts.length > 0
        ? Math.max(
          ...sameRowPrompts.map(
            (n) =>
              n.position.x +
              (get().getNodeSize(n.id).width || DEFAULT_PROMPT_NODE_SIZE.width))
        )
        : (promptNode.position.x +
          (get().getNodeSize(promptNode.id).width || DEFAULT_PROMPT_NODE_SIZE.width)
        );
    },
  }
});
