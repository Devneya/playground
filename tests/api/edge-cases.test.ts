import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { listModels } from "../../src/api/models";
import { createChatCompletion } from "../../src/api/completions";
import { toBifrostVirtualKey } from "../../src/api/credentials";
import { ApiError, errorFromResponse } from "../../src/api/errors";
import { fetchJson } from "../../src/api/http";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); vi.unstubAllGlobals(); });
afterAll(() => server.close());

describe("API edge cases", () => {
  it("requires the public model request to omit authorization and rejects malformed catalogs", async () => {
    server.use(http.get("https://api.devneya.com/llm/v1/models", ({ request }) => {
      expect(request.headers.get("authorization")).toBeNull();
      return HttpResponse.json({ nope: true });
    }));
    await expect(listModels()).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("rejects completion responses without text and preserves stream false", async () => {
    server.use(http.post("https://api.devneya.com/llm/v1/chat/completions", async ({ request }) => {
      const body = await request.json() as { stream?: boolean };
      expect(body.stream).toBe(false);
      return HttpResponse.json({ choices: [{ message: {} }] });
    }));
    await expect(createChatCompletion(toBifrostVirtualKey("sk-bf-edge"), { model: "m", messages: [{ role: "user", content: "x" }], stream: false })).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("normalizes non-json HTTP errors and caller cancellation", async () => {
    const error = await errorFromResponse(new Response("offline", { status: 503, statusText: "Unavailable" }));
    expect(error).toMatchObject({ kind: "http", status: 503, message: "Unavailable" });
    const caller = new AbortController();
    caller.abort();
    await expect(fetchJson("https://api.devneya.com/llm/v1/models", {}, 1000, caller.signal)).rejects.toMatchObject({ kind: "aborted" });
  });

  it("distinguishes a timeout from a caller abort", async () => {
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
    }));
    await expect(fetchJson("https://example.test", {}, 1)).rejects.toMatchObject({ kind: "timeout" });
    expect(new ApiError("timeout", "slow").kind).toBe("timeout");
  });
});
