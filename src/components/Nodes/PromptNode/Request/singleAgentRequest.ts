import {ChatCompletionMessageParam} from "openai/resources";
import {makeMessagesChainForCompletions, ModelLibrary, ModelType} from "../../../../logic/models/modelLibrary";
import {makeMessagesChainForResponses} from "../../../../logic/models/modelLibrary";
import {defaultSystemPrompt, thinkingSystemPrompt} from "./systemPrompts";
import OpenAI from "openai";
import {downloadFile, mimeFromType, mimeToExtension} from "../../../../storage";
import {blobToB64, decodeFileIDFromLiteLLM} from "../../../../logic/utils";
import {PromptNodeData} from "../../../../logic/flowStore/interfaces";
import {uploadFileToOpenAI} from "../../../../logic/models/callbacks";
import {Model, TextModel} from "../../../../logic/models/interfaces";

export type singleRequestProps = {
  promptNodeData: PromptNodeData;
  promptNodeContext: ChatCompletionMessageParam[];
  virtualKey: string;
  areThoughtsShown: boolean;
  systemPrompt?: string;
};
export type AttachmentSource = {
  type: ModelType;
  ref: string;
};

export async function prepareAttachmentForModel(
  client: OpenAI,
  model: Model,
  directAncestorAttachment?: AttachmentSource
): Promise<AttachmentSource | undefined> {
  if (!directAncestorAttachment) return undefined;

  const blob = await downloadFile(directAncestorAttachment.ref);
  if (!(blob instanceof Blob)) {
    console.error("Failed to download attachment:", blob);
    return undefined;
  }

  if (model.makeMessagesChain?.name === makeMessagesChainForResponses.name) {
    const mimeType = mimeFromType(directAncestorAttachment.type);
    const extension = mimeToExtension(mimeType);

    const filename = extension
      ? `attachment.${extension}`
      : "attachment";

    const file = new File([blob], filename, {type: mimeType});

    const uploadedId = await uploadFileToOpenAI(client, file, model as TextModel);
    const fileId = decodeFileIDFromLiteLLM(uploadedId);

    return {
      type: directAncestorAttachment.type,
      ref: fileId,
    };
  }

  const b64String = await blobToB64(blob);
  return {
    type: directAncestorAttachment.type,
    ref: b64String,
  };
}

export const singleAgentRequest = async (
  props: singleRequestProps,
  directAncestorAttachment?: AttachmentSource,
  removeStreamParam: boolean = false
) => {
  const selectedModels = props.promptNodeData.selectedModels ?? [];
  const modelConfig = selectedModels?.[0];
  if (!modelConfig || !modelConfig.name) {
    throw new Error("Invalid or missing model configuration.");
  }
  const model = ModelLibrary.getModelByName(modelConfig.name);
  if (model !== undefined) {
    const client = new OpenAI({
      baseURL: `${import.meta.env.VITE_LITELLM_URL || ""}`,
      apiKey: props.virtualKey,
      maxRetries: 0,
      dangerouslyAllowBrowser: true,
    });
    let promiseFunction;
    switch (model?.type) {
      case "text":
        const modificationParams = getModificationParamsObject(
          modelConfig.params ?? "{}",
          removeStreamParam
        );
        let attachmentInput;
        if (directAncestorAttachment) {
          attachmentInput = await prepareAttachmentForModel(
            client,
            model,
            directAncestorAttachment
          );
        }
        const makeChain = model.makeMessagesChain ?? makeMessagesChainForCompletions;

        const systemPrompt =
          (props.systemPrompt ??
            props.promptNodeData.systemPrompt ??
            defaultSystemPrompt) +
          (props.areThoughtsShown ? thinkingSystemPrompt : "");

        const messages = makeChain(
          props.promptNodeData.prompt,
          props.promptNodeContext,
          systemPrompt,
          attachmentInput
        );

        const requestBody = {
          model: model.name,
          ...modificationParams,
          ...(makeChain.name === makeMessagesChainForResponses.name
            ? {input: messages}
            : {messages})
        };

        promiseFunction = model.requestCallback(client, requestBody);
        break;
      case "image":
        promiseFunction = model.requestCallback(client, {
          ...getModificationParamsObject(modelConfig.params ?? "{}"),
          model: model.name,
          prompt: props.promptNodeData.prompt ?? "",
        });
        break;
      default:
        throw new Error("Unknown model type.");
    }
    return promiseFunction;
  } else throw new Error(`Unknown model: ${modelConfig.name}`);
};

const getModificationParamsObject = (
  params: string,
  removeStreamParam: boolean = false
) => {
  let paramsObject = {} as Record<string, any>;
  try {
    paramsObject = JSON.parse(params);
    if (removeStreamParam) {
      delete paramsObject.stream;
    }
  } catch (error) {
    console.error("Error parsing model parameters:", error);
  }

  return paramsObject;
};
