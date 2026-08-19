import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { listModels } from "../../src/api/models";
import { createChatCompletion } from "../../src/api/completions";
import { toBifrostVirtualKey } from "../../src/api/credentials";

const server = setupServer(
  http.get("https://api.devneya.com/llm/v1/models", () => HttpResponse.json({ object: "list", data: [
    { id: "zeta", object: "model", created: 1, owned_by: "devneya" },
    { id: "alpha", object: "model", created: 1, owned_by: "devneya" },
    { id: "alpha", object: "model", created: 1, owned_by: "devneya" },
  ] })),
  http.post("https://api.devneya.com/llm/v1/chat/completions", async ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer sk-bf-test");
    return HttpResponse.json({ choices: [{ message: { content: "done" } }], usage: { totalTokens: 3 } });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("production API adapters", () => {
  it("loads and deduplicates the live model catalog", async () => {
    await expect(listModels()).resolves.toEqual([
      { id: "alpha", object: "model", created: 1, owned_by: "devneya" },
      { id: "zeta", object: "model", created: 1, owned_by: "devneya" },
    ]);
  });

  it("sends only the branded Bifrost key to completions", async () => {
    await expect(createChatCompletion(toBifrostVirtualKey("sk-bf-test"), { model: "alpha", messages: [{ role: "user", content: "Hi" }], stream: false })).resolves.toEqual({ content: "done", usage: { totalTokens: 3 } });
  });

  it("rejects a key with the wrong credential prefix", () => {
    expect(() => toBifrostVirtualKey("jwt-value")).toThrow("Bifrost");
  });
});
