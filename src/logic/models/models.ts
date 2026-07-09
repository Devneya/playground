import {
  transcriptionRequestCallback,
  chatCompletionRequestCallback,
  imageRequestCallback, responsesRequestCallback,
} from "./callbacks";
import { Model } from "./interfaces";
import {
  AnthropicProvider,
  BlackForestLabs,
  DeepSeek,
  Google,
  OpenAIProvider,
} from "./providers";
import { makeMessagesChainForCompletions, makeMessagesChainForPDF, makeMessagesChainForResponses } from "./modelLibrary";

const models: Model[] = [
  {
    name: "gemma-3n-E4B-it",
    type: "text",
    mode: "chat",
    provider: Google,
    litellm_provider: "together_ai",
    params: "{}",
    requestCallback: chatCompletionRequestCallback(
      "together_ai/google/gemma-3n-E4B-it"
    ),
    makeMessagesChain: makeMessagesChainForCompletions,
  },
  {
    name: "FLUX.1-schnell",
    type: "image",
    mode: "image_generation",
    provider: BlackForestLabs,
    litellm_provider: "nscale",
    params: "{}",
    requestCallback: imageRequestCallback(
      "nscale/black-forest-labs/FLUX.1-schnell"
    ),
  },
  {
    name: "DeepSeek-R1-Distill-Qwen-14B",
    type: "text",
    mode: "chat",
    provider: DeepSeek,
    litellm_provider: "nscale",
    params: "{}",
    requestCallback: chatCompletionRequestCallback(
      "nscale/deepseek-ai/DeepSeek-R1-Distill-Qwen-14B"
    ),
    makeMessagesChain: makeMessagesChainForCompletions,
  },
  {
    name: "gpt-4o",
    type: "text",
    mode: "chat",
    provider: OpenAIProvider,
    litellm_provider: "openai",
    params: "{}",
    requestCallback: responsesRequestCallback("gpt-4o"),
    makeMessagesChain: makeMessagesChainForResponses,
  },
  {
    name: "claude-3-haiku-20240307",
    type: "text",
    mode: "chat",
    provider: AnthropicProvider,
    litellm_provider: "anthropic",
    params: "{}",
    requestCallback: chatCompletionRequestCallback(
      "anthropic/claude-3-haiku-20240307"
    ),
    makeMessagesChain: makeMessagesChainForCompletions,
  },

  {
    name: "dall-e-3",
    type: "image",
    mode: "image_generation",
    provider: OpenAIProvider,
    litellm_provider: "openai",
    params: "{}",
    requestCallback: imageRequestCallback("dall-e-3"),
  },
  {
    name: "whisper-1",
    type: "audio",
    mode: "transcription",
    provider: OpenAIProvider,
    litellm_provider: "openai",
    params: "{}",
    requestCallback: transcriptionRequestCallback("whisper-1"),
  },
  {
    name: "Llama-4-Scout-17B-16E-Instruct",
    type: "pdf",
    mode: "ocr",
    litellm_provider: "nscale",
    params: "{}",
    requestCallback: chatCompletionRequestCallback(
      "nscale/meta-llama/Llama-4-Scout-17B-16E-Instruct"
    ),
    makeMessagesChain: makeMessagesChainForPDF,
  },
];

export default models;
