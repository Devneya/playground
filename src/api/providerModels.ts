import type { Model } from "../domain/types";
import { ApiError } from "./errors";
import { listOpenAIModels } from "./openai";
import { fetchProviderJson } from "./providerHttp";
import { withProviderOperation } from "./providerOperation";
import type { ApiKeyConnection, NewApiKeyConnection } from "./credentials";

const CATALOG_TIMEOUT_MS = 20_000;
const MAX_CATALOG_PAGES = 10;

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const invalidCatalog = (): ApiError => new ApiError("invalid_response", "The provider model catalog response was invalid.");

const normalizeModels = (items: unknown[], provider: string): Model[] => {
  const unique = new Map<string, Model>();
  for (const item of items) {
    const raw = recordOf(item);
    const id = raw?.id;
    if (!raw || typeof id !== "string" || !id.trim()) throw invalidCatalog();
    const normalizedId = id.trim();
    const model: Model = {
      id: normalizedId,
      object: "model",
      created: typeof raw.created === "number" && Number.isFinite(raw.created) ? raw.created : 0,
      owned_by: typeof raw.owned_by === "string" && raw.owned_by.trim() ? raw.owned_by : provider,
    };
    unique.set(normalizedId, model);
  }
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
};

const compatiblePage = (value: unknown): unknown[] => {
  const record = recordOf(value);
  if (!record || !Array.isArray(record.data)) throw invalidCatalog();
  return record.data;
};

const anthropicModels = async (connection: NewApiKeyConnection, signal: AbortSignal): Promise<Model[]> => {
  const items: unknown[] = [];
  const cursors = new Set<string>();
  let afterId: string | undefined;

  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (afterId) query.set("after_id", afterId);
    const body = await fetchProviderJson(connection, `models?${query.toString()}`, { method: "GET" }, signal);
    const record = recordOf(body);
    if (!record || !Array.isArray(record.data) || typeof record.has_more !== "boolean") throw invalidCatalog();
    items.push(...record.data);
    if (!record.has_more) return normalizeModels(items, connection.provider);
    if (typeof record.last_id !== "string" || !record.last_id.trim() || cursors.has(record.last_id)) throw invalidCatalog();
    cursors.add(record.last_id);
    afterId = record.last_id;
  }

  throw invalidCatalog();
};

const googleModels = async (connection: NewApiKeyConnection, signal: AbortSignal): Promise<Model[]> => {
  const items: unknown[] = [];
  const cursors = new Set<string>();
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const query = new URLSearchParams({ pageSize: "1000" });
    if (pageToken) query.set("pageToken", pageToken);
    const body = await fetchProviderJson(connection, `models?${query.toString()}`, { method: "GET" }, signal);
    const record = recordOf(body);
    if (!record || !Array.isArray(record.models)) throw invalidCatalog();
    const usable = record.models.flatMap((item) => {
      const raw = recordOf(item);
      const name = raw?.name;
      const methods = raw?.supportedGenerationMethods;
      if (!raw || typeof name !== "string" || !name.trim() || !Array.isArray(methods) || !methods.every((method) => typeof method === "string")) throw invalidCatalog();
      if (!methods.includes("generateContent")) return [];
      return [{ ...raw, id: name.replace(/^models\//, "") }];
    });
    items.push(...usable);

    if (record.nextPageToken === undefined || record.nextPageToken === "") return normalizeModels(items, connection.provider);
    if (typeof record.nextPageToken !== "string" || cursors.has(record.nextPageToken)) throw invalidCatalog();
    cursors.add(record.nextPageToken);
    pageToken = record.nextPageToken;
  }

  throw invalidCatalog();
};

const listCompatibleModels = async (connection: NewApiKeyConnection, signal: AbortSignal): Promise<Model[]> => {
  if (connection.provider === "anthropic") return anthropicModels(connection, signal);
  if (connection.provider === "google") return googleModels(connection, signal);

  if (connection.provider === "openrouter") {
    const keyBody = recordOf(await fetchProviderJson(connection, "key", { method: "GET" }, signal));
    if (!keyBody || !recordOf(keyBody.data)) throw invalidCatalog();
  }

  const body = await fetchProviderJson(connection, "models", { method: "GET" }, signal);
  const models = normalizeModels(compatiblePage(body), connection.provider);
  if (!models.length) throw invalidCatalog();
  return models;
};

export const listProviderModels = async (connection: ApiKeyConnection, signal?: AbortSignal): Promise<Model[]> => {
  if (connection.provider === "openai") {
    const models = await listOpenAIModels(connection.apiKey, signal);
    if (!models.length) throw invalidCatalog();
    return models;
  }
  return withProviderOperation(signal, CATALOG_TIMEOUT_MS, (combinedSignal) => listCompatibleModels(connection, combinedSignal))
    .then((models) => {
      if (!models.length) throw invalidCatalog();
      return models;
    });
};
