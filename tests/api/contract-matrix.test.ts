import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { getVirtualKey, revokeSession } from "../../src/api/account";
import { createChatCompletion } from "../../src/api/completions";
import { toBifrostVirtualKey, toGoTrueAccessToken } from "../../src/api/credentials";
import { errorFromResponse } from "../../src/api/errors";
import { fetchEmpty, fetchJson } from "../../src/api/http";
import { listModels } from "../../src/api/models";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); vi.unstubAllGlobals(); });
afterAll(() => server.close());

describe("API contract matrix", () => {
  it("rejects malformed account-key payloads and invalid credentials", async () => {
    server.use(http.get("https://api.devneya.com/account/key", () => HttpResponse.json(null)));
    await expect(getVirtualKey(toGoTrueAccessToken("jwt"))).rejects.toThrow("Invalid account-key response");

    server.use(http.get("https://api.devneya.com/account/key", () => HttpResponse.json({ key: "not-a-bifrost-key" })));
    await expect(getVirtualKey(toGoTrueAccessToken("jwt"))).rejects.toThrow("Invalid Bifrost virtual key");
    expect(() => toGoTrueAccessToken("" as unknown)).toThrow("Missing GoTrue access token");
    expect(() => toBifrostVirtualKey(undefined)).toThrow("Invalid Bifrost virtual key");
  });

  it("accepts a completion without usage and rejects every malformed text shape", async () => {
    server.use(http.post("https://api.devneya.com/llm/v1/chat/completions", () => HttpResponse.json({ choices: [{ message: { content: "without usage" } }], usage: null })));
    await expect(createChatCompletion(toBifrostVirtualKey("sk-bf-contract"), { model: "m", messages: [{ role: "user", content: "x" }], stream: false })).resolves.toEqual({ content: "without usage" });

    for (const body of [null, { choices: "not-an-array" }, { choices: [] }, { choices: [null] }, { choices: [{ message: null }] }, { choices: [{ message: { content: 123 } }] }]) {
      server.use(http.post("https://api.devneya.com/llm/v1/chat/completions", () => HttpResponse.json(body)));
      await expect(createChatCompletion(toBifrostVirtualKey("sk-bf-contract"), { model: "m", messages: [{ role: "user", content: "x" }], stream: false })).rejects.toMatchObject({ kind: "invalid_response" });
    }
  });

  it("rejects malformed model catalogs and preserves valid sorting", async () => {
    server.use(http.get("https://api.devneya.com/llm/v1/models", () => HttpResponse.json({ data: [{ id: "missing fields" }] })));
    await expect(listModels()).rejects.toMatchObject({ kind: "invalid_response" });
    server.use(http.get("https://api.devneya.com/llm/v1/models", () => HttpResponse.json({ object: "list", data: [] })));
    await expect(listModels()).resolves.toEqual([]);
  });

  it("maps non-json HTTP responses and empty logout responses", async () => {
    const responseError = await errorFromResponse(new Response("not json", { status: 418, statusText: "" }));
    expect(responseError).toMatchObject({ kind: "http", status: 418, message: "Request failed with status 418." });
    const detailFreeError = await errorFromResponse(Response.json({}, { status: 400 }));
    expect(detailFreeError).toMatchObject({ kind: "http", status: 400 });
    server.use(http.post("https://api.devneya.com/account/logout", () => new HttpResponse(null, { status: 204 })));
    await expect(revokeSession(toGoTrueAccessToken("jwt"))).resolves.toBeUndefined();
  });

  it("normalizes a non-abort network failure and fetchEmpty HTTP failure", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    await expect(fetchJson("https://example.test", {}, 1000)).rejects.toMatchObject({ kind: "network" });
    await expect(fetchEmpty("https://example.test", {}, 1000)).rejects.toMatchObject({ kind: "network" });
  });
});
