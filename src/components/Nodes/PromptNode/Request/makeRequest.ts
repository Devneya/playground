import { EnqueueSnackbar } from "notistack";
import { ChatCompletionMessageParam } from "openai/resources";
import { XYPosition } from "@xyflow/react";
import { FloatingEdge } from "../../../../logic/flowStore/edgeSlice";
import {
  ContentNode,
  ContentNodeData,
  PromptNodeData,
} from "../../../../logic/flowStore/interfaces";

import { MoARequest } from "./MoARequest";
import { AttachmentSource, singleAgentRequest, singleRequestProps } from "./singleAgentRequest";
import {
  MoASequentialRequest,
  MoASequentialRequestWithRoles,
} from "./MoASequentialRequest";
import {
  DEFAULT_CONTENT_NODE_SIZE,
  DEFAULT_IMAGE_CONTENT_NODE_SIZE, NodeSize,
} from "../../../../config/nodeSize";
import { ModelConfiguration } from "../../../../logic/models/modelLibrary";

export type makeRequestProps = {
  promptNodeData: PromptNodeData;
  promptNodeId: string;
  virtualKey: string | null;
  enqueueSnackbar: EnqueueSnackbar;
  buildContext: (id: string, model?: string) => ChatCompletionMessageParam[];
  addNewEdge: (fromId: string, toId: string) => FloatingEdge | undefined;
  addContentNode: (
    position: XYPosition,
    data: ContentNodeData,
    size?: {
      width: number;
      height: number;
    }
  ) => ContentNode;
  changeNodeExecutionStatus: (id: string, isExecuted: boolean) => void;
  directAncestorAttachment?: AttachmentSource;
  // only for MoA request:
  proposersDataAndContext?: [
    PromptNodeData,
    string,
    ChatCompletionMessageParam[]
  ][];
  getContentNodePosition?: (proposerId: string) => XYPosition;
  getProposerSize: (proposerId: string) => { width: number; height: number };
  changeAreThoughtsShown?: (id: string, newValue: boolean) => void;
  addContentNodeToContainer?: (contentNodeId: string) => void;
  getProposerRoles?: (containerNodeId: string) => string[];
  isFromPromptContainer?: boolean;
  linkContentNodeToSiblingOrParent?: (id: string) => void;
  changeNodeSelectedModels?: (id: string, selectedModels: ModelConfiguration[]) => void;
};

const createContentNode = (
  props: makeRequestProps & {
    newContentNodePosition: (promptNodeId: string, childType: string) => XYPosition;
    isRegenerated?: boolean;
  },
  responsePromise: Promise<any> | undefined,
  areThoughtsShown: boolean,
  size: NodeSize,
  modelConfig?: ModelConfiguration
) => {

  const pos = props.newContentNodePosition(props.promptNodeId, modelConfig?.type || "text");
  const newNode = props.addContentNode(
    pos,
    {
      parentId: props.promptNodeId,
      prompt: props.promptNodeData.prompt,
      responsePromise,
      response: undefined,
      isRegenerated: props.isRegenerated,
      areThoughtsShown,
      ...(modelConfig && { modelUsed: modelConfig.name }),
    },
    size
  );
  if (props.isFromPromptContainer) {
    if (props.linkContentNodeToSiblingOrParent) {
      props.linkContentNodeToSiblingOrParent(newNode.id);
    }
  } else {
    props.addNewEdge(props.promptNodeId, newNode.id);
  }
  props.changeNodeExecutionStatus(props.promptNodeId, true);
};

const processRequest = async (
  props: makeRequestProps & {
    newContentNodePosition: (promptNodeId: string, childType: string) => XYPosition,
    isRegenerated?: boolean;
  }
) => {
  try {
    const { promptNodeData } = props;

    const selectedModels = promptNodeData.selectedModels ?? [];
    if (selectedModels.length === 0) {
      props.enqueueSnackbar("No models selected for request.", { variant: "warning" });
      return;
    }

    const isMultiModel = selectedModels.length > 1;

    if (promptNodeData.MoAContainerId && props.changeAreThoughtsShown) {
      props.changeAreThoughtsShown(promptNodeData.MoAContainerId, true);
    }

    if (!props.promptNodeData.MoAContainerId) {
      for (const modelConfig of selectedModels) {
        //for single child: usual context through ancestors, for multiple children: context of only the current model
        const promptContext = props.buildContext(props.promptNodeId,
          isMultiModel ? modelConfig.name : undefined);
        if (!modelConfig || !modelConfig.name || !modelConfig.type) {
          continue;
        }

        const requestData: singleRequestProps = {
          promptNodeData: {
            ...promptNodeData,
            selectedModels: [modelConfig],
          },
          promptNodeContext: promptContext,
          virtualKey: props.virtualKey!,
          areThoughtsShown: !!modelConfig.areThoughtsShown,
        };

        const promiseFunction =
          (modelConfig.type === "text" && props.directAncestorAttachment !== undefined)
            ? singleAgentRequest(requestData, props.directAncestorAttachment)
            : singleAgentRequest(requestData);

        createContentNode(props, promiseFunction, requestData.areThoughtsShown,
          (modelConfig?.type === "image" ? DEFAULT_IMAGE_CONTENT_NODE_SIZE : DEFAULT_CONTENT_NODE_SIZE),
          isMultiModel ? modelConfig : (props.isRegenerated ? modelConfig : undefined)
        );
      }
    } else {
      const promptContext = props.buildContext(props.promptNodeId);
      const requestData: singleRequestProps = {
        promptNodeData: { ...promptNodeData, selectedModels },
        promptNodeContext: promptContext,
        virtualKey: props.virtualKey!,
        areThoughtsShown: !!props.promptNodeData.areThoughtsShown,
      };
      const commonMoAProps = {
        ...requestData,
        proposersDataAndContext: props.proposersDataAndContext!,
        addContentNode: props.addContentNode,
        getContentNodePosition: props.getContentNodePosition!,
        getProposerSize: props.getProposerSize,
        changeNodeExecutionStatus: props.changeNodeExecutionStatus,
        addContentNodeToContainer: props.addContentNodeToContainer!,
      };
      const interactionMode = props.promptNodeData.interactionMode || "Parallel";
      let promiseFunction;
      if (interactionMode === "Sequential" && props.getProposerRoles) {
        const allRoles = props.getProposerRoles(
          props.promptNodeData.MoAContainerId
        );
        promiseFunction = allRoles.some((role) => role !== "assistant")
          ? MoASequentialRequestWithRoles({
            ...commonMoAProps,
            requestData,
            allRoles,
          })
          : MoASequentialRequest(commonMoAProps);
      } else if (interactionMode === "Parallel") {
        promiseFunction = MoARequest(commonMoAProps);
      } else {
        promiseFunction = singleAgentRequest(requestData);
      }
      createContentNode(props, promiseFunction, requestData.areThoughtsShown, DEFAULT_CONTENT_NODE_SIZE);
    }
  } catch (error: any) {
    props.enqueueSnackbar(error.toString(), { variant: "error" });
  }
};

export const makeRequest = (
  props: makeRequestProps & {
    newContentNodePosition: (promptNodeId: string, childType: string) => XYPosition,
    isRegenerated?: boolean;
  }
) => {
  if (props.virtualKey === null) {
    props.enqueueSnackbar("Unknown virtual key.", { variant: "error" });
    return;
  }
  processRequest(props);
};
