import {
  Connection,
  Edge,
  OnConnectStart,
  Viewport,
} from "@xyflow/react";

import {FlowSnapshot} from "../flowSnapshot";
import {StateCreator} from "zustand";

import {EdgeSlice} from "./edgeSlice";
import {ViewportSlice} from "./viewportSlice";
import {
  loadFlow,
  saveFlowInUserStorage,
} from "../flowSaveAndLoad";
import {Model} from "../models/interfaces";
import {
  AppNode,
  isContainerNodeData, isContentNode,
  isContentNodeData,
  isImageResponse,
  isPromptNodeData,
} from "./interfaces";
import {NodeSlice} from "./nodeSlice";
import {GetViewport, SetViewport} from "@xyflow/system";
import {ModelConfiguration, ModelLibrary} from "../models/modelLibrary";
import {
  defaultModelConfigurations,
  XSSizeModelConfiguration,
  emptyModificationParams
} from "../models/defaultParams";
import {CanvasSlice} from "./canvasSlice";
import {initialFlow} from "../../config/initialFlow";

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let savingDelay = 3000;
let isSaving = false;

export type SharedSlice = {
  isOpenModelParamsMenu: boolean;
  modelParamsNodeId: string;
  openModelParamsMenu: (id: string) => void;
  closeModelParamsMenu: () => void;

  selectedModel: Model | undefined;
  setSelectedModel: (model: Model | undefined) => void;

  deleteNodeWithEdges: (id: string) => void;
  deleteNodesFromContainer: (id: string) => void;

  duplicateEdges: (oldNodeId: string, newNodeId: string) => void;
  connectionNodeId: string | undefined;

  onConnectStart: OnConnectStart;
  onConnectEnd: (
    event: MouseEvent | TouchEvent,
    bound: DOMRect | undefined
  ) => void;
  onConnect: (connection: Connection) => Error | void;

  getDirectNodeChildren: (id: string) => AppNode[];
  getDirectNodeAncestors: (id: string) => AppNode[];
  getAllNodeAncestors: (id: string) => AppNode[];

  isThereAggregateNodeAmongChildren: (id: string) => boolean;
  checkCycle: (idFrom: string, idTo: string) => boolean;

  getCurrentState: () => FlowSnapshot;
  setCurrentState: (state: FlowSnapshot) => void;

  loadInitialFlow: () => Promise<Viewport>;
  moveViewportToNewPrompt: (value: number,
                            getViewport: GetViewport,
                            setViewport: SetViewport) => void;

  saveNow: () => Promise<void>;
  scheduleSave: () => void;
};

export const createSharedSlice: StateCreator<
  NodeSlice & EdgeSlice & ViewportSlice & SharedSlice & CanvasSlice,
  [],
  [],
  SharedSlice
> = (set, get) => ({
  // modal window with model parameters
  isOpenModelParamsMenu: false,
  modelParamsNodeId: "",

  openModelParamsMenu(id: string) {
    set({isOpenModelParamsMenu: true, modelParamsNodeId: id});
  },
  closeModelParamsMenu() {
    set({isOpenModelParamsMenu: false, modelParamsNodeId: ""});
    get().setSelectedModel(undefined);
  },

  selectedModel: undefined,
  setSelectedModel(model: Model | undefined) {
    set({selectedModel: model});
  },

  async loadInitialFlow() {
    try {
      let currentCanvasId = get().getCurrentCanvasId();
      let flowToLoad: FlowSnapshot;

      if (currentCanvasId) {
        const snapshot = get().getCanvasSnapshot(currentCanvasId);
        if (snapshot) {
          flowToLoad = snapshot
        } else {
          try {
            flowToLoad = await loadFlow(currentCanvasId);
            get().updateCanvasById(currentCanvasId, {
              snapshotJson: JSON.stringify(flowToLoad)
            });
          } catch (e: any) {
            if (e.message === "FILE_NOT_FOUND") {
              flowToLoad = initialFlow;
              get().updateCanvasById(currentCanvasId, {
                snapshotJson: JSON.stringify(initialFlow)
              });
            } else {
              throw e;
            }
          }
        }
      } else {
        flowToLoad = initialFlow;
      }

      //placing initial node in the center of the canvas when it is initial Flow
      if (flowToLoad.nodes.length === 1 &&
        typeof window !== 'undefined' &&
        window.innerWidth > 0 &&
        window.innerHeight > 0) {
        const node = flowToLoad.nodes[0];
        const isInitialFlowNode = node.id === "randomnode_initial_mdn0wjf8888v2z6kjf8";

        if (isInitialFlowNode) {
          const nodeWidth = node.width || 600;
          const nodeHeight = node.height || 250;
          const zoom = flowToLoad.viewport.zoom || 0.9;
          const viewportX = flowToLoad.viewport.x || 0;
          const viewportY = flowToLoad.viewport.y || 0;

          const currentWindowWidth = window.innerWidth / zoom;
          const currentWindowHeight = window.innerHeight / zoom;
          const nodeX = -viewportX / zoom + currentWindowWidth / 2 - nodeWidth / 2;
          const nodeY = -viewportY / zoom + currentWindowHeight / 2 - nodeHeight / 2;

          flowToLoad.nodes[0] = {
            ...node,
            position: {x: nodeX, y: nodeY}
          };
        }
      }

      const cleanedNodes = flowToLoad.nodes.map((node) => {
        if (isContentNode(node) && isContentNodeData(node.data)) {
          return {
            ...node,
            data: {
              ...node.data,
              responsePromise: undefined,
            },
          };
        }
        return node;
      });

      set({
        nodes: cleanedNodes,
        edges: flowToLoad.edges,
      });
      get().setStoreViewport(flowToLoad.viewport);
      return flowToLoad.viewport;
    } catch (error) {
      console.error("Error loading initial Flow:", error);
      throw error;
    }
  },

  async deleteNodeWithEdges(id) {
    set({
      nodes: get().nodes.filter((node) => node.id !== id),
      edges: get().edges.filter(
        (edge) => edge.source !== id && edge.target !== id
      ),
    });
    console.log(
      `Node with id '${id}' deleted with all incoming and outgoing edges:`
    );
    try {
      const isSaved = await saveFlowInUserStorage(get().getCurrentState(), get().getCurrentCanvasId());
      if (isSaved) {
        console.log("Successfully saved flow in user storage.");
      } else {
        console.error("Error saving flow in user storage");
      }
    } catch (error) {
      console.error("Error saving flow in user storage:", error);
    }
  },

  deleteNodesFromContainer(id) {
    const containerNode = get().getNodeById(id);
    if (!containerNode || !isContainerNodeData(containerNode.data)) {
      return;
    }
    const proposers = containerNode.data?.proposers || [];
    const allNodes = [
      ...proposers,
      ...(containerNode.data?.contentNodes || []),
    ];

    let selectedModels: ModelConfiguration[] = [];
    proposers.forEach((proposerId: string) => {
      const data = get().getNodeData(proposerId);
      if (isPromptNodeData(data) && Array.isArray(data.selectedModels) && data.selectedModels.length > 0) {
        selectedModels.push(data.selectedModels[0]);
      }
    })

    if (selectedModels.length === 0) {
      selectedModels.push(defaultModelConfigurations["text"]);
    }
    get()._changeNodeProperty(containerNode.data.parentPromptId, "selectedModels",
      Array.from(new Map(selectedModels.map(m => [m.name, m])).values()), get().nodes);

    allNodes.forEach((nodeId: string) => {
      get().deleteNodeWithEdges(nodeId);
    });
    get()._changeNodeProperty(containerNode.data.parentPromptId, "containerNodeId", undefined, get().nodes);
  },

  duplicateEdges(oldNodeId: string, newNodeId: string) {
    const incoming = get().edges.filter(e => e.target === oldNodeId);
    const outgoing = get().edges.filter(e => e.source === oldNodeId);

    incoming.forEach(edge => {
      get().addNewEdge(edge.source, newNodeId);
    });

    outgoing.forEach(edge => {
      get().addNewEdge(newNodeId, edge.target);
    });
  },

  connectionNodeId: undefined,

  /**
   * Edge connect handler: add a new edge
   */
  onConnectStart(_, {nodeId}) {
    if (nodeId !== null) {
      set({
        connectionNodeId: nodeId,
      });
    } else {
      console.log(
        `Unsuccsessfull connection attempt: no source node id provided.`
      );
    }
  },

  onConnect(connection: Connection): Error | void {
    if (!connection.source || !connection.target) {
      console.error(
        `Unsuccsessfull connection attempt, no source or target node provided:`,
        connection
      );
      return new Error(
        `Unsuccsessfull connection attempt, no source or target node provided.`
      );
    }
    if (get().checkCycle(connection.source, connection.target)) {
      console.error(
        `Unsuccsessfull connection attempt, cycle detected from ${connection.source} to ${connection.target}.`
      );
      return new Error(
        `Unsuccsessfull connection attempt, cycle detected from ${connection.source} to ${connection.target}.`
      );
    }

    if (
      get()
        .getDirectNodeAncestors(connection.target)
        .filter(
          (node) =>
            isContentNodeData(node.data) && isImageResponse(node.data.response)
        ).length > 0
    ) {
      console.error(
        `Unsuccsessfull connection attempt, target node ${connection.target} already has image response ancestors.`
      );
      return new Error(
        `Unsuccsessfull connection attempt, target node ${connection.target} already has image response ancestors.`
      );
    }
    get().addNewEdge(connection.source, connection.target);
  },

  onConnectEnd(event, bound) {
    if (bound === undefined) {
      return;
    }
    const target = event.target! as HTMLElement;
    if ("clientX" in event) {
      // works only with mouse. TODO: make it work on smartphone
      const connectionNodeId = get().connectionNodeId;
      const currentNode = get().nodes.find(
        (node) => node.id === connectionNodeId
      );
      if (!currentNode || !connectionNodeId || !isContentNode(currentNode)) {
        console.log(`Unsuccsessfull connection attempt.`);
        return;
      }
      if (target.classList.contains("react-flow__pane")) {
        console.log("Connect target is pane, attempt to create a new node.");
        const contentData = currentNode.data;
        const modelFromLibrary = contentData.modelUsed
          ? ModelLibrary.getModelByName(contentData.modelUsed)
          : null;

        const targetNode = get().addPromptNode(
          get().project({
            x: event.clientX - bound.left,
            y: event.clientY - bound.top,
          }),
          {
            isExecuted: false,
            prompt: "",
            selectedModels: modelFromLibrary ?
              [{
                type: modelFromLibrary.type,
                name: modelFromLibrary.name,
                params: emptyModificationParams,
              }]
              : [...XSSizeModelConfiguration["text"]],
            recentModelsList: modelFromLibrary ?
              [{
                value: modelFromLibrary.name,
                priority: 0,
              }]
              : XSSizeModelConfiguration["text"].map((m, index) => ({
                value: m.name,
                priority: index,
              })),
            parentId: [currentNode.id],
          }
        );
        get().addNewEdge(connectionNodeId, targetNode.id);
      }
    }

    set({
      connectionNodeId: undefined,
    });
  },

  getDirectNodeChildren(id) {
    const edgesFrom = get().edges.filter((edge) => edge.source === id);
    let invalidEdge: Edge | undefined;
    const children = edgesFrom.map((edge) => {
      const child = get().nodes.find((node) => node.id === edge.target);
      if (!child) invalidEdge = edge;
      return child;
    });
    if (invalidEdge !== undefined) {
      console.error(
        `There is edge with id ${invalidEdge.id}, which target equal to none of the existing nodes`
      );
      return [];
    }
    return children.filter((node): node is AppNode => node !== undefined);
  },

  getDirectNodeAncestors(id) {
    const edgesTo = get().edges.filter((edge) => edge.target === id);
    let invalidEdge: Edge | undefined;
    const ancestors = edgesTo.map((edge) => {
      const ancestor = get().nodes.find((node) => node.id === edge.source);
      if (!ancestor) invalidEdge = edge;
      return ancestor;
    });
    if (invalidEdge !== undefined) {
      console.error(
        `There is edge with id ${invalidEdge.id}, which source equal to none of the existing nodes`
      );
      return [];
    }
    return ancestors.filter((node): node is AppNode => node !== undefined);
  },

  getAllNodeAncestors(id) {
    const currentNode = get().nodes.find((node) => node.id === id);
    if (!currentNode) {
      console.error("Get all ancestors called for non existant node.");
      return [];
    }
    return get()
      .getDirectNodeAncestors(id)
      .map((anc) => get().getAllNodeAncestors(anc.id))
      .flat()
      .concat([currentNode]);
  },

  isThereAggregateNodeAmongChildren(id) {
    return get()
      .getDirectNodeChildren(id)
      .some((node) => isPromptNodeData(node.data) && node.data.isAggregateNode);
  },

  checkCycle(idFrom, idTo) {
    return (
      get()
        .getAllNodeAncestors(idFrom)
        .find((node) => node.id === idTo) !== undefined
    );
  },

  getCurrentState() {
    return {
      nodes: get().nodes,
      edges: get().edges,
      viewport: get().storeViewport,
    };
  },

  setCurrentState(state) {
    get()._setEdges(state.edges);
    get()._setNodes(state.nodes);
    get().setStoreViewport(state.viewport)
  },

  moveViewportToNewPrompt(
    value,
    getViewport,
    setViewport) {
    const currentViewport = getViewport();
    const screenHeight = window.innerHeight;

    const targetY = -((value * currentViewport.zoom) - screenHeight / 2);
    const newViewport = {
      x: currentViewport.x,
      y: targetY,
      zoom: currentViewport.zoom,
    };
    set({storeViewport: newViewport});
    setViewport(newViewport);
  },

  /**
   * Save current flow state immediately (without delay)
   */
  async saveNow() {
    if (isSaving) return;
    isSaving = true;
    try {
      const snapshot = get().getCurrentState();
      const canvasId = get().getCurrentCanvasId();
      if (canvasId) {
        await saveFlowInUserStorage(snapshot, canvasId);
        get().updateCanvasById(canvasId, {snapshotJson: JSON.stringify(snapshot)});
      }
    } catch (e) {
      console.error("Autosave error:", e);
    } finally {
      isSaving = false;
    }
  },

  /**
   * Schedule saving with delay
   */
  scheduleSave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void get().saveNow();
    }, savingDelay);
  },
});
