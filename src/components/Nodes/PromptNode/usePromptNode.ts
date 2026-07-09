import {ChatCompletionMessageParam} from "openai/resources/chat/completions";
import {useCallback, useContext} from "react";
import {
  DEFAULT_CONTAINER_NODE_HEADER_HEIGHT,
  DEFAULT_CONTAINER_NODE_SIZE,
  DEFAULT_CONTENT_NODE_SIZE,
  DEFAULT_IMAGE_CONTENT_NODE_SIZE,
  DEFAULT_MOA_PROMPT_NODE_HEIGHT,
  DEFAULT_PROMPT_NODE_SIZE,
} from "../../../config/nodeSize";
import useFlowStore from "../../../logic/flowStore/flowStore";
import {
  AppNode,
  AppNodeData,
  ContentNode,
  ContentNodeData,
  ImageResponse,
  isContainerNode,
  isContentNode,
  isContentNodeData,
  isImageResponse,
  isPdfResponse,
  isPromptNode,
  isPromptNodeData,
  isTextResponse,
  PromptNodeData,
  TextResponse,
} from "../../../logic/flowStore/interfaces";
import {useReactFlow, XYPosition} from "@xyflow/react";
import {useSnackbar} from "notistack";
import {VirtualKeyContext} from "../../../context/supabaseContext";
import {ModelConfiguration} from "../../../logic/models/modelLibrary";
import {defaultModelConfigurations} from "../../../logic/models/defaultParams";
import {animateViewport} from "../../../logic/useViewport";
import {AttachmentSource} from "./Request/singleAgentRequest";

export default function usePromptNode() {
  const getDirectNodeAncestors = useFlowStore.use.getDirectNodeAncestors();
  const getDirectNodeChildren = useFlowStore.use.getDirectNodeChildren();
  const getNodeChildren = useFlowStore.use.getNodeChildren();
  const getNodeById = useFlowStore.use.getNodeById();

  const buildContextSync = useCallback(
    (id: string, model?: string): ChatCompletionMessageParam[] => {
      const visited = new Set<string>();
      let queue: string[] = [id];
      const buildMessagesFromContent = (node: ContentNode): ChatCompletionMessageParam[] => {
        return [
          {
            role: "user",
            content: node.data.prompt,
          },
          {
            role: "assistant",
            content: (node.data.response as TextResponse).text,
          },
        ];
      };
      const findModelResponseInPromptChildren = (
        promptId: string,
        model: string
      ): ContentNode | null => {
        const children = getNodeChildren(promptId)
          .map(getNodeById)
          .filter((node): node is ContentNode => isContentNode(node))
          .filter(
            (node) =>
              isTextResponse(node.data.response) &&
              node.data.modelUsed === model
          );

        return children.at(-1) ?? null;
      };

      while (queue.length > 0) {
        const nextQueue: string[] = [];
        for (const nodeId of queue) {
          if (visited.has(nodeId)) {
            continue;
          }
          visited.add(nodeId);
          const parents = getDirectNodeAncestors(nodeId);
          if (!parents.length && model) {
            const modelChild = findModelResponseInPromptChildren(nodeId, model);
            return modelChild ? buildMessagesFromContent(modelChild) : [];
          }

          const nodeData = getNodeData(nodeId);
          if (isPromptNodeData(nodeData)) {
            const modelChild = findModelResponseInPromptChildren(nodeId, nodeData.selectedModels[0].name);
            if (modelChild) {
              return buildMessagesFromContent(modelChild);
            }
          }

          for (const parent of parents) {
            if (isContentNode(parent) && isTextResponse(parent.data.response)) {
              if (!model) {
                return buildMessagesFromContent(parent);
              }
              const modelChild = findModelResponseInPromptChildren(
                nodeId,
                model
              );
              return buildMessagesFromContent(modelChild ?? parent);
            }

            if (isPromptNode(parent)) {
              if (model) {
                const modelChild = findModelResponseInPromptChildren(
                  nodeId,
                  model
                );
                if (modelChild) {
                  return buildMessagesFromContent(modelChild);
                }
              }
              nextQueue.push(parent.id);
            }
          }
        }
        queue = nextQueue;
      }
      return [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getNodeChildren, getNodeById, getDirectNodeAncestors]
  );

  // // Async version: supports text and image responses
  // const buildContextAsync = useCallback(
  //   async (id: string): Promise<ChatCompletionMessageParam[]> => {
  //     const nodes = getDirectNodeAncestors(id).filter(
  //       (node): node is ContentNode => isContentNode(node)
  //     );
  //     const contextArrays = await Promise.all(
  //       nodes.map(async (node): Promise<ChatCompletionMessageParam[]> => {
  //         if (isTextResponse(node.data.response)) {
  //           return [
  //             {
  //               role: "user",
  //               content: node.data.prompt,
  //             },
  //             {
  //               role: "assistant",
  //               content: (node.data.response as TextResponse).text,
  //             },
  //           ];
  //         } else if (
  //           node.data.response &&
  //           typeof node.data.response === "object" &&
  //           isImageResponse(node.data.response)
  //         ) {
  //           const imageBlob = await downloadFile(node.data.response.path);
  //           if (imageBlob instanceof Blob) {
  //             const b64 = await blobToB64(imageBlob);
  //             return [
  //               {
  //                 role: "user",
  //                 content: node.data.prompt,
  //               },
  //               {
  //                 role: "assistant",
  //                 content: `[image:${b64}]`,
  //               },
  //             ];
  //           } else {
  //             return [];
  //           }
  //         }
  //         return [];
  //       })
  //     );
  //     return contextArrays.flat();
  //   },
  //   [getDirectNodeAncestors]
  // );

  const addPromptNode = useFlowStore.use.addPromptNode();
  const getNodeCopyById = useFlowStore.use.getNodeCopyById();
  const getNodeSize = useFlowStore.use.getNodeSize();
  const changeNodeStyle = useFlowStore.use.changeNodeStyle();
  const getNodeData = useFlowStore.use.getNodeData();
  const prepareAndMakeRequest = useFlowStore.use.prepareAndMakeRequest();
  const removeModelFromNode = useFlowStore.use.removeModelFromNode();
  const addModelToNode = useFlowStore.use.addModelToNode();
  const duplicateEdges = useFlowStore.use.duplicateEdges();
  const getXPositionForDuplicatedPromptNode =
    useFlowStore.use.getXPositionForDuplicatedPromptNode();
  const createAndGetContainerNodeForPromptNode =
    useFlowStore.use.createAndGetContainerNodeForPromptNode();
  const addProposerToContainer = useFlowStore.use.addProposerToContainer();
  const getContainerProposersNodes =
    useFlowStore.use.getContainerProposersNodes();
  const getContainerContentNodes = useFlowStore.use.getContainerContentNodes();
  const getLastNodeOnSide = useFlowStore.use.getLastNodeOnSide();
  const markPromptNodeAsAggregateNode =
    useFlowStore.use.markPromptNodeAsAggregateNode();
  const getInteractionModeFromContainer =
    useFlowStore.use.getInteractionModeFromContainer();
  const virtualKey = useContext(VirtualKeyContext);
  const {enqueueSnackbar} = useSnackbar();
  const {setViewport, getViewport} = useReactFlow();
  const containerPadding = 8;
  const gapBetweenNodes = 50;

  const duplicateNode = useCallback(
    (id: string) => {
      const node = getNodeCopyById(id);
      if (!node) {
        console.error(
          `Error on duplicating node: Node with id '${id}' not found.`
        );
        return;
      }
      try {
        if (!isPromptNodeData(node.data)) return;
        const newNode = addPromptNode(
          {
            x: getXPositionForDuplicatedPromptNode(id) ?? (node.position.x + (node.width || DEFAULT_PROMPT_NODE_SIZE.width)),
            y: node.position.y,
          },
          {
            ...node.data,
            isExecuted: false,
            isAggregateNode: false,
            MoAContainerId: undefined,
            interactionMode: undefined,
            role: undefined,
          },
          {
            width: node.style?.width as number,
            height: node.style?.height as number,
          }
        );
        duplicateEdges(id, newNode.id);
      } catch (error) {
        console.error("Error on duplicating node:", error);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getNodeCopyById, addPromptNode, duplicateEdges, getNodeChildren]
  );

  function isAggregateNodeData(data: AppNodeData): data is PromptNodeData {
    return "isAggregateNode" in data;
  }

  const copyAndAggregate = useCallback((id: string) => {
    const node = getNodeById(id);
    if (!node) return;

    const isFromContainer = isContainerNode(node);
    const currentNodeId = isFromContainer ? node.data.parentPromptId : id;
    const containerX = node.position.x - (node.width || DEFAULT_PROMPT_NODE_SIZE.width) - 50;
    const containerY = node.position.y;
    const containerNodeId = createAndGetContainerNodeForPromptNode(
      currentNodeId,
      {
        x: containerX,
        y: containerY,
      }
    );
    const possibleAggregateNode = getDirectNodeChildren(containerNodeId).find(
      (node) => {
        return isAggregateNodeData(node.data) && node.data.isAggregateNode;
      }
    );
    if (!possibleAggregateNode) {
      markPromptNodeAsAggregateNode(currentNodeId, true);
    }
    const containerNode = getNodeById(containerNodeId);
    const interactionMode = getInteractionModeFromContainer(containerNodeId);
    if (!containerNode) return;

    const copiedNode = getNodeCopyById(currentNodeId);
    if (!copiedNode) {
      console.error(
        `Error on creating MoA: Node with id '${currentNodeId}' not found.`
      );
      return;
    }

    const createContainedPromptNode = (modelConfig: ModelConfiguration) => {
      const proposerNodes = getContainerProposersNodes(containerNodeId);
      const contentNodes = getContainerContentNodes(containerNodeId);
      const allNodes = [...(proposerNodes || []), ...(contentNodes || [])];
      const lowestY = Math.max(...allNodes.map((n) => n.position.y));
      const posY = proposerNodes.length > 0
        ? lowestY + ((getNodeSize(allNodes[allNodes.length - 1].id).height as number) || DEFAULT_MOA_PROMPT_NODE_HEIGHT)
        : containerNode.position.y + DEFAULT_CONTAINER_NODE_HEADER_HEIGHT;

      const newNode = addPromptNode(
        {
          x: containerNode.position.x + containerPadding,
          y: posY,
        },
        {
          ...copiedNode.data,
          prompt: "",
          isExecuted: false,
          isAggregateNode: false,
          MoAContainerId: containerNodeId,
          isContained: true,
          interactionMode: interactionMode || "Parallel",
          role: "assistant",
          selectedModels: [modelConfig],
          areThoughtsShown: modelConfig?.areThoughtsShown ?? copiedNode.data.areThoughtsShown,
        } as PromptNodeData,
        {
          width: DEFAULT_CONTAINER_NODE_SIZE.width - 16,
          height: copiedNode.height || DEFAULT_MOA_PROMPT_NODE_HEIGHT,
        }
      );
      changeNodeStyle(newNode.id, {
        height: DEFAULT_MOA_PROMPT_NODE_HEIGHT,
        minHeight: DEFAULT_MOA_PROMPT_NODE_HEIGHT,
      });

      addProposerToContainer(containerNodeId, newNode.id);
    };

    try {
      if (!isPromptNode(copiedNode)) return;

      const hasPromptNodeTextModels = copiedNode.data.selectedModels?.some((m) => m?.type === "text");
      if (isFromContainer) {
        createContainedPromptNode(defaultModelConfigurations["text"]);
      } else {
        [...(!hasPromptNodeTextModels ? [defaultModelConfigurations["text"]] : []), ...(copiedNode.data.selectedModels ?? [])].forEach((model) => {

          if (!model) return;
          if (model.type === "text") {
            if (!hasPromptNodeTextModels) addModelToNode(copiedNode.id, defaultModelConfigurations["text"]);
            createContainedPromptNode(model);
          } else {
            removeModelFromNode(copiedNode.id, model.name);
          }
        });
      }
    } catch (error) {
      console.error("Error on creating MoA:", error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  type ExtraBox = {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /**
   * Computes the coordinates of a box that contains all given nodes.
   */
  const computeBoundingBox = useCallback((nodeIds: string[], extraBoxes?: ExtraBox[]) => {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const id of nodeIds) {
      const node = getNodeById(id);
      const size = getNodeSize(id);
      if (!node || !size) continue;

      const x1 = node.position.x;
      const y1 = node.position.y;
      const x2 = x1 + (size?.width || DEFAULT_CONTENT_NODE_SIZE.width);
      const y2 = y1 + (size?.height || DEFAULT_CONTENT_NODE_SIZE.height);

      minX = Math.min(minX, x1);
      minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x2);
      maxY = Math.max(maxY, y2);
    }

    if (extraBoxes) {
      for (const box of extraBoxes) {
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
      }
    }
    return {minX, minY, maxX, maxY};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Computes the position for a new child when there is only one model.
   */
  const computeNewSingleChildPosition = useCallback((
    parentPos: XYPosition,
    parentHeight: number,
    defaultChildWidth: number,
    childIds: string[],
  ): XYPosition => {
    const baseX = parentPos.x;
    const baseY = parentPos.y + parentHeight + gapBetweenNodes;
    if (childIds.length === 0) {
      return {x: baseX, y: baseY};
    }
    const childrenBelow = childIds
      .map(id => getNodeById(id))
      .filter((n): n is AppNode => !!n)
      .filter(n => n.position.y >= baseY);

    if (childrenBelow.length === 0) {
      return {x: baseX, y: baseY};
    }
    const leftChildren = childrenBelow.filter(
      c => c.position.x < parentPos.x
    );

    const rightChildren = childrenBelow.filter(
      c => c.position.x >= parentPos.x
    );

    const direction = childIds.length % 2 === 0 ? -1 : 1;
    if (direction === 1) {
      const rightmost = rightChildren.length
        ? Math.max(...rightChildren.map(c => c.position.x))
        : leftChildren.length
          ? Math.max(...leftChildren.map(c => c.position.x))
          : parentPos.x;
      return {
        x: rightmost + defaultChildWidth,
        y: baseY
      };
    } else {
      const leftmost = leftChildren.length
        ? Math.min(...leftChildren.map(c => c.position.x))
        : rightChildren.length
          ? Math.min(...rightChildren.map(c => c.position.x))
          : parentPos.x;
      return {
        x: leftmost - defaultChildWidth,
        y: baseY
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Computes the position for a new child node around the parent in a cyclic direction.
   */
  const computeNewChildPosition = useCallback((
    parentPos: XYPosition,
    parentId: string,
    parentSize: { width: number; height: number },
    childSize: { width: number; height: number },
    childIds: string[],
  ): XYPosition => {

    const directions = [
      "bottom",
      "right",
      "left",
      "top"
    ];

    const dir = directions[childIds.length % 4];
    const lastNodeId = getLastNodeOnSide(childIds, parentId, dir);

    let lastNodeSize: { width: number | null | undefined; height: number | null | undefined };
    let lastNode: AppNode | undefined;
    if (lastNodeId) {
      lastNode = getNodeById(lastNodeId);
      lastNodeSize = getNodeSize(lastNodeId);
    } else { //no nodes on this side
      lastNode = getNodeById(parentId);
      lastNodeSize = getNodeSize(parentId);
    }

    const cx = lastNode?.position.x ?? parentPos.x;
    const cy = (lastNode?.position.y ?? parentPos.y);
    switch (dir) {
      case "bottom":
        return {
          x: cx,
          y: cy + (lastNodeSize.height ?? parentSize.height) + gapBetweenNodes
        };
      case "right":
        return {
          x: cx + (lastNodeSize.width ?? parentSize.width) + gapBetweenNodes,
          y: cy
            + ((lastNodeSize.height ?? parentSize.height)) / 2
            - childSize.height / 2
        };
      case "left":
        return {
          x: cx - childSize.width - gapBetweenNodes,
          y: cy + ((lastNodeSize.height ?? parentSize.height) - childSize.height) / 2
        };
      case "top":
        return {
          x: cx,
          y: cy - childSize.height - gapBetweenNodes
        };
      default: //bottom
        return {
          x: cx,
          y: cy + (lastNodeSize.height ?? parentSize.height) + gapBetweenNodes
        };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /**
   * Returns the position for a new content node based on prompt node model count.
   */
  const getNewContentNodePosition = useCallback((promptNodeId: string, childType: string): XYPosition => {
      const promptNode = getNodeById(promptNodeId);
      if (!promptNode) return {x: 0, y: 0};
      const nodeSize = getNodeSize(promptNodeId);
      const children = getNodeChildren(promptNodeId);
      if (isPromptNode(promptNode)) {
        if (promptNode.data.selectedModels.length === 1) {
          return computeNewSingleChildPosition(
            promptNode.position,
            nodeSize.height ?? DEFAULT_PROMPT_NODE_SIZE.height,
            DEFAULT_CONTENT_NODE_SIZE.width,
            children
          )
        } else {
          return computeNewChildPosition(
            promptNode.position,
            promptNodeId,
            {
              width: nodeSize.width ?? DEFAULT_PROMPT_NODE_SIZE.width,
              height: nodeSize.height ?? DEFAULT_PROMPT_NODE_SIZE.height,
            },
            childType === "text" ? DEFAULT_CONTENT_NODE_SIZE : DEFAULT_IMAGE_CONTENT_NODE_SIZE,
            children
          );
        }
      } else {
        return computeNewSingleChildPosition(
          promptNode.position,
          nodeSize.height ?? DEFAULT_PROMPT_NODE_SIZE.height,
          DEFAULT_CONTENT_NODE_SIZE.width,
          children
        )
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getNodeById, getNodeSize, getNodeChildren]
  );

  /**
   * Adjusts viewport position and zoom to fit request children nodes.
   */
  const autoViewForRequest = useCallback((id: string, isShort?: boolean) => {
    const children = getNodeChildren(id);
    if (children.length === 0) {
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const rootNode = getNodeById(id);
    if (!rootNode) return;

    const rootData = rootNode.data;
    const isPromptRoot = isPromptNodeData(rootData);
    const isContentRoot = isContentNodeData(rootData);

    const isSingleModel = isPromptRoot && rootData.selectedModels.length === 1;

    let extraBoxes: ExtraBox[] = [];
    const rootSize = getNodeSize(id);

    extraBoxes.push({
      x: rootNode.position.x,
      y: rootNode.position.y,
      width: (rootSize.width ?? (isPromptRoot ? DEFAULT_PROMPT_NODE_SIZE.width : DEFAULT_CONTENT_NODE_SIZE.width)),
      height: (rootSize.height ?? (isPromptRoot ? DEFAULT_PROMPT_NODE_SIZE.height : DEFAULT_CONTENT_NODE_SIZE.height)),
    });

    if (isPromptRoot && rootData.MoAContainerId) {
      const moaNode = getNodeById(rootData.MoAContainerId);
      const moaSize = getNodeSize(rootData.MoAContainerId);

      if (moaNode && moaSize) {
        extraBoxes.push({
          x: moaNode.position.x,
          y: moaNode.position.y,
          width: moaSize.width ?? DEFAULT_CONTAINER_NODE_SIZE.width,
          height: moaSize.height ?? DEFAULT_CONTAINER_NODE_SIZE.height,
        });
      }
    }

    if (isSingleModel || isContentRoot) {
      const lastChildId = children[children.length - 1];
      const lastChild = getNodeById(lastChildId);
      const lastChildSize = getNodeSize(lastChildId);

      if (lastChild && lastChildSize) {
        extraBoxes.push({
          x: lastChild.position.x,
          y:
            lastChild.position.y +
            (lastChildSize.height ?? DEFAULT_CONTENT_NODE_SIZE.height) +
            gapBetweenNodes,
          width: DEFAULT_PROMPT_NODE_SIZE.width,
          height: DEFAULT_PROMPT_NODE_SIZE.height,
        });
      }
    }
    let box = computeBoundingBox(children, extraBoxes);
    const padding = 46;
    const boxWidth = Math.max(1, box.maxX - box.minX);
    const boxHeight = Math.max(1, box.maxY - box.minY);
    const availableW = Math.max(50, vw - 2 * padding);
    const availableH = Math.max(50, vh - 2 * padding);

    let targetZoom = Math.min(
      availableW / boxWidth,
      availableH / boxHeight
    );
    targetZoom = Math.max(0.2, Math.min(targetZoom, 2));
    const boxCenterX = (box.minX + box.maxX) / 2;
    const boxCenterY = (box.minY + box.maxY) / 2;
    const targetX = vw / 2 - boxCenterX * targetZoom;
    const targetY = vh / 2 - boxCenterY * targetZoom;

    animateViewport(getViewport, setViewport, targetX, targetY, targetZoom, isShort ? 800 : undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getImagePathFromAncestor = useCallback(
    (id: string): string | undefined => {
      const imageNode = getDirectNodeAncestors(id).find(
        (node) =>
          isContentNodeData(node.data) && isImageResponse(node.data.response)
      );
      if (!imageNode) return undefined;
      return ((imageNode.data as ContentNodeData).response as ImageResponse)
        .path;
    },
    [getDirectNodeAncestors]
  );

  const getAncestorAttachment = useCallback(
    (id: string): AttachmentSource | undefined => {
      const node = getDirectNodeAncestors(id)
        .find(
          node =>
            isContentNodeData(node.data) &&
            node.data.response &&
            (isImageResponse(node.data.response) || isPdfResponse(node.data.response))
        );
      if (!node || !isContentNode(node) || isTextResponse(node.data.response)) {
        return undefined;
      }
      const resp = node.data.response;
      if (!resp) {
        return undefined;
      }
      return {
        type: resp.type,
        ref: resp.path,
      };
    },
    [getDirectNodeAncestors]
  );

  const getProposersDataAndContext = useCallback(
    (promptNodeId: string): [PromptNodeData, string, ChatCompletionMessageParam[]][] => {
      const node = getNodeById(promptNodeId);
      if (!node || !isPromptNodeData(node.data)) return [];

      const data = node.data;
      if (!data.isAggregateNode) return [];

      const sourceNodes = data.MoAContainerId
        ? getContainerProposersNodes(data.MoAContainerId)
        : getDirectNodeAncestors(promptNodeId);

      return sourceNodes.map((n) => {
        const d = getNodeData(n.id) as PromptNodeData;
        const context = buildContextSync(n.id);
        return [d, n.id, context];
      });
    },
    [getNodeById, getContainerProposersNodes, getDirectNodeAncestors, buildContextSync, getNodeData]
  );

  const triggerPromptRequest = useCallback(
    (promptNodeId: string, isRegenerated: boolean = false, modelUsed?: string) => {
      prepareAndMakeRequest(
        promptNodeId,
        virtualKey,
        enqueueSnackbar,
        buildContextSync,
        getProposersDataAndContext,
        getNewContentNodePosition,
        getAncestorAttachment,
        isRegenerated,
        modelUsed
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []
  );

  return {
    buildContextSync,
    duplicateNode,
    copyAndAggregate,
    getProposersDataAndContext,
    autoViewForRequest,
    computeNewChildPosition,
    computeNewSingleChildPosition,
    getNewContentNodePosition,
    getImagePathFromAncestor,
    triggerPromptRequest,
    computeBoundingBox
  };
}
