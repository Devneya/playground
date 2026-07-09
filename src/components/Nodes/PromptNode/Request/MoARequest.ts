import {ChatCompletionMessageParam} from "openai/resources";
import {singleAgentRequest, singleRequestProps} from "./singleAgentRequest";
import {generateAggregatorSystemPrompt} from "./systemPrompts";
import {XYPosition} from "@xyflow/react";
import {ContentNode, ContentNodeData, PromptNodeData} from "../../../../logic/flowStore/interfaces";

export type MoARequestProps = singleRequestProps & {
  proposersDataAndContext: [
    PromptNodeData,
    string,
    ChatCompletionMessageParam[]
  ][];
  addContentNode: (
    position: XYPosition,
    data: ContentNodeData,
    size?: {
      width: number;
      height: number;
    }
  ) => ContentNode;
  getContentNodePosition: (proposerId: string) => XYPosition;
  getProposerSize: (proposerId: string) => { width: number; height: number };
  changeNodeExecutionStatus: (id: string, isExecuted: boolean) => void;
  addContentNodeToContainer: (contentNodeId: string) => void;
};

export const MoARequest = (props: MoARequestProps): Promise<any> => {
  return new Promise<any>((resolve, reject) => {
    const responseNodes = props.proposersDataAndContext.map(
      ([data, id, context]) => {
        if (!data || !data.selectedModels[0]) {
          console.warn(`Skipping proposer ${id}: invalid model config`);
          return null;
        }
        const safeModelConfig = {
          ...data.selectedModels[0],
          params: data.selectedModels[0]?.params || "{}",
        };
        const newNode = props.addContentNode(
          props.getContentNodePosition(id),
          {
            parentId: id,
            prompt: props.promptNodeData.prompt,
            responsePromise: singleAgentRequest({
              promptNodeData: {
                ...data,
                prompt: props.promptNodeData.prompt,
                selectedModels: [safeModelConfig],
              },
              promptNodeContext: context,
              virtualKey: props.virtualKey,
              areThoughtsShown: true,
            }),
            response: undefined,
            isRegenerated: false,
            areThoughtsShown: true,
            isHidden: false,
            isContained: true,
            MoAContainerId: data.MoAContainerId,
          },
          props.getProposerSize(id)
        );
        props.changeNodeExecutionStatus(id, true);
        return newNode;
      }
    );

    if (responseNodes.length === 0) {
      return reject(new Error("No valid proposers to process."));
    }
    Promise.all(responseNodes.map((node) => node?.data?.responsePromise))
      .then((responses) => {
        const systemPrompt = generateAggregatorSystemPrompt(
          props.promptNodeData.prompt,
          responses.map(
            (response) => response.choices![0].message.content ?? ""
          )
        );
        return singleAgentRequest({...props, systemPrompt});
      })
      .then(resolve)
      .catch(reject);
  });
};
