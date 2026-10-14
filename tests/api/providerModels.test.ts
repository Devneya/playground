import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ApiError } from "../../src/api/errors";
import { listProviderModels } from "../../src/api/providerModels";
import { toOpenAIApiKey, toProviderApiKey } from "../../src/api/credentials";

const server = setupServer();
const key = toProviderApiKey("provider-test-key");
const anthropic = { provider: "anthropic", apiKey: key } as const;
const google = { provider: "google", apiKey: key } as const;
const openrouter = { provider: "openrouter", apiKey: key } as const;
const groq = { provider: "groq", apiKey: key } as const;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
afterAll(() => server.close());

describe("provider model catalogs", () => {
  it("normalizes compatible model entries, sorts and deduplicates them", async () => {
    server.use(http.get("https://api.groq.com/openai/v1/models", ({ request }) => {
      expect(request.headers.get("authorization")).toBe(`Bearer ${key}`);
      return HttpResponse.json({ data: [
        { id: "zeta", created: 17, owned_by: "team" },
        { id: "alpha" },
        { id: "alpha", created: 4, owned_by: "duplicate" },
        { id: "beta", created: "invalid", owned_by: " " },
      ] });
    }));

    await expect(listProviderModels(groq)).resolves.toEqual([
      { id: "alpha", object: "model", created: 4, owned_by: "duplicate" },
      { id: "beta", object: "model", created: 0, owned_by: "groq" },
      { id: "zeta", object: "model", created: 17, owned_by: "team" },
    ]);
  });

  it("checks the OpenRouter key before requesting and normalizing its catalog", async () => {
    const calls: string[] = [];
    server.use(
      http.get("https://openrouter.ai/api/v1/key", ({ request }) => {
        calls.push(new URL(request.url).pathname);
        expect(request.headers.get("authorization")).toBe(`Bearer ${key}`);
        return HttpResponse.json({ data: { label: "test", limit: null } });
      }),
      http.get("https://openrouter.ai/api/v1/models", ({ request }) => {
        calls.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: [{ id: "vendor/model" }, { id: "another/model", created: 9, owned_by: "vendor" }] });
      }),
    );

    await expect(listProviderModels(openrouter)).resolves.toEqual([
      { id: "another/model", object: "model", created: 9, owned_by: "vendor" },
      { id: "vendor/model", object: "model", created: 0, owned_by: "openrouter" },
    ]);
    expect(calls).toEqual(["/api/v1/key", "/api/v1/models"]);
  });

  it("follows Anthropic after_id pages and sorts the combined catalog", async () => {
    const cursors: Array<string | null> = [];
    server.use(http.get("https://api.anthropic.com/v1/models", ({ request }) => {
      const url = new URL(request.url);
      cursors.push(url.searchParams.get("after_id"));
      expect(url.searchParams.get("limit")).toBe("100");
      return url.searchParams.has("after_id")
        ? HttpResponse.json({ data: [{ id: "claude-b" }], has_more: false, last_id: null })
        : HttpResponse.json({ data: [{ id: "claude-a", created: 1, owned_by: "anthropic" }], has_more: true, last_id: "cursor-a" });
    }));

    await expect(listProviderModels(anthropic)).resolves.toEqual([
      { id: "claude-a", object: "model", created: 1, owned_by: "anthropic" },
      { id: "claude-b", object: "model", created: 0, owned_by: "anthropic" },
    ]);
    expect(cursors).toEqual([null, "cursor-a"]);
  });

  it("follows Google page tokens and excludes models without generateContent", async () => {
    const tokens: Array<string | null> = [];
    server.use(http.get("https://generativelanguage.googleapis.com/v1beta/models", ({ request }) => {
      const url = new URL(request.url);
      tokens.push(url.searchParams.get("pageToken"));
      expect(url.searchParams.get("pageSize")).toBe("1000");
      return url.searchParams.has("pageToken")
        ? HttpResponse.json({ models: [{ name: "models/gemini-2", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "" })
        : HttpResponse.json({
          models: [
            { name: "models/embedding-1", supportedGenerationMethods: ["embedContent"] },
            { name: "models/gemini-1", supportedGenerationMethods: ["generateContent"] },
          ],
          nextPageToken: "page-two",
        });
    }));

    await expect(listProviderModels(google)).resolves.toEqual([
      { id: "gemini-1", object: "model", created: 0, owned_by: "google" },
      { id: "gemini-2", object: "model", created: 0, owned_by: "google" },
    ]);
    expect(tokens).toEqual([null, "page-two"]);
  });

  it("rejects repeated pagination cursors, malformed catalogs, and catalogs with no usable models", async () => {
    server.use(http.get("https://api.anthropic.com/v1/models", () => HttpResponse.json({ data: [] })));
    await expect(listProviderModels(anthropic)).rejects.toMatchObject({ kind: "invalid_response" });
    server.use(http.get("https://api.anthropic.com/v1/models", () => HttpResponse.json({ data: [{ id: "m" }], has_more: true, last_id: "same" })));
    await expect(listProviderModels(anthropic)).rejects.toMatchObject({ kind: "invalid_response" });

    server.use(http.get("https://api.anthropic.com/v1/models", () => HttpResponse.json({ data: [], has_more: true })));
    await expect(listProviderModels(anthropic)).rejects.toMatchObject({ kind: "invalid_response" });

    server.use(http.get("https://api.groq.com/openai/v1/models", () => HttpResponse.json({ data: "not-a-list" })));
    await expect(listProviderModels(groq)).rejects.toMatchObject({ kind: "invalid_response" });
    server.use(http.get("https://api.groq.com/openai/v1/models", () => HttpResponse.json({ data: [{ name: "missing-id" }] })));
    await expect(listProviderModels(groq)).rejects.toMatchObject({ kind: "invalid_response" });
    server.use(http.get("https://api.groq.com/openai/v1/models", () => HttpResponse.json({ data: [null] })));
    await expect(listProviderModels(groq)).rejects.toMatchObject({ kind: "invalid_response" });
    server.use(http.get("https://api.groq.com/openai/v1/models", () => HttpResponse.json({ data: [] })));
    await expect(listProviderModels(groq)).rejects.toMatchObject({ kind: "invalid_response" });

    server.use(http.get("https://generativelanguage.googleapis.com/v1beta/models", () => HttpResponse.json({ models: [{ name: "models/gemini", supportedGenerationMethods: "generateContent" }] })));
    await expect(listProviderModels(google)).rejects.toMatchObject({ kind: "invalid_response" });
    server.use(http.get("https://generativelanguage.googleapis.com/v1beta/models", () => HttpResponse.json({ models: [{ name: "models/embedding", supportedGenerationMethods: ["embedContent"] }] })));
    await expect(listProviderModels(google)).rejects.toMatchObject({ kind: "invalid_response" });
    server.use(http.get("https://generativelanguage.googleapis.com/v1beta/models", () => HttpResponse.json({ data: [] })));
    await expect(listProviderModels(google)).rejects.toMatchObject({ kind: "invalid_response" });

    server.use(http.get("https://api.openai.com/v1/models", () => HttpResponse.json({ object: "list", data: [] })));
    await expect(listProviderModels({ provider: "openai", apiKey: toOpenAIApiKey("openai-key") })).rejects.toMatchObject({ kind: "invalid_response" });

    server.use(http.get("https://api.openai.com/v1/models", () => HttpResponse.json({ object: "list", data: [{ id: "openai-model", object: "model", created: 1, owned_by: "openai" }] })));
    await expect(listProviderModels({ provider: "openai", apiKey: toOpenAIApiKey("openai-key") })).resolves.toMatchObject([{ id: "openai-model" }]);
  });

  it("keeps OpenRouter auth failures safe and stops before its model request", async () => {
    let modelsRequested = false;
    server.use(
      http.get("https://openrouter.ai/api/v1/key", () => HttpResponse.json({ error: { message: `bad ${key}` } }, { status: 401 })),
      http.get("https://openrouter.ai/api/v1/models", () => { modelsRequested = true; return HttpResponse.json({ data: [] }); }),
    );
    let caught: unknown;
    try { await listProviderModels(openrouter); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ kind: "http", status: 401 });
    expect((caught as Error).message).not.toContain(key);
    expect(modelsRequested).toBe(false);

    server.use(
      http.get("https://openrouter.ai/api/v1/key", () => HttpResponse.json({ data: null })),
      http.get("https://openrouter.ai/api/v1/models", () => { modelsRequested = true; return HttpResponse.json({ data: [] }); }),
    );
    await expect(listProviderModels(openrouter)).rejects.toMatchObject({ kind: "invalid_response" });
    expect(modelsRequested).toBe(false);
  });

  it("fails a repeated Google cursor and stops when pagination exceeds ten pages", async () => {
    server.use(http.get("https://generativelanguage.googleapis.com/v1beta/models", () => HttpResponse.json({ models: [], nextPageToken: "repeat" })));
    await expect(listProviderModels(google)).rejects.toMatchObject({ kind: "invalid_response" });

    server.use(http.get("https://generativelanguage.googleapis.com/v1beta/models", () => HttpResponse.json({ models: [], nextPageToken: 1 })));
    await expect(listProviderModels(google)).rejects.toMatchObject({ kind: "invalid_response" });

    let requests = 0;
    server.use(http.get("https://generativelanguage.googleapis.com/v1beta/models", () => {
      requests += 1;
      return HttpResponse.json({ models: [{ name: `models/gemini-${requests}`, supportedGenerationMethods: ["generateContent"] }], nextPageToken: `page-${requests}` });
    }));
    await expect(listProviderModels(google)).rejects.toMatchObject({ kind: "invalid_response" });
    expect(requests).toBe(10);

    let anthropicRequests = 0;
    server.use(http.get("https://api.anthropic.com/v1/models", () => {
      anthropicRequests += 1;
      return HttpResponse.json({ data: [{ id: `claude-${anthropicRequests}` }], has_more: true, last_id: `cursor-${anthropicRequests}` });
    }));
    await expect(listProviderModels(anthropic)).rejects.toMatchObject({ kind: "invalid_response" });
    expect(anthropicRequests).toBe(10);
  });

  it("applies one 20 second deadline to the entire paginated catalog and distinguishes caller abort", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const pending = listProviderModels(groq);
    const deadline = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(20_000);
    await deadline;

    const caller = new AbortController();
    const another = listProviderModels(groq, caller.signal);
    const aborted = expect(another).rejects.toMatchObject({ kind: "aborted" });
    caller.abort();
    await aborted;
  });
});
