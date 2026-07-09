import {ChatCompletionMessageParam} from "openai/resources/chat/completions";
import models from "./models";
import {Model, Provider} from "./interfaces";
import {AttachmentSource} from "../../components/Nodes/PromptNode/Request/singleAgentRequest";
import {mimeFromType} from "../../storage";
import {systemPromptForVision} from "../../components/Nodes/PromptNode/Request/systemPrompts";

// Define the types of models supported
export type ModelType = "text" | "image" | "audio" | "pdf";
export const ModelTypeList: ModelType[] = ["text", "image"];

// Interface for a model configuration
export interface ModelConfiguration {
  type: ModelType;
  name: string;
  params: string; // JSON object to store user-defined parameters
  areThoughtsShown?: boolean;
}

/**
 * Filters the list of models based on a query string.
 * @param query - The search query.
 * @param models - The list of models to filter.
 * @returns A filtered list of models matching the query.
 */
export function getFilteredModels(query: string, models: Model[]): Model[] {
  return models.filter((model) =>
    model.name.toLowerCase().includes(query.toLowerCase())
  );
}

// Initialize the model library

/**
 * A wrapper class for interacting with the model library.
 */
export class ModelLibrary {
  static modelList: Model[] = models;

  /**
   * Retrieves a model by its name.
   * @param name - The name of the model.
   * @returns The model object or undefined if not found.
   */
  static getModelByName(name: string): Model | undefined {
    return ModelLibrary.modelList.find((model) => model.name === name);
  }

  /**
   * Retrieves models by their type (e.g., "text" or "image").
   * @param type - The type of models to retrieve.
   * @returns A list of models matching the specified type.
   */
  static getModelsByType(type: ModelType): Model[] {
    return ModelLibrary.modelList.filter((model) => model.type === type);
  }

  /**
   * Groups models by their provider for a specific type.
   * @param type - The type of models to group.
   * @returns A map where the key is the provider and the value is a list of models.
   */
  static getProviderGroupsByType(type: ModelType): Map<Provider, Model[]> {
    const groups = new Map<Provider, Model[]>();
    ModelLibrary.getModelsByType(type).forEach((model) => {
      const modelProvider = model.provider;
      if (modelProvider) {
        if (groups.has(modelProvider)) {
          groups.get(modelProvider)?.push(model);
        } else {
          groups.set(modelProvider, [model]);
        }
      }
    });

    return groups;
  }
}

/**
 * Constructs a message chain for a chat completion request. Supports text, images and PDF attachments.
 * @param prompt - The user's input prompt.
 * @param context - The conversation context (previous messages).
 * @param systemPrompt - The system's initial prompt.
 * @param attachment - Optional attachment (image or pdf).
 * @returns A complete message chain for the chat completion request.
 */
export function makeMessagesChainForCompletions(
  prompt: string,
  context: ChatCompletionMessageParam[],
  systemPrompt: string,
  attachment?: AttachmentSource,
): ChatCompletionMessageParam[] {
  const content: any[] = [
    {type: "text", text: prompt},
  ];

  if (attachment) {
    const mime = mimeFromType(attachment.type);
    if (attachment.type === "pdf") {
      content.push({
        type: "file",
        file: {
          filename: "document.pdf",
          file_data: `data:${mime};base64,${attachment.ref}`,
        },
      });
    } else {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${attachment.ref}`,
        },
      });
    }
  }

  const chain: ChatCompletionMessageParam[] = [
    {role: "system", content: systemPrompt},
    ...context,
    {role: "user", content},
  ];
  console.log(`Final message chain to ChatGPT:`, chain);
  return chain;
}

/**
 * Constructs a message chain for a Responses API request.
 * Supports text, images and file (PDF) attachments via file_id references.
 *
 * @param prompt - The user's input prompt.
 * @param context - The conversation context (previous messages).
 * @param systemPrompt - The system's initial prompt.
 * @param attachment - Optional attachment (image or pdf).
 * @returns A complete message chain for the Responses API request.
 */
export function makeMessagesChainForResponses(
  prompt: string,
  context: ChatCompletionMessageParam[],
  systemPrompt: string,
  attachment?: AttachmentSource,
) {
  const content: any[] = [{type: "input_text", text: prompt}];

  if (attachment) {
    if (attachment.type === "image") {
      content.push({
        type: "input_image",
        file_id: attachment.ref
      });
    } else {
      content.push({type: "input_file", file_id: attachment.ref});
    }
  }

  return [
    {role: "system", content: systemPrompt},
    ...context,
    {role: "user", content},
  ];
}

/**
 * Creates a chain of messages for Vision request
 */
export function makeMessagesChainForPDF(
  pagesBase64: string[],
): ChatCompletionMessageParam[] {
  const userPrompt = "Extract all text from the attached PDF document pages.";
  const content: any[] = [{type: "text", text: userPrompt}];

  for (let i = 0; i < pagesBase64.length; i++) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${pagesBase64[i]}`,
        detail: "low"
      },
    });
  }

  const chain: ChatCompletionMessageParam[] = [
    {role: "system", content: systemPromptForVision},
    {role: "user", content},
  ];

  return chain;
}