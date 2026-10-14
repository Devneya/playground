import type { Model, Usage } from "../domain/types";
import { modelListSchema } from "../domain/schemas";
import { ApiError } from "./errors";
import { fetchJson } from "./http";
import type { ChatCompletionRequest, ChatCompletionResult } from "./completions";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const CATALOG_TIMEOUT_MS = 20_000;
const COMPLETION_TIMEOUT_MS = 120_000;

const bearerHeaders = (apiKey: string): HeadersInit => ({
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
});

const throwRedacted = (error: unknown, apiKey: string): never => {
  if (!(error instanceof ApiError)) throw new ApiError("network", "OpenAI request failed.");

  const message = apiKey ? error.message.split(apiKey).join("[redacted]") : error.message;
  const code = apiKey && error.code ? error.code.split(apiKey).join("[redacted]") : error.code;
  if (error.status === 401) throw new ApiError("http", "OpenAI rejected the API key.", error.status, code);
  throw new ApiError(error.kind, message, error.status, code);
};

const withRedactedKey = async <T>(apiKey: string, operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    return throwRedacted(error, apiKey);
  }
};

export const listOpenAIModels = async (apiKey: string, signal?: AbortSignal): Promise<Model[]> =>
  withRedactedKey(apiKey, async () => {
    const body = await fetchJson(OPENAI_MODELS_URL, { headers: bearerHeaders(apiKey) }, CATALOG_TIMEOUT_MS, signal);
    const parsed = modelListSchema.safeParse(body);
    if (!parsed.success) throw new ApiError("invalid_response", "The OpenAI model catalog response was invalid.");

    const unique = new Map(parsed.data.data.map((model) => [model.id, model]));
    return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  });

const toOpenAIMessages = (request: ChatCompletionRequest) => {
  const messages = request.messages.map(({ role, content, files }) => ({
    role,
    content: files?.length
      ? [
          { type: "text" as const, text: content },
          ...files.map((file) => file.mimeType.startsWith("image/")
            ? { type: "image_url" as const, image_url: { url: file.dataUrl } }
            : { type: "file" as const, file: { filename: file.name, file_data: file.dataUrl } }),
        ]
      : content,
  }));

  return request.instructions
    ? [{ role: "system" as const, content: request.instructions }, ...messages]
    : messages;
};

const finiteUsage = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const normalizeUsage = (value: unknown): Usage | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const promptTokens = finiteUsage(record.prompt_tokens ?? record.input_tokens);
  const completionTokens = finiteUsage(record.completion_tokens ?? record.output_tokens);
  const totalTokens = finiteUsage(record.total_tokens);
  const usage: Usage = {};
  if (promptTokens !== undefined) usage.promptTokens = promptTokens;
  if (completionTokens !== undefined) usage.completionTokens = completionTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
};

export const createOpenAIChatCompletion = async (
  apiKey: string,
  request: ChatCompletionRequest,
  signal?: AbortSignal,
): Promise<ChatCompletionResult> =>
  withRedactedKey(apiKey, async () => {
    const body = await fetchJson(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { ...bearerHeaders(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        ...(request.reasoning_effort ? { reasoning_effort: request.reasoning_effort } : {}),
        messages: toOpenAIMessages(request),
      }),
    }, COMPLETION_TIMEOUT_MS, signal);

    if (typeof body !== "object" || body === null) throw new ApiError("invalid_response", "The OpenAI completion response was invalid.");
    const record = body as Record<string, unknown>;
    const first = Array.isArray(record.choices) ? record.choices[0] : undefined;
    const message = typeof first === "object" && first !== null ? (first as Record<string, unknown>).message : undefined;
    const content = typeof message === "object" && message !== null ? (message as Record<string, unknown>).content : undefined;
    if (typeof content !== "string") throw new ApiError("invalid_response", "The OpenAI completion did not contain usable text.");

    const usage = normalizeUsage(record.usage);
    return { content, ...(usage ? { usage } : {}) };
  });
