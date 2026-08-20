import { delay, http, HttpResponse } from "msw";
import { getMockScenario, nextCompletionNumber } from "./scenario";

const errorResponse = (status: number, code: string, error: string) => HttpResponse.json({ code, error }, { status });

export const handlers = [
  http.get("*/llm/v1/models", () => {
    const scenario = getMockScenario();
    if (scenario.catalogStatus) return errorResponse(scenario.catalogStatus, "catalog_unavailable", "The model catalog is unavailable.");
    return HttpResponse.json({
      object: "list",
      data: scenario.models.map((id, index) => ({ id, object: "model", created: 1_700_000_000 + index, owned_by: "devneya" })),
    });
  }),
  http.get("*/account/key", () => {
    const scenario = getMockScenario();
    if (scenario.keyStatus) return errorResponse(scenario.keyStatus, "virtual_key_blocked", "The account key is unavailable.");
    return HttpResponse.json({ key: "sk-bf-mock-key-for-tests-only" });
  }),
  http.post("*/llm/v1/chat/completions", async ({ request }) => {
    const scenario = getMockScenario();
    const body = await request.json().catch(() => ({})) as { model?: string };
    const model = typeof body.model === "string" ? body.model : "unknown-model";
    const waitMs = scenario.delays[model] ?? scenario.delayMs;
    if (waitMs > 0) await delay(waitMs);
    if (scenario.completionStatus) return errorResponse(scenario.completionStatus, "completion_failed", "The completion request failed.");
    if (scenario.failModels.includes(model)) return errorResponse(502, "provider_failed", `The provider failed for ${model}.`);
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
