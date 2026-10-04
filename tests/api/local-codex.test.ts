// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createCodexBridge, isLocalRequest, readResponseStream } from "../../src/api/local-codex.mjs";

const stream = (text: string, size = 7) => new ReadableStream<Uint8Array>({ start(controller) { const bytes = new TextEncoder().encode(text); for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size)); controller.close(); } });
const event = (data: object) => `data: ${JSON.stringify(data)}\r\n\r\n`;
const success = event({ type: "response.output_text.delta", delta: "Hello 🌱" }) + event({ type: "response.completed", response: { status: "completed", model: "gpt-6.1-sol", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });

describe("local Codex transport", () => {
  it("routes live catalog models independently and rejects unavailable models and substitutions", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).includes("models?")) return Response.json({ models: [
        { slug: "gpt-6.1-sol", visibility: "list", supported_reasoning_levels: [{ effort: "xhigh" }] },
        { slug: "gpt-6-luna", visibility: "list", supported_reasoning_levels: [{ effort: "xhigh" }] },
        { slug: "gpt-5.5", visibility: "list", supported_reasoning_levels: [{ effort: "xhigh" }] },
        { slug: "hidden-model", visibility: "hide", supported_reasoning_levels: [{ effort: "xhigh" }] },
      ] });
      const model = JSON.parse(String(init?.body)).model;
      return new Response(stream(event({ type: "response.output_text.delta", delta: model }) + event({ type: "response.completed", response: { model, status: "completed" } })));
    });
    const bridge = createCodexBridge({ credentials: async () => ({}), fetcher });
    expect((await bridge.catalog()).data.map((model) => model.id)).toEqual(["gpt-6.1-sol", "gpt-6-luna", "gpt-5.5"]);
    for (const model of ["gpt-6-luna", "gpt-5.5"]) {
      await expect(bridge.complete([], "Workspace", undefined, undefined, model)).resolves.toMatchObject({ content: model });
      expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body))).toMatchObject({ model, service_tier: "priority", reasoning: { effort: "xhigh" } });
    }
    await expect(bridge.complete([], "Workspace", undefined, undefined, "hidden-model")).rejects.toThrow("available");
    await expect(readResponseStream(stream(success), undefined, "gpt-5.5")).rejects.toThrow("different model");
  });
  it("assembles UTF-8 deltas across chunk boundaries and requires successful completion", async () => {
    const delta = vi.fn();
    await expect(readResponseStream(stream(`event: response\n${success}data: [DONE]\n`), delta)).resolves.toEqual({ content: "Hello 🌱", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });
    expect(delta).toHaveBeenCalledWith("Hello 🌱");
    await expect(readResponseStream(null)).rejects.toThrow("empty response");
    await expect(readResponseStream(stream(event({ type: "response.output_text.delta", delta: "partial" })))).rejects.toThrow("before a complete answer");
  });
  it.each(["error", "response.failed", "response.incomplete"])("fails on %s even after partial text", async (type) => {
    await expect(readResponseStream(stream(event({ type: "response.output_text.delta", delta: "partial" }) + event({ type })))).rejects.toThrow("could not complete");
  });
  it("rejects a model substitution, incomplete status, malformed JSON and oversized content", async () => {
    await expect(readResponseStream(stream(event({ type: "response.completed", response: { status: "completed", model: "other" } })))).rejects.toThrow("different model");
    await expect(readResponseStream(stream(event({ type: "response.completed", response: { status: "incomplete" } })))).rejects.toThrow("incomplete");
    await expect(readResponseStream(stream('data: {broken\n'))).rejects.toThrow();
    await expect(readResponseStream(stream(event({ type: "response.output_text.delta", delta: "x".repeat(262145) }), 300000))).rejects.toThrow("too much");
  });
  it("pins model and effort, exposes no tools, and verifies catalog omissions by inference once", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).includes("models?") ? Response.json({ models: [] }) : new Response(stream(success)));
    const bridge = createCodexBridge({ credentials: async () => ({ Authorization: "test-only" }), fetcher });
    const first = await bridge.catalog();
    expect(first.data.map((m) => m.id)).toEqual(["gpt-6.1-sol"]);
    await bridge.catalog();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/responses"))).toHaveLength(1);
    const onDelta = vi.fn();
    await bridge.complete([{ role: "user", content: "Think with me" }], "Canvas contract", undefined, onDelta);
    expect(onDelta).toHaveBeenCalledWith("Hello 🌱");
    const [url, init] = fetcher.mock.calls.at(-1)!;
    expect(String(url)).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-6.1-sol", service_tier: "priority", reasoning: { effort: "xhigh" }, tools: [], store: false, stream: true, instructions: "Canvas contract" });
  });
  it("does not claim connectivity after a failed probe and permits a later retry", async () => {
    let fail = true;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).includes("models?") ? Response.json({ models: [] }) : fail ? new Response("not authorized", { status: 401 }) : new Response(stream(success)));
    const bridge = createCodexBridge({ credentials: async () => ({}), fetcher });
    await expect(bridge.catalog()).rejects.toThrow("expired"); fail = false;
    await expect(bridge.catalog()).resolves.toMatchObject({ data: [{ id: "gpt-6.1-sol" }] });
    const unavailable = createCodexBridge({ credentials: async () => ({}), fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("private upstream details", { status: 429 })) });
    await expect(unavailable.complete([], "contract")).rejects.toThrow("HTTP 429");
    const invalid = createCodexBridge({ credentials: async () => ({}), fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ models: null })) });
    await expect(invalid.catalog()).rejects.toThrow("invalid model catalog");
  });
  it("rejects foreign origins, DNS rebinding, missing origin and non-JSON POSTs", () => {
    const headers = { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002", "x-devneya-local": "1", "content-type": "application/json" };
    expect(isLocalRequest({ method: "POST", headers })).toBe(true);
    expect(isLocalRequest({ method: "GET", headers: { host: "localhost:3002" } })).toBe(true);
    for (const altered of [{ origin: "https://evil.example" }, { host: "evil.example" }, { host: "127.0.0.1.evil.example" }, { origin: "" }, { "sec-fetch-site": "cross-site" }, { "x-devneya-local": "" }, { "content-type": "text/plain" }]) expect(isLocalRequest({ method: "POST", headers: { ...headers, ...altered } })).toBe(false);
    expect(isLocalRequest({ method: "GET", headers: {} })).toBe(false);
  });
});


it("reports the service tier actually returned by Codex", async () => {
  for (const tier of ["fast", "priority", "default"]) {
    const body = event({ type: "response.output_text.delta", delta: "OK" }) + event({ type: "response.completed", response: { status: "completed", model: "gpt-6.1-sol", service_tier: tier } });
    await expect(readResponseStream(stream(body))).resolves.toEqual({ content: "OK", serviceTier: tier });
  }
});

it("uses catalog effort capabilities and sends files as multimodal input", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).includes("models?")) return Response.json({ models: [{ slug: "gpt-6.1-sol", visibility: "list", default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "xhigh" }] }] });
    const model = JSON.parse(String(init?.body)).model;
    return new Response(stream(event({ type: "response.output_text.delta", delta: "OK" }) + event({ type: "response.completed", response: { model, status: "completed" } })));
  });
  const bridge = createCodexBridge({ credentials: async () => ({}), fetcher });
  expect((await bridge.catalog()).data[0]?.supportedReasoningEfforts).toEqual(["low", "medium", "xhigh"]);
  const source = Buffer.from("%PDF-1.4\n%%EOF");
  const file = { name: "context.pdf", size: source.length, mimeType: "application/pdf" as const, dataUrl: `data:application/pdf;base64,${source.toString("base64")}` };
  await bridge.complete([{ role: "user", content: "Read this", files: [file] }], "Answer", undefined, undefined, "gpt-6.1-sol", "low");
  const body = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));
  expect(body.reasoning).toEqual({ effort: "low" });
  expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "Read this" }, { type: "input_file", filename: "context.pdf", file_data: file.dataUrl }] }]);
  await expect(bridge.complete([], "Answer", undefined, undefined, "gpt-6.1-sol", "ultra")).rejects.toThrow("does not support");
});
