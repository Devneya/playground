import { afterEach, describe, expect, it, vi } from "vitest";
import { API_KEY_PROVIDERS, connectionCredential, isApiKeyConnection, isApiKeyProvider, providerBaseURL, providerHeaders, providerLabel, validateApiKeyCandidate, validateCustomBaseURL } from "../../src/api/apiKeyProviders";
import { CONNECTION_STORAGE_KEY, readBrowserConnection, saveBrowserConnection } from "../../src/api/browserConnection";
import { toOpenAIApiKey, toProviderApiKey } from "../../src/api/credentials";
import { fetchProviderJson } from "../../src/api/providerHttp";

const syntheticKey = "synthetic-provider-unit-key";
const custom = () => validateApiKeyCandidate({ provider: "custom", apiKey: syntheticKey, baseURL: "https://example.test/api/v1/" });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("provider connection persistence", () => {
  it.each(API_KEY_PROVIDERS)("validates and restores $label", ({ id, label }) => {
    const connection = id === "custom" ? custom() : validateApiKeyCandidate({ provider: id, apiKey: `  ${syntheticKey}  ` });
    saveBrowserConnection(connection);
    expect(readBrowserConnection()).toEqual(connection);
    expect(connection.apiKey).toBe(syntheticKey);
    expect(isApiKeyConnection(connection)).toBe(true);
    expect(providerLabel(id)).toBe(label);
    expect(providerBaseURL(connection)).toMatch(/^https:/);
    expect(connectionCredential(connection)).toMatchObject({ kind: id === "openai" ? "openai" : "api-key" });
  });
  it("keeps legacy and disconnected state meanings", () => {
    expect(readBrowserConnection()).toBeUndefined();
    for (const provider of ["devneya", "local-codex"] as const) {
      saveBrowserConnection({ provider });
      expect(readBrowserConnection()).toEqual({ provider });
    }
    saveBrowserConnection(null);
    expect(readBrowserConnection()).toBeNull();
    expect(providerLabel("devneya")).toBe("Devneya");
    expect(providerLabel("local-codex")).toBe("Local Codex");
    expect(isApiKeyConnection(null)).toBe(false);
    expect(isApiKeyProvider("unknown")).toBe(false);
  });
  it.each(["bad-json", "null", "[]", "{}", '{"provider":"unknown"}', '{"provider":"openai"}', '{"provider":"groq","apiKey":12}', '{"provider":"custom","apiKey":"synthetic"}', '{"provider":"custom","apiKey":"synthetic","baseURL":"http://localhost"}', '{"provider":"google","apiKey":""}'])("safely ignores malformed saved connection %s", (raw) => {
    localStorage.setItem(CONNECTION_STORAGE_KEY, raw);
    expect(readBrowserConnection()).toBeUndefined();
  });
  it("reports unavailable storage without overwriting the old connection", () => {
    saveBrowserConnection(custom());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("synthetic quota"); });
    expect(() => saveBrowserConnection(null)).toThrow("Unable to save the connection");
    expect(readBrowserConnection()).toEqual(custom());
  });
  it("safely handles unavailable read and write access", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("synthetic storage"); });
    expect(readBrowserConnection()).toBeUndefined();
    vi.stubGlobal("localStorage", undefined);
    expect(readBrowserConnection()).toBeUndefined();
    expect(() => saveBrowserConnection(null)).toThrow("Unable to save");
  });
  it.each([null, "", " ", "synthetic\n", "synthetic\rkey"])("rejects invalid header credentials", (key) => {
    expect(() => toProviderApiKey(key)).toThrow();
    expect(() => toOpenAIApiKey(key)).toThrow();
  });
  it("rejects unknown candidate providers", () => {
    expect(() => validateApiKeyCandidate({ provider: "unknown", apiKey: syntheticKey } as never)).toThrow("supported");
  });
});

describe("custom endpoint validation", () => {
  it("retains base paths and HTTPS ports without guessing a version", () => {
    expect(validateCustomBaseURL(" https://example.test/api/// ")).toBe("https://example.test/api");
    expect(validateCustomBaseURL("https://example.test:8443")).toBe("https://example.test:8443");
  });
  it.each([undefined, "", "/relative", "not a url", "http://localhost:11434/v1", "https://user:key@example.test/v1", "https://example.test?key=synthetic", "https://example.test#section", "https://example.test?", "https://example.test#", "https://example.test/v1/models/", "https://example.test/v1/chat/completions"])("rejects invalid or endpoint-specific URL %s", value => {
    expect(() => validateCustomBaseURL(value)).toThrow();
  });
});

describe("safe provider fetch", () => {
  it.each(["anthropic", "google", "groq"] as const)("places %s credentials in headers and enforces browser transport rules", async provider => {
    const connection = validateApiKeyCandidate({ provider, apiKey: syntheticKey });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchProviderJson(connection, "models", {}, new AbortController().signal)).resolves.toEqual({ ok: true });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain(syntheticKey);
    expect(options).toMatchObject({ mode: "cors", credentials: "omit", redirect: "error", headers: providerHeaders(connection) });
  });
  it("uses the exact custom base path and prevents escaping it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchProviderJson(custom(), "models", {}, new AbortController().signal);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://example.test/api/v1/models");
    await expect(fetchProviderJson(custom(), "../../outside", {}, new AbortController().signal)).rejects.toMatchObject({ kind: "invalid_response" });
    await expect(fetchProviderJson(custom(), "models#fragment", {}, new AbortController().signal)).rejects.toMatchObject({ kind: "invalid_response" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429, 400, 503])("never exposes an upstream credential echo at HTTP %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: `echo ${syntheticKey}` } }, { status })));
    const failure = await fetchProviderJson(custom(), "models", {}, new AbortController().signal).catch(error => error);
    expect(failure).toMatchObject({ kind: "http", status });
    expect((failure as Error).message).not.toContain(syntheticKey);
    expect((failure as Error).message).not.toContain("echo");
  });
  it("classifies malformed JSON separately from network failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("invalid-json"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchProviderJson(custom(), "models", {}, new AbortController().signal)).rejects.toMatchObject({ kind: "invalid_response" });
    fetchMock.mockRejectedValue(new Error(`network echo ${syntheticKey}`));
    await expect(fetchProviderJson(custom(), "models", {}, new AbortController().signal)).rejects.toMatchObject({ kind: "network", message: "Provider request failed. Check the network and browser CORS support." });
  });
  it("refuses already cancelled requests and preserves in-flight cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("Stopped", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchProviderJson(custom(), "models", {}, controller.signal)).rejects.toMatchObject({ kind: "aborted" });
    expect(fetchMock).not.toHaveBeenCalled();
    const active = new AbortController();
    fetchMock.mockImplementation(() => { active.abort(); throw new TypeError("cancelled"); });
    await expect(fetchProviderJson(custom(), "models", {}, active.signal)).rejects.toMatchObject({ kind: "aborted" });
  });
});
