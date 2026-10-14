import { config } from "../config";
import { MAX_REQUEST_FILE_BYTES, storedFileSchema } from "../domain/files";
import type { CompletionMessage, Usage } from "../domain/types";
import { ApiError } from "./errors";
import type { ChatCompletionRequest, ChatCompletionResult } from "./completions";
import type { NewApiKeyConnection } from "./credentials";
import { fetchProviderJson } from "./providerHttp";
import { withProviderOperation } from "./providerOperation";

const MAX_OUTPUT_TOKENS = 4096;

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const invalidCompletion = (): ApiError => new ApiError("invalid_response", "The provider completion response was invalid.");

const visibleText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw invalidCompletion();
  return value.flatMap((part) => {
    const record = recordOf(part);
    return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
  }).join("");
};

const requireText = (content: string): string => {
  if (!content.trim()) throw new ApiError("invalid_response", "The provider completion did not contain usable text.");
  return content;
};

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const usageResult = (usage: Usage): Usage | undefined => {
  for (const key of Object.keys(usage) as Array<keyof Usage>) {
    if (finite(usage[key]) === undefined) delete usage[key];
  }
  return Object.keys(usage).length ? usage : undefined;
};

const compatibleUsage = (value: unknown): Usage | undefined => {
  const record = recordOf(value);
  if (!record) return undefined;
  const promptTokens = finite(record.prompt_tokens);
  const completionTokens = finite(record.completion_tokens);
  const totalTokens = finite(record.total_tokens);
  const usage: Usage = {};
  if (promptTokens !== undefined) usage.promptTokens = promptTokens;
  if (completionTokens !== undefined) usage.completionTokens = completionTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  return usageResult(usage);
};

const sumUsageFields = (record: Record<string, unknown>, fields: string[]): number | undefined => {
  const values = fields.map((field) => finite(record[field])).filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
};

const anthropicUsage = (value: unknown): Usage | undefined => {
  const record = recordOf(value);
  if (!record) return undefined;
  const promptTokens = sumUsageFields(record, ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]);
  const completionTokens = finite(record.output_tokens);
  const usage: Usage = {};
  if (promptTokens !== undefined) usage.promptTokens = promptTokens;
  if (completionTokens !== undefined) usage.completionTokens = completionTokens;
  if (promptTokens !== undefined && completionTokens !== undefined) usage.totalTokens = promptTokens + completionTokens;
  return usageResult(usage);
};

const googleUsage = (value: unknown): Usage | undefined => {
  const record = recordOf(value);
  if (!record) return undefined;
  const promptTokens = finite(record.promptTokenCount);
  const completionTokens = sumUsageFields(record, ["candidatesTokenCount", "thoughtsTokenCount"]);
  const reportedTotal = finite(record.totalTokenCount);
  const usage: Usage = {};
  if (promptTokens !== undefined) usage.promptTokens = promptTokens;
  if (completionTokens !== undefined) usage.completionTokens = completionTokens;
  if (reportedTotal !== undefined) usage.totalTokens = reportedTotal;
  else if (promptTokens !== undefined && completionTokens !== undefined) usage.totalTokens = promptTokens + completionTokens;
  return usageResult(usage);
};

const ensureFiles = (messages: CompletionMessage[]): void => {
  let totalSize = 0;
  for (const message of messages) {
    for (const file of message.files ?? []) {
      const parsed = storedFileSchema.safeParse(file);
      if (!parsed.success) throw new ApiError("invalid_response", "The request contains an invalid attachment.");
      totalSize += parsed.data.size;
      if (totalSize > MAX_REQUEST_FILE_BYTES) throw new ApiError("invalid_response", "Attachments exceed the 4 MB request limit.");
    }
  }
};

const base64FromDataUrl = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(",") + 1);

const compatibleMessages = (messages: CompletionMessage[]) => messages.map(({ role, content, files }) => ({
  role,
  content: files?.length ? [
    { type: "text", text: content },
    ...files.map((file) => file.mimeType.startsWith("image/")
      ? { type: "image_url", image_url: { url: file.dataUrl } }
      : { type: "file", file: { filename: file.name, file_data: file.dataUrl } }),
  ] : content,
}));

const anthropicMessages = (messages: CompletionMessage[]) => messages.map(({ role, content, files }) => ({
  role,
  content: files?.length ? [
    { type: "text", text: content },
    ...files.map((file) => file.mimeType.startsWith("image/")
      ? { type: "image", source: { type: "base64", media_type: file.mimeType, data: base64FromDataUrl(file.dataUrl) } }
      : { type: "document", title: file.name, source: { type: "base64", media_type: file.mimeType, data: base64FromDataUrl(file.dataUrl) } }),
  ] : content,
}));

const googleContents = (messages: CompletionMessage[]) => messages.map(({ role, content, files }) => ({
  role: role === "assistant" ? "model" : "user",
  parts: [
    { text: content },
    ...(files ?? []).map((file) => ({ inlineData: { mimeType: file.mimeType, data: base64FromDataUrl(file.dataUrl) } })),
  ],
}));

const compatibleCompletion = async (connection: NewApiKeyConnection, request: ChatCompletionRequest, signal: AbortSignal): Promise<ChatCompletionResult> => {
  const messages = compatibleMessages(request.messages);
  const body = await fetchProviderJson(connection, "chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: request.model,
      stream: false,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: request.instructions ? [{ role: "system", content: request.instructions }, ...messages] : messages,
    }),
  }, signal);

  const record = recordOf(body);
  const first = Array.isArray(record?.choices) ? record.choices[0] : undefined;
  const choice = recordOf(first);
  if (choice?.finish_reason === "content_filter" || choice?.finish_reason === "safety") throw new ApiError("invalid_response", "The provider blocked this response for safety reasons.");
  const message = recordOf(choice?.message);
  if (!message || !("content" in message)) throw invalidCompletion();
  const usage = compatibleUsage(record?.usage);
  return { content: requireText(visibleText(message.content)), ...(usage ? { usage } : {}) };
};

const anthropicCompletion = async (connection: NewApiKeyConnection, request: ChatCompletionRequest, signal: AbortSignal): Promise<ChatCompletionResult> => {
  const body = await fetchProviderJson(connection, "messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: request.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: false,
      ...(request.instructions ? { system: request.instructions } : {}),
      messages: anthropicMessages(request.messages),
    }),
  }, signal);
  const record = recordOf(body);
  if (!record || record.stop_reason === "refusal" || !Array.isArray(record.content)) {
    if (record?.stop_reason === "refusal") throw new ApiError("invalid_response", "The provider blocked this response for safety reasons.");
    throw invalidCompletion();
  }
  const content = record.content.flatMap((block) => {
    const item = recordOf(block);
    return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
  }).join("");
  const usage = anthropicUsage(record.usage);
  return { content: requireText(content), ...(usage ? { usage } : {}) };
};

const googleCompletion = async (connection: NewApiKeyConnection, request: ChatCompletionRequest, signal: AbortSignal): Promise<ChatCompletionResult> => {
  const model = request.model.replace(/^models\//, "");
  const body = await fetchProviderJson(connection, `models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(request.instructions ? { systemInstruction: { parts: [{ text: request.instructions }] } } : {}),
      contents: googleContents(request.messages),
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
    }),
  }, signal);
  const record = recordOf(body);
  const feedback = recordOf(record?.promptFeedback);
  if (feedback && typeof feedback.blockReason === "string" && feedback.blockReason !== "BLOCK_REASON_UNSPECIFIED") throw new ApiError("invalid_response", "The provider blocked this response for safety reasons.");
  const candidate = Array.isArray(record?.candidates) ? record.candidates[0] : undefined;
  const candidateRecord = recordOf(candidate);
  const finishReason = candidateRecord?.finishReason;
  if (typeof finishReason === "string" && ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "MODEL_ARMOR"].includes(finishReason)) {
    throw new ApiError("invalid_response", "The provider blocked this response for safety reasons.");
  }
  const content = recordOf(candidateRecord?.content);
  if (!content || !Array.isArray(content.parts)) throw invalidCompletion();
  const text = content.parts.flatMap((part) => {
    const item = recordOf(part);
    return item?.thought !== true && typeof item?.text === "string" ? [item.text] : [];
  }).join("");
  const usage = googleUsage(record?.usageMetadata);
  return { content: requireText(text), ...(usage ? { usage } : {}) };
};

export const createProviderCompletion = async (
  connection: NewApiKeyConnection,
  request: ChatCompletionRequest,
  signal?: AbortSignal,
): Promise<ChatCompletionResult> => {
  ensureFiles(request.messages);
  return withProviderOperation(signal, config.completionTimeoutMs, (combinedSignal) => {
    if (connection.provider === "anthropic") return anthropicCompletion(connection, request, combinedSignal);
    if (connection.provider === "google") return googleCompletion(connection, request, combinedSignal);
    return compatibleCompletion(connection, request, combinedSignal);
  });
};
