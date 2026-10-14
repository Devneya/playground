import { delay, http, HttpResponse, type HttpHandler } from "msw";
import { consumeCatalogFailure, consumeKeyFailure, getMockScenario, nextCompletionNumber } from "./scenario";

const errorResponse = (status: number, code: string, error: string) => HttpResponse.json({ code, error }, { status });
const OPENAI_TEST_KEY = "synthetic-openai-browser-key";
const OPENAI_CHAT_MODEL = "gpt-mock-chat";
const OPENAI_MODELS = [OPENAI_CHAT_MODEL, "text-embedding-mock"];
const openAIUnauthorized = () => errorResponse(401, "invalid_api_key", "The synthetic OpenAI test key is required.");

type ProviderFixture = {
  id: "anthropic" | "google" | "openrouter" | "groq" | "mistral" | "deepseek" | "custom";
  label: string;
  catalogURL: string;
  completionURL: string;
  apiKey: string;
  modelId: string;
  catalogFormat: "anthropic" | "google" | "compatible";
  completionFormat: "anthropic" | "google" | "compatible";
  publicCatalog?: boolean;
};

const providerFixtures: ProviderFixture[] = [
  { id: "anthropic", label: "Anthropic", catalogURL: "https://api.anthropic.com/v1/models", completionURL: "https://api.anthropic.com/v1/messages", apiKey: "synthetic-anthropic-browser-key", modelId: "claude-mock-chat", catalogFormat: "anthropic", completionFormat: "anthropic" },
  { id: "google", label: "Google Gemini", catalogURL: "https://generativelanguage.googleapis.com/v1beta/models", completionURL: "https://generativelanguage.googleapis.com/v1beta/models/gemini-mock-chat:generateContent", apiKey: "synthetic-google-browser-key", modelId: "gemini-mock-chat", catalogFormat: "google", completionFormat: "google" },
  { id: "openrouter", label: "OpenRouter", catalogURL: "https://openrouter.ai/api/v1/models", completionURL: "https://openrouter.ai/api/v1/chat/completions", apiKey: "synthetic-openrouter-browser-key", modelId: "openrouter/mock-chat", catalogFormat: "compatible", completionFormat: "compatible", publicCatalog: true },
  { id: "groq", label: "Groq", catalogURL: "https://api.groq.com/openai/v1/models", completionURL: "https://api.groq.com/openai/v1/chat/completions", apiKey: "synthetic-groq-browser-key", modelId: "groq-mock-chat", catalogFormat: "compatible", completionFormat: "compatible" },
  { id: "mistral", label: "Mistral", catalogURL: "https://api.mistral.ai/v1/models", completionURL: "https://api.mistral.ai/v1/chat/completions", apiKey: "synthetic-mistral-browser-key", modelId: "mistral-mock-chat", catalogFormat: "compatible", completionFormat: "compatible" },
  { id: "deepseek", label: "DeepSeek", catalogURL: "https://api.deepseek.com/models", completionURL: "https://api.deepseek.com/chat/completions", apiKey: "synthetic-deepseek-browser-key", modelId: "deepseek-mock-chat", catalogFormat: "compatible", completionFormat: "compatible" },
  { id: "custom", label: "Custom OpenAI-compatible", catalogURL: "https://custom-provider.example/api/v1/models", completionURL: "https://custom-provider.example/api/v1/chat/completions", apiKey: "synthetic-custom-browser-key", modelId: "custom-mock-chat", catalogFormat: "compatible", completionFormat: "compatible" },
];

const isAuthorized = (provider: ProviderFixture, request: Request): boolean => {
  if (provider.publicCatalog && request.method === "GET") return true;
  const header = provider.id === "anthropic" ? "x-api-key" : provider.id === "google" ? "x-goog-api-key" : "authorization";
  const value = request.headers.get(header);
  return header === "authorization" ? value === `Bearer ${provider.apiKey}` : value === provider.apiKey;
};

const providerUnauthorized = (provider: ProviderFixture) => errorResponse(401, "invalid_api_key", `Synthetic ${provider.label} test credentials are required.`);
const catalogError = () => {
  const scenario = getMockScenario();
  if (scenario.catalogStatus || consumeCatalogFailure()) return errorResponse(scenario.catalogStatus ?? 503, "catalog_unavailable", "The provider model catalog is unavailable.");
  if (scenario.invalidCatalog) return HttpResponse.json({ error: "invalid_catalog" });
  return null;
};

const modelRows = (modelIds: string[], owner: string) => modelIds.map((id, index) => ({ id, object: "model", created: 1_700_100_000 + index, owned_by: owner }));
const providerCatalogResponse = (provider: ProviderFixture): Response => {
  const failure = catalogError();
  if (failure) return failure;
  if (provider.catalogFormat === "anthropic") return HttpResponse.json({
    data: [{ id: provider.modelId, type: "model", display_name: "Synthetic Claude", created_at: "2025-01-01T00:00:00Z" }],
    has_more: false,
  });
  if (provider.catalogFormat === "google") return HttpResponse.json({
    models: [
      { name: `models/${provider.modelId}`, displayName: "Synthetic Gemini", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-mock-embedding", supportedGenerationMethods: ["embedContent"] },
    ],
  });
  const ids = provider.id === "openrouter" ? [provider.modelId, "openrouter/mock-embedding"] : [provider.modelId, `${provider.id}-mock-embedding`];
  return HttpResponse.json({ object: "list", data: modelRows(ids, provider.id) });
};

const completionFailure = (model: string): Response | null => {
  const scenario = getMockScenario();
  if (scenario.completionStatus) return errorResponse(scenario.completionStatus, "completion_failed", "The completion request failed.");
  if (scenario.failModels.includes(model)) return errorResponse(502, "provider_failed", `The provider failed for ${model}.`);
  return null;
};

const respondCompletion = async (provider: ProviderFixture, request: Request): Promise<Response> => {
  const scenario = getMockScenario();
  const body = await request.json().catch(() => ({})) as { model?: string };
  const model = typeof body.model === "string" ? body.model : provider.modelId;
  const waitMs = scenario.delays[model] ?? scenario.delayMs;
  if (waitMs > 0) await delay(waitMs);
  const failure = completionFailure(model);
  if (failure) return failure;
  const number = nextCompletionNumber();
  const result = `${provider.label} mock result ${number} from ${model}.`;
  if (provider.completionFormat === "anthropic") return HttpResponse.json({
    id: `mock-${provider.id}-${number}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: result }],
    stop_reason: "end_turn",
    usage: { input_tokens: 12, output_tokens: 8 },
  });
  if (provider.completionFormat === "google") return HttpResponse.json({
    candidates: [{ content: { role: "model", parts: [{ text: result }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 },
  });
  return HttpResponse.json({
    id: `mock-${provider.id}-completion-${number}`,
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content: result }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  });
};

const providerHandlers: HttpHandler[] = providerFixtures.flatMap((provider) => [
  http.get(provider.catalogURL, ({ request }) => {
    const url = new URL(request.url);
    if (provider.id === "anthropic" && url.searchParams.get("limit") !== "100") return errorResponse(400, "invalid_request", "The synthetic Anthropic fixture requires limit=100.");
    if (provider.id === "google" && url.searchParams.get("pageSize") !== "1000") return errorResponse(400, "invalid_request", "The synthetic Gemini fixture requires pageSize=1000.");
    if (!isAuthorized(provider, request)) return providerUnauthorized(provider);
    return providerCatalogResponse(provider);
  }),
  http.post(provider.completionURL, async ({ request }) => {
    if (!isAuthorized(provider, request)) return providerUnauthorized(provider);
    return respondCompletion(provider, request);
  }),
]);

const hostCatchalls: HttpHandler[] = [
  http.all("https://api.openai.com/*", () => HttpResponse.error()),
  http.all("https://api.anthropic.com/*", () => HttpResponse.error()),
  http.all("https://generativelanguage.googleapis.com/*", () => HttpResponse.error()),
  http.all("https://openrouter.ai/*", () => HttpResponse.error()),
  http.all("https://api.groq.com/*", () => HttpResponse.error()),
  http.all("https://api.mistral.ai/*", () => HttpResponse.error()),
  http.all("https://api.deepseek.com/*", () => HttpResponse.error()),
  http.all("https://custom-provider.example/*", () => HttpResponse.error()),
];

export const handlers = [
  http.get("https://api.openai.com/v1/models", ({ request }) => {
    if (request.headers.get("authorization") !== `Bearer ${OPENAI_TEST_KEY}`) return openAIUnauthorized();
    const failure = catalogError();
    if (failure) return failure;
    return HttpResponse.json({ object: "list", data: modelRows(OPENAI_MODELS, "openai-test") });
  }),
  http.post("https://api.openai.com/v1/chat/completions", async ({ request }) => {
    if (request.headers.get("authorization") !== `Bearer ${OPENAI_TEST_KEY}`) return openAIUnauthorized();
    const body = await request.json().catch(() => ({})) as { model?: string };
    const model = typeof body.model === "string" ? body.model : "unknown-model";
    const scenario = getMockScenario();
    const waitMs = scenario.delays[model] ?? scenario.delayMs;
    if (waitMs > 0) await delay(waitMs);
    const failure = completionFailure(model);
    if (failure) return failure;
    if (model !== OPENAI_CHAT_MODEL) return errorResponse(404, "model_not_found", `The synthetic OpenAI catalog has no chat model named ${model}.`);
    const number = nextCompletionNumber();
    return HttpResponse.json({
      id: `mock-openai-completion-${number}`,
      object: "chat.completion",
      model,
      choices: [{ index: 0, message: { role: "assistant", content: `OpenAI mock result ${number} from ${model}.` }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    });
  }),
  http.get("https://openrouter.ai/api/v1/key", ({ request }) => {
    if (request.headers.get("authorization") !== `Bearer ${providerFixtures.find(({ id }) => id === "openrouter")!.apiKey}`) {
      return errorResponse(401, "invalid_api_key", "The synthetic OpenRouter test key is required.");
    }
    return HttpResponse.json({ data: { label: "Synthetic browser key" } });
  }),
  ...providerHandlers,
  ...hostCatchalls,
  http.get("*/llm/v1/models", () => {
    const scenario = getMockScenario();
    if (scenario.catalogStatus || consumeCatalogFailure()) return errorResponse(scenario.catalogStatus ?? 503, "catalog_unavailable", "The model catalog is unavailable.");
    if (scenario.invalidCatalog) return HttpResponse.json({ object: "list", data: [{ id: 42 }] });
    return HttpResponse.json({
      object: "list",
      data: scenario.models.map((id, index) => ({ id, object: "model", created: 1_700_000_000 + index, owned_by: "devneya" })),
    });
  }),
  http.get("*/account/key", () => {
    const scenario = getMockScenario();
    if (scenario.keyStatus || consumeKeyFailure()) return errorResponse(scenario.keyStatus ?? 403, "virtual_key_blocked", "The account key is unavailable.");
    return HttpResponse.json({ key: "sk-bf-mock-key-for-tests-only" });
  }),
  http.post("*/llm/v1/chat/completions", async ({ request }) => {
    const scenario = getMockScenario();
    const body = await request.json().catch(() => ({})) as { model?: string };
    const model = typeof body.model === "string" ? body.model : "unknown-model";
    const waitMs = scenario.delays[model] ?? scenario.delayMs;
    if (waitMs > 0) await delay(waitMs);
    const failure = completionFailure(model);
    if (failure) return failure;
    if (scenario.invalidCompletion) return HttpResponse.json({ choices: [] });
    const number = nextCompletionNumber();
    return HttpResponse.json({
      id: `mock-completion-${number}`,
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: `Mock result ${number} from ${model}.` }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    });
  }),
];
