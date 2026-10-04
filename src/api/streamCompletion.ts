import { config } from "../config";
import type { CompletionCredential } from "./credentials";
import { createChatCompletion, type ChatCompletionRequest, type ChatCompletionResult } from "./completions";

export type CompletionProgress = { text: string; characters: number; serviceTier?: string };
/** Browser receives only output deltas and transport status. No credentials or private reasoning. */
export const streamCompletion = async (key: CompletionCredential, request: ChatCompletionRequest, signal: AbortSignal, onDelta: (text: string) => void, onProgress: (progress: CompletionProgress) => void) => {
  if (typeof key !== "object") {
    onProgress({ text: "Waiting for the model", characters: 0 });
    const result = await createChatCompletion(key, request, signal);
    if (!signal.aborted) onDelta(result.content);
    return result;
  }
  if (!config.useLocalCodex) throw new Error("Local Codex is available only in local development.");
  const combined = AbortSignal.any([signal, AbortSignal.timeout(config.completionTimeoutMs)]);
  const response = await fetch("/local-api/completion", { method: "POST", headers: { "Content-Type": "application/json", "X-Devneya-Local": "1" }, body: JSON.stringify({ ...request, stream: true }), signal: combined });
  if (!response.ok || !response.body) throw new Error(`The model connection failed (${response.status}).`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", characters = 0, done = false;
  let content = "";
  let usage: ChatCompletionResult["usage"];
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { type: string; text?: string; message?: string; serviceTier?: string; usage?: ChatCompletionResult["usage"] };
    if (event.type === "error") throw new Error(event.message || "The connection ended.");
    if (event.type === "status") onProgress({ text: event.text ?? "Request sent", characters });
    if (event.type === "delta" && typeof event.text === "string") {
      characters += event.text.length;
      content += event.text;
      if (characters > 262144) throw new Error("The model output exceeded the size limit.");
      onProgress({ text: "Receiving response", characters });
      onDelta(event.text);
    }
    if (event.type === "done") { done = true; usage = event.usage; onProgress({ text: "Response received", characters, ...(event.serviceTier ? { serviceTier: event.serviceTier } : {}) }); }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 524288) throw new Error("The model output exceeded the size limit.");
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) { if (signal.aborted) throw new DOMException("Stopped", "AbortError"); consume(line); }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!done) throw new Error("Connection ended before completion. Completed moves have been kept.");
    return { content, ...(usage ? { usage } : {}) };
  } finally { await reader.cancel(); reader.releaseLock(); }
};
