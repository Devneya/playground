import { config, apiUrl } from "../config";
import type { CompletionMessage, Usage } from "../domain/types";
import { fetchJson } from "./http";
import { ApiError } from "./errors";
import type { BifrostVirtualKey } from "./credentials";

export type ChatCompletionRequest = { model: string; messages: CompletionMessage[]; stream: false };
export type ChatCompletionResult = { content: string; usage?: Usage };

const usageNumber = (record: Record<string, unknown>, camelCase: string, snakeCase: string): number | undefined => {
  const value = record[camelCase] ?? record[snakeCase];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
};

const normalizeUsage = (value: unknown): Usage | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const usage: Usage = {};
  const promptTokens = usageNumber(record, "promptTokens", "prompt_tokens");
  const completionTokens = usageNumber(record, "completionTokens", "completion_tokens");
  const totalTokens = usageNumber(record, "totalTokens", "total_tokens");
  if (promptTokens !== undefined) usage.promptTokens = promptTokens;
  if (completionTokens !== undefined) usage.completionTokens = completionTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  return Object.keys(usage).length > 0 ? usage : undefined;
};

export const createChatCompletion = async (key: BifrostVirtualKey, request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResult> => {
  const body = await fetchJson(apiUrl("llm/v1/chat/completions"), { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request) }, config.completionTimeoutMs, signal);
  if (typeof body !== "object" || body === null) throw new ApiError("invalid_response", "The completion response was invalid.");
  const record = body as Record<string, unknown>;
  const choices = record.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = typeof first === "object" && first !== null ? (first as Record<string, unknown>).message : undefined;
  const content = typeof message === "object" && message !== null ? (message as Record<string, unknown>).content : undefined;
  if (typeof content !== "string") throw new ApiError("invalid_response", "The completion did not contain usable text.");
  const usage = normalizeUsage(record.usage);
  return { content, ...(usage ? { usage } : {}) };
};
