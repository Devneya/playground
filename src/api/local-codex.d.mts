import type { Plugin } from "vite";
export function localCodexPlugin(): Plugin;
export function readResponseStream(body: ReadableStream<Uint8Array> | null, onDelta?: (text: string) => void, requestedModel?: string): Promise<{ content: string; serviceTier?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }>;
export function isLocalRequest(req: { method: string; headers: Record<string, string> }): boolean;
export function createCodexBridge(options?: { credentials?: () => Promise<Record<string, string>>; fetcher?: typeof fetch }): { complete(messages: import("../domain/types").CompletionMessage[], instructions: string, signal?: AbortSignal, onDelta?: (text: string) => void, model?: string, effort?: import("../domain/reasoning").ReasoningEffort): Promise<{ content: string }>; catalog(signal?: AbortSignal): Promise<{ object: string; data: import("../domain/types").Model[] }> };
