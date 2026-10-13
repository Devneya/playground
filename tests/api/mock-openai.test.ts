import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "../../src/mocks/handlers";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

describe("mock-only OpenAI boundary", () => {
  it("requires the synthetic bearer for both catalog and completions", async () => {
    const headers = { Authorization: "Bearer synthetic-rejected-key", "Content-Type": "application/json" };
    expect((await fetch("https://api.openai.com/v1/models", { headers })).status).toBe(401);
    expect((await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers, body: "{}" })).status).toBe(401);
  });

  it("fails unexpected OpenAI URLs even when they match broad Devneya fixture paths", async () => {
    for (const path of ["/v1/responses", "/llm/v1/models", "/account/key", "/llm/v1/chat/completions"]) {
      await expect(fetch(`https://api.openai.com${path}`)).rejects.toThrow();
    }
  });
});
