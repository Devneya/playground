import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatCompletion } from "../../src/api/completions";
import { config } from "../../src/config";
import { fetchEmpty } from "../../src/api/http";
const request = { model: "gpt-6.1-sol", messages: [{ role: "user" as const, content: "Hello" }], stream: false as const, instructions: "Canvas contract" };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("local credential isolation", () => {
  it("rejects a local credential outside local mode", async () => {
    await expect(createChatCompletion({ kind: "local-codex" }, request)).rejects.toThrow("only available");
  });
  it("sends no provider token to the browser route and normalizes usage", async () => {
    vi.spyOn(config, "useLocalCodex", "get").mockReturnValue(true);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ content: "Answer", usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await createChatCompletion({ kind: "local-codex" }, request)).toEqual({ content: "Answer", usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 } });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/local-api/completion");
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ "Content-Type": "application/json", "X-Devneya-Local": "1" });
    expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body)).toEqual(request);
  });
  it("accepts absent usage and rejects malformed local responses", async () => {
    vi.spyOn(config, "useLocalCodex", "get").mockReturnValue(true);
    for (const body of [{ content: "ok" }, { content: "ok", usage: {} }, { content: "ok", usage: null }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
      await expect(createChatCompletion({ kind: "local-codex" }, request)).resolves.toEqual({ content: "ok" });
    }
    for (const body of [null, "wrong", {}, { content: 42 }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
      await expect(createChatCompletion({ kind: "local-codex" }, request)).rejects.toThrow("invalid response");
    }
  });
  it("propagates cancellation and errors for empty responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(fetchEmpty("https://example.test", {}, 1000)).rejects.toMatchObject({ kind: "http" });
    const caller = new AbortController();
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")))));
    const result = fetchEmpty("https://example.test", {}, 1000, caller.signal); caller.abort();
    await expect(result).rejects.toMatchObject({ kind: "aborted" });
    await expect(fetchEmpty("https://example.test", {}, 1)).rejects.toMatchObject({ kind: "timeout" });
  });
});
