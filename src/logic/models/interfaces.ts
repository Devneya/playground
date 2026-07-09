import OpenAI from "openai";
import { APIPromise, RequestOptions } from "openai/core";
import {
  ChatCompletion,
  ChatCompletionChunk,
  ImageGenerateParams,
  ImagesResponse,
} from "openai/resources";
import { ChatCompletionCreateParamsBase } from "openai/resources/chat/completions";
import { Stream } from "openai/streaming";

type Mode = "chat" | "image_generation" | "audio" | "video" | "transcription" | "ocr";

// Main interface
interface ModelBase {
  name: string;
  mode: Mode;
  litellm_provider: string; // Optional for models not using Litellm
  provider?: Provider;
  params: string;
  requestCallback: Function;
  makeMessagesChain?: Function;
}

export interface TextModel extends ModelBase {
  mode: "chat";
  type: "text";
}

export interface ImageModel extends ModelBase {
  mode: "image_generation";
  type: "image";
}

export interface AudioModel extends ModelBase {
  mode: "transcription";
  type: "audio";
}

export interface PdfModel extends ModelBase {
  mode: "ocr";
  type: "pdf";
}

export type Model = TextModel | ImageModel | AudioModel | PdfModel;

export interface BaseModelInterface {
}

export interface TextModelInterface extends BaseModelInterface {
  type: "text";
}

export interface ImageModelInterface extends BaseModelInterface {
  type: "image";
}

export interface OpenAITextChatCompletionInterface extends TextModelInterface {
  type: "text";
  requestCallback: (
    client: OpenAI,
    body: Partial<ChatCompletionCreateParamsBase>,
    options?: RequestOptions
  ) => APIPromise<Stream<ChatCompletionChunk> | ChatCompletion>;
}

export interface OpenAIImageInterface extends ImageModelInterface {
  type: "image";
  requestCallback: (
    client: OpenAI,
    body: ImageGenerateParams,
    options?: RequestOptions
  ) => APIPromise<ImagesResponse>;
}

export interface Provider {
  provider: string;
  logoBig: any; // ImportedSVGType (React is't in deps in backspace and billing)
  logoLetteringBig?: any; // ImportedSVGType (React is't in deps in backspace and billing)
}
