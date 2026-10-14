import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ApiError } from "../../src/api/errors";
import { createOpenAIChatCompletion, listOpenAIModels } from "../../src/api/openai";
import type { ChatCompletionRequest } from "../../src/api/completions";

const server = setupServer();
const apiKey = "openai-test-token";
const modelsUrl = "https://api.openai.com/v1/models";
const completionsUrl = "https://api.openai.com/v1/chat/completions";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("OpenAI API adapter", () => {
  it("authenticates the live model catalog, accepts provider metadata, and sorts/deduplicates models", async () => {
    let requests = 0;
    server.use(http.get(modelsUrl, ({ request }) => {
      requests += 1;
      expect(request.headers.get("authorization")).toBe(`Bearer ${apiKey}`);
      expect(request.headers.get("accept")).toBe("application/json");
      return HttpResponse.json({ object: "list", data: [
        { id: "zeta-preview", object: "model", created: 2, owned_by: "openai-internal", root: "zeta-preview", permission: [] },
        { id: "alpha-preview", object: "model", created: 1, owned_by: "organization-a", parent: null },
        { id: "alpha-preview", object: "model", created: 1, owned_by: "organization-a", parent: null },
      ] });
    }));

    const models = await listOpenAIModels(apiKey);
    expect(requests).toBe(1);
    expect(models.map(({ id, owned_by }) => [id, owned_by])).toEqual([
      ["alpha-preview", "organization-a"],
      ["zeta-preview", "openai-internal"],
    ]);
  });

  it("rejects a malformed model catalog", async () => {
    server.use(http.get(modelsUrl, () => HttpResponse.json({ object: "list", data: [{ id: "missing-fields" }] })));
    await expect(listOpenAIModels(apiKey)).rejects.toMatchObject({
      kind: "invalid_response",
      message: "The OpenAI model catalog response was invalid.",
    });
  });

  it("does not expose an invalid API key echoed by an authentication error", async () => {
    server.use(http.get(modelsUrl, () => HttpResponse.json({
      error: { message: `Invalid credential ${apiKey}`, code: "invalid_api_key" },
    }, { status: 401 })));

    let caught: unknown;
    try { await listOpenAIModels(apiKey); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ kind: "http", status: 401, code: "invalid_api_key", message: "OpenAI rejected the API key." });
    expect((caught as Error).message).not.toContain(apiKey);
  });

  it("uses the selected model and maps instructions, reasoning effort, images, and files", async () => {
    server.use(http.post(completionsUrl, async ({ request }) => {
      expect(request.headers.get("authorization")).toBe(`Bearer ${apiKey}`);
      expect(request.headers.get("content-type")).toContain("application/json");
      const body = await request.json() as {
        model: string;
        stream: boolean;
        reasoning_effort?: string;
        messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
      };
      expect(body).toEqual({
        model: "user-selected-model",
        stream: false,
        reasoning_effort: "medium",
        messages: [
          { role: "system", content: "Keep the answer concise." },
          { role: "user", content: [
            { type: "text", text: "Describe these attachments." },
            { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
            { type: "file", file: { filename: "brief.pdf", file_data: "data:application/pdf;base64,JVBERi0x" } },
          ] },
          { role: "assistant", content: "Earlier answer" },
        ],
      });
      return HttpResponse.json({ choices: [{ message: { content: "A concise answer." } }], usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
      } });
    }));

    const request: ChatCompletionRequest = {
      model: "user-selected-model",
      stream: false,
      reasoning_effort: "medium",
      instructions: "Keep the answer concise.",
      messages: [
        { role: "user", content: "Describe these attachments.", files: [
          { name: "picture.png", mimeType: "image/png", size: 1, dataUrl: "data:image/png;base64,AA==" },
          { name: "brief.pdf", mimeType: "application/pdf", size: 1, dataUrl: "data:application/pdf;base64,JVBERi0x" },
        ] },
        { role: "assistant", content: "Earlier answer" },
      ],
    };
    await expect(createOpenAIChatCompletion(apiKey, request)).resolves.toEqual({
      content: "A concise answer.",
      usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
    });
  });

  it("omits absent instructions and reasoning effort, and ignores invalid usage values", async () => {
    server.use(http.post(completionsUrl, async ({ request }) => {
      expect(await request.json()).toEqual({
        model: "picked-model",
        stream: false,
        messages: [{ role: "user", content: "Hi" }],
      });
      return HttpResponse.json({ choices: [{ message: { content: "Hello" } }], usage: {
        prompt_tokens: -1,
        completion_tokens: "invalid",
        total_tokens: 0,
      } });
    }));

    await expect(createOpenAIChatCompletion(apiKey, {
      model: "picked-model",
      stream: false,
      messages: [{ role: "user", content: "Hi" }],
    })).resolves.toEqual({ content: "Hello", usage: { totalTokens: 0 } });
  });

  it.each([
    ["null body", null],
    ["missing choices", {}],
    ["missing message", { choices: [{}] }],
    ["non-text message content", { choices: [{ message: { content: [{ type: "text", text: "no" }] } }] }],
  ])("rejects malformed completion response: %s", async (_label, response) => {
    server.use(http.post(completionsUrl, () => HttpResponse.json(response)));
    await expect(createOpenAIChatCompletion(apiKey, {
      model: "picked-model",
      stream: false,
      messages: [{ role: "user", content: "Hi" }],
    })).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("redacts the key from other OpenAI HTTP errors", async () => {
    server.use(http.post(completionsUrl, () => HttpResponse.json({
      error: { message: `Temporary error for ${apiKey}`, code: `upstream-${apiKey}` },
    }, { status: 503 })));

    let caught: unknown;
    try {
      await createOpenAIChatCompletion(apiKey, {
        model: "picked-model",
        stream: false,
        messages: [{ role: "user", content: "Hi" }],
      });
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ kind: "http", status: 503, message: "Temporary error for [redacted]", code: "upstream-[redacted]" });
    expect((caught as Error).message).not.toContain(apiKey);
    expect((caught as ApiError).code).not.toContain(apiKey);
  });
});
