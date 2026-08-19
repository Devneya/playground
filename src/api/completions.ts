import { config, apiUrl } from "../config";
import type { CompletionMessage, Usage } from "../domain/types";
import { fetchJson } from "./http";
import { ApiError } from "./errors";
import type { BifrostVirtualKey } from "./credentials";

export type ChatCompletionRequest = { model: string; messages: CompletionMessage[]; stream: false };
export type ChatCompletionResult = { content: string; usage?: Usage };

export const createChatCompletion = async (key: BifrostVirtualKey, request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResult> => {
  const body = await fetchJson(apiUrl("llm/v1/chat/completions"), { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request) }, config.completionTimeoutMs, signal);
  if (typeof body !== "object" || body === null) throw new ApiError("invalid_response", "The completion response was invalid.");
  const record = body as Record<string, unknown>;
  const choices = record.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = typeof first === "object" && first !== null ? (first as Record<string, unknown>).message : undefined;
  const content = typeof message === "object" && message !== null ? (message as Record<string, unknown>).content : undefined;
  if (typeof content !== "string") throw new ApiError("invalid_response", "The completion did not contain usable text.");
  const rawUsage = record.usage;
  const usage = typeof rawUsage === "object" && rawUsage !== null ? rawUsage as Usage : undefined;
  return { content, ...(usage ? { usage } : {}) };
};
