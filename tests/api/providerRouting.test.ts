import { afterEach, expect, it, vi } from "vitest";
import { API_KEY_PROVIDERS, connectionCredential, providerBaseURL, validateApiKeyCandidate } from "../../src/api/apiKeyProviders";
import { createChatCompletion } from "../../src/api/completions";
import { streamCompletion } from "../../src/api/streamCompletion";

const request = { model: "selected-model", messages: [{ role: "user" as const, content: "Hello" }], stream: false as const };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(API_KEY_PROVIDERS)("routes $label through its browser adapter with local Codex disabled", async ({ id }) => {
  const connection = validateApiKeyCandidate(id === "custom" ? { provider: id, apiKey: "synthetic-routing-key", baseURL: "https://custom.example/api/v1" } : { provider: id, apiKey: "synthetic-routing-key" });
  const body = id === "anthropic" ? { content: [{ type: "text", text: "Answer" }] }
    : id === "google" ? { candidates: [{ content: { parts: [{ text: "Answer" }] } }] }
      : { choices: [{ message: { content: "Answer" } }] };
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json(body)));
  vi.stubGlobal("fetch", fetcher);
  const credential = connectionCredential(connection);
  await expect(createChatCompletion(credential, request)).resolves.toEqual({ content: "Answer" });
  const delta = vi.fn(), progress = vi.fn();
  await expect(streamCompletion(credential, request, new AbortController().signal, delta, progress)).resolves.toEqual({ content: "Answer" });
  expect(delta).toHaveBeenCalledWith("Answer");
  expect(progress).toHaveBeenCalledWith({ text: "Waiting for the model", characters: 0 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url] of fetcher.mock.calls) expect(String(url)).toMatch(new RegExp(`^${providerBaseURL(connection).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`));
});
