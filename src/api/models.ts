import { config, apiUrl } from "../config";
import { fetchJson } from "./http";
import { modelListSchema } from "../domain/schemas";
import type { Model } from "../domain/types";
import { ApiError } from "./errors";

export const listModels = async (signal?: AbortSignal): Promise<Model[]> => {
  const body = await fetchJson(apiUrl("llm/v1/models"), { headers: { Accept: "application/json" } }, config.catalogTimeoutMs, signal);
  const parsed = modelListSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("invalid_response", "The model catalog response was invalid.");
  const unique = new Map(parsed.data.data.map((model) => [model.id, model]));
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
};
