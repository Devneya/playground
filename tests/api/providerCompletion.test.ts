import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ApiError } from "../../src/api/errors";
import type { ChatCompletionRequest } from "../../src/api/completions";
import { createProviderCompletion } from "../../src/api/providerCompletion";
import { toProviderApiKey } from "../../src/api/credentials";
import { withProviderOperation } from "../../src/api/providerOperation";

const server = setupServer();
const key = toProviderApiKey("provider-completion-test-key");
const anthropic = { provider: "anthropic", apiKey: key } as const;
const google = { provider: "google", apiKey: key } as const;
const custom = { provider: "custom", apiKey: key, baseURL: "https://models.example.test/v1" } as const;
const groq = { provider: "groq", apiKey: key } as const;
const request = (overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({
  model: "picked-model",
  stream: false,
  messages: [{ role: "user", content: "Describe the attachments." }, { role: "assistant", content: "Earlier response." }],
  ...overrides,
});
const png = { name: "picture.png", mimeType: "image/png" as const, size: 8, dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
const pdf = { name: "brief.pdf", mimeType: "application/pdf" as const, size: 5, dataUrl: "data:application/pdf;base64,JVBERi0=" };

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
afterAll(() => server.close());

describe("provider completion adapters", () => {
  it("sends compatible chat history, instructions and existing image/PDF parts, returning visible text and finite usage", async () => {
    server.use(http.post("https://api.groq.com/openai/v1/chat/completions", async ({ request: incoming }) => {
      expect(incoming.headers.get("authorization")).toBe(`Bearer ${key}`);
      expect(incoming.headers.get("content-type")).toContain("application/json");
      expect(await incoming.json()).toEqual({
        model: "picked-model",
        stream: false,
        max_tokens: 4096,
        messages: [
          { role: "system", content: "Answer in one sentence." },
          { role: "user", content: [
            { type: "text", text: "Describe the attachments." },
            { type: "image_url", image_url: { url: png.dataUrl } },
            { type: "file", file: { filename: pdf.name, file_data: pdf.dataUrl } },
          ] },
          { role: "assistant", content: "Earlier response." },
        ],
      });
      return HttpResponse.json({ choices: [{ finish_reason: "stop", message: { content: [
        { type: "text", text: "The answer is " },
        { type: "reasoning", text: "private reasoning" },
        { type: "text", text: "visible." },
        { type: "tool_use", input: { hidden: true } },
      ] } }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, invalid: "ignored" } });
    }));

    await expect(createProviderCompletion(groq, request({
      instructions: "Answer in one sentence.",
      messages: [{ role: "user", content: "Describe the attachments.", files: [png, pdf] }, { role: "assistant", content: "Earlier response." }],
    }))).resolves.toEqual({ content: "The answer is visible.", usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 } });
  });

  it("sends Anthropic native messages, base64 image/document blocks and combines cached input usage", async () => {
    server.use(http.post("https://api.anthropic.com/v1/messages", async ({ request: incoming }) => {
      expect(incoming.headers.get("x-api-key")).toBe(key);
      expect(incoming.headers.get("anthropic-version")).toBe("2023-06-01");
      expect(incoming.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
      expect(await incoming.json()).toEqual({
        model: "claude-picked",
        max_tokens: 4096,
        stream: false,
        system: "Use the provided history.",
        messages: [
          { role: "user", content: [
            { type: "text", text: "Describe the attachments." },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
            { type: "document", title: "brief.pdf", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } },
          ] },
          { role: "assistant", content: "Earlier response." },
        ],
      });
      return HttpResponse.json({
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "A visible " },
          { type: "tool_use", name: "hidden-tool" },
          { type: "text", text: "answer." },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 8, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 5 },
      });
    }));

    await expect(createProviderCompletion(anthropic, request({
      model: "claude-picked",
      instructions: "Use the provided history.",
      messages: [{ role: "user", content: "Describe the attachments.", files: [png, pdf] }, { role: "assistant", content: "Earlier response." }],
    }))).resolves.toEqual({ content: "A visible answer.", usage: { promptTokens: 13, completionTokens: 5, totalTokens: 18 } });
  });

  it("sends Google user/model contents, inlineData and systemInstruction and counts thought tokens as output", async () => {
    server.use(http.post("https://generativelanguage.googleapis.com/v1beta/models/gemini%2Fselected:generateContent", async ({ request: incoming }) => {
      expect(incoming.headers.get("x-goog-api-key")).toBe(key);
      expect(await incoming.json()).toEqual({
        systemInstruction: { parts: [{ text: "Follow the thread." }] },
        contents: [
          { role: "user", parts: [
            { text: "Describe the attachments." },
            { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } },
            { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } },
          ] },
          { role: "model", parts: [{ text: "Earlier response." }] },
        ],
        generationConfig: { maxOutputTokens: 4096 },
      });
      return HttpResponse.json({
        candidates: [{
          finishReason: "STOP",
          content: { parts: [
            { thought: true, text: "hidden thought" },
            { text: "Gemini " },
            { functionCall: { name: "hidden-tool" } },
            { text: "answer." },
          ] },
        }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4, thoughtsTokenCount: 2, totalTokenCount: 17 },
      });
    }));

    await expect(createProviderCompletion(google, request({
      model: "gemini/selected",
      instructions: "Follow the thread.",
      messages: [{ role: "user", content: "Describe the attachments.", files: [png, pdf] }, { role: "assistant", content: "Earlier response." }],
    }))).resolves.toEqual({ content: "Gemini answer.", usage: { promptTokens: 11, completionTokens: 6, totalTokens: 17 } });
  });

  it("encodes custom compatible destinations and rejects safety blocks or empty visible text", async () => {
    server.use(http.post("https://models.example.test/v1/chat/completions", () => HttpResponse.json({ choices: [{ finish_reason: "content_filter", message: { content: "" } }] })));
    await expect(createProviderCompletion(custom, request())).rejects.toMatchObject({ kind: "invalid_response", message: "The provider blocked this response for safety reasons." });

    server.use(http.post("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent", () => HttpResponse.json({
      promptFeedback: { blockReason: "SAFETY" },
      candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "blocked" }] } }],
    })));
    await expect(createProviderCompletion(google, request({ model: "gemini-test" }))).rejects.toMatchObject({ kind: "invalid_response" });

    server.use(http.post("https://api.anthropic.com/v1/messages", () => HttpResponse.json({ content: [{ type: "thinking", thinking: "private only" }], stop_reason: "end_turn" })));
    await expect(createProviderCompletion(anthropic, request())).rejects.toMatchObject({ kind: "invalid_response", message: "The provider completion did not contain usable text." });

    server.use(http.post("https://api.anthropic.com/v1/messages", () => HttpResponse.json({ content: [], stop_reason: "refusal" })));
    await expect(createProviderCompletion(anthropic, request())).rejects.toMatchObject({ kind: "invalid_response", message: "The provider blocked this response for safety reasons." });
  });

  it("omits malformed usage values and fails malformed response shapes", async () => {
    server.use(http.post("https://api.groq.com/openai/v1/chat/completions", () => HttpResponse.json({
      choices: [{ message: { content: "Visible." } }],
      usage: { prompt_tokens: -1, completion_tokens: "bad", total_tokens: 0 },
    })));
    await expect(createProviderCompletion(groq, request())).resolves.toEqual({ content: "Visible.", usage: { totalTokens: 0 } });

    server.use(http.post("https://api.groq.com/openai/v1/chat/completions", () => HttpResponse.json({ choices: [] })));
    await expect(createProviderCompletion(groq, request())).rejects.toMatchObject({ kind: "invalid_response" });

    server.use(http.post("https://api.groq.com/openai/v1/chat/completions", () => HttpResponse.json({ choices: [{ message: { content: null } }] })));
    await expect(createProviderCompletion(groq, request())).rejects.toMatchObject({ kind: "invalid_response" });

    server.use(http.post("https://api.groq.com/openai/v1/chat/completions", () => HttpResponse.json({ choices: [{ message: { content: "Visible." } }], usage: null })));
    await expect(createProviderCompletion(groq, request())).resolves.toEqual({ content: "Visible." });

    server.use(http.post("https://api.groq.com/openai/v1/chat/completions", () => HttpResponse.json({ choices: [{ message: { content: "Visible." } }], usage: {} })));
    await expect(createProviderCompletion(groq, request())).resolves.toEqual({ content: "Visible." });

    server.use(http.post("https://api.groq.com/openai/v1/chat/completions", () => HttpResponse.json({ choices: "not-an-array" })));
    await expect(createProviderCompletion(groq, request())).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("keeps absent native usage optional, computes Google totals, and rejects malformed native bodies", async () => {
    server.use(http.post("https://api.anthropic.com/v1/messages", () => HttpResponse.json({ content: [{ type: "text", text: "Visible." }], stop_reason: "end_turn" })));
    await expect(createProviderCompletion(anthropic, request())).resolves.toEqual({ content: "Visible." });

    server.use(http.post("https://api.anthropic.com/v1/messages", () => HttpResponse.json(null)));
    await expect(createProviderCompletion(anthropic, request())).rejects.toMatchObject({ kind: "invalid_response" });

    server.use(http.post("https://api.anthropic.com/v1/messages", () => HttpResponse.json({
      content: [{ type: "text", text: "Visible." }], stop_reason: "end_turn", usage: { input_tokens: "bad", output_tokens: 4 },
    })));
    await expect(createProviderCompletion(anthropic, request())).resolves.toEqual({ content: "Visible.", usage: { completionTokens: 4 } });
    server.use(http.post("https://api.anthropic.com/v1/messages", () => HttpResponse.json({
      content: [{ type: "text", text: "Visible." }], stop_reason: "end_turn", usage: { input_tokens: 4, output_tokens: "bad" },
    })));
    await expect(createProviderCompletion(anthropic, request())).resolves.toEqual({ content: "Visible.", usage: { promptTokens: 4 } });

    server.use(http.post("https://generativelanguage.googleapis.com/v1beta/models/picked-model:generateContent", () => HttpResponse.json({
      promptFeedback: { blockReason: "BLOCK_REASON_UNSPECIFIED" },
      candidates: [{ content: { parts: [{ text: "Visible." }] } }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, thoughtsTokenCount: 1 },
    })));
    await expect(createProviderCompletion(google, request())).resolves.toEqual({ content: "Visible.", usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 } });

    server.use(http.post("https://generativelanguage.googleapis.com/v1beta/models/picked-model:generateContent", () => HttpResponse.json({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Visible." }] } }], usageMetadata: {},
    })));
    await expect(createProviderCompletion(google, request())).resolves.toEqual({ content: "Visible." });

    server.use(http.post("https://generativelanguage.googleapis.com/v1beta/models/picked-model:generateContent", () => HttpResponse.json({
      candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "Blocked." }] } }],
    })));
    await expect(createProviderCompletion(google, request())).rejects.toMatchObject({ kind: "invalid_response", message: "The provider blocked this response for safety reasons." });

    server.use(http.post("https://generativelanguage.googleapis.com/v1beta/models/picked-model:generateContent", () => HttpResponse.json({ candidates: [] })));
    await expect(createProviderCompletion(google, request())).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("does not return nonfinite derived usage totals", async () => {
    server.use(http.post("https://api.anthropic.com/v1/messages", () => HttpResponse.json({ content: [{ type: "text", text: "Visible" }], usage: { input_tokens: 1e308, cache_read_input_tokens: 1e308, output_tokens: 2 } })));
    await expect(createProviderCompletion(anthropic, request())).resolves.toEqual({ content: "Visible", usage: { completionTokens: 2 } });
    server.use(http.post("https://generativelanguage.googleapis.com/v1beta/models/picked-model:generateContent", () => HttpResponse.json({ candidates: [{ content: { parts: [{ text: "Visible" }] } }], usageMetadata: { promptTokenCount: 1e308, candidatesTokenCount: 1e308 } })));
    await expect(createProviderCompletion(google, request())).resolves.toEqual({ content: "Visible", usage: { promptTokens: 1e308, completionTokens: 1e308 } });
  });

  it("rejects invalid attachments and requests over the 4 MB file limit before sending", async () => {
    let requests = 0;
    server.use(http.post("https://api.groq.com/openai/v1/chat/completions", () => { requests += 1; return HttpResponse.json({ choices: [{ message: { content: "ok" } }] }); }));
    await expect(createProviderCompletion(groq, request({ messages: [{ role: "user", content: "bad", files: [{ ...png, dataUrl: "https://example.test/picture.png" }] }] })))
      .rejects.toMatchObject({ kind: "invalid_response", message: "The request contains an invalid attachment." });

    const largePng = (name: string, size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 16_384, bytes.length)));
      return { name, mimeType: "image/png" as const, size, dataUrl: `data:image/png;base64,${btoa(binary)}` };
    };
    const oversized = Array.from({ length: 5 }, (_, index) => largePng(`image-${index}.png`, 1_000_001));
    await expect(createProviderCompletion(groq, request({ messages: [{ role: "user", content: "too much", files: oversized }] })))
      .rejects.toMatchObject({ kind: "invalid_response", message: "Attachments exceed the 4 MB request limit." });
    expect(requests).toBe(0);
  });

  it("redacts echoed credentials and distinguishes operation timeout from caller cancellation", async () => {
    server.use(http.post("https://api.groq.com/openai/v1/chat/completions", () => HttpResponse.json({ error: { message: `credential ${key}` } }, { status: 401 })));
    let caught: unknown;
    try { await createProviderCompletion(groq, request()); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ kind: "http", status: 401 });
    expect((caught as Error).message).not.toContain(key);

    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const timedOut = createProviderCompletion(groq, request());
    const timeoutExpectation = expect(timedOut).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(120_000);
    await timeoutExpectation;

    const caller = new AbortController();
    const cancelled = createProviderCompletion(groq, request(), caller.signal);
    const cancelExpectation = expect(cancelled).rejects.toMatchObject({ kind: "aborted" });
    caller.abort();
    await cancelExpectation;

    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    await expect(createProviderCompletion(groq, request(), alreadyCancelled.signal)).rejects.toMatchObject({ kind: "aborted" });

    const resolvingCaller = new AbortController();
    const abortAfterStart = withProviderOperation(resolvingCaller.signal, 2_000, () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 1_000)));
    const callerAfterStart = expect(abortAfterStart).rejects.toMatchObject({ kind: "aborted" });
    resolvingCaller.abort();
    await vi.advanceTimersByTimeAsync(1_000);
    await callerAfterStart;

    const resolvesAfterDeadline = withProviderOperation(undefined, 500, () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 1_000)));
    const deadlineAfterStart = expect(resolvesAfterDeadline).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(1_000);
    await deadlineAfterStart;
  });
});
