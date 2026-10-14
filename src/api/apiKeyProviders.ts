import type { ApiKeyProviderId, InferenceProvider } from "../domain/types";
import { toOpenAIApiKey, toProviderApiKey, type ApiKeyConnection, type CompletionCredential } from "./credentials";

export const API_KEY_PROVIDERS = [
  { id: "openai", label: "OpenAI", baseURL: "https://api.openai.com/v1" },
  { id: "anthropic", label: "Anthropic", baseURL: "https://api.anthropic.com/v1" },
  { id: "google", label: "Google Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "openrouter", label: "OpenRouter", baseURL: "https://openrouter.ai/api/v1" },
  { id: "groq", label: "Groq", baseURL: "https://api.groq.com/openai/v1" },
  { id: "mistral", label: "Mistral", baseURL: "https://api.mistral.ai/v1" },
  { id: "deepseek", label: "DeepSeek", baseURL: "https://api.deepseek.com" },
  { id: "custom", label: "Custom OpenAI-compatible", baseURL: "" },
] as const;

export const isApiKeyProvider = (value: unknown): value is ApiKeyProviderId => API_KEY_PROVIDERS.some(provider => provider.id === value);
export const providerLabel = (provider: InferenceProvider): string => provider === "devneya" ? "Devneya" : provider === "local-codex" ? "Local Codex" : API_KEY_PROVIDERS.find(item => item.id === provider)!.label;
export const isApiKeyConnection = (connection: { provider: InferenceProvider } | null | undefined): connection is ApiKeyConnection => Boolean(connection && isApiKeyProvider(connection.provider));

export const validateCustomBaseURL = (value: unknown): string => {
  const invalid = () => new Error("Enter an HTTPS API base URL without credentials, query parameters, or a fragment.");
  if (typeof value !== "string" || !value.trim()) throw invalid();
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw invalid(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#")) throw invalid();
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/(models|chat\/completions)$/i.test(path)) throw new Error("Enter the API base URL, not a models or chat/completions endpoint.");
  url.pathname = path;
  return url.toString().replace(/\/+$/, "");
};

export type ApiKeyCandidate = { provider: Exclude<ApiKeyProviderId, "custom">; apiKey: string } | { provider: "custom"; apiKey: string; baseURL: string };
export const validateApiKeyCandidate = (candidate: ApiKeyCandidate): ApiKeyConnection => {
  if (!isApiKeyProvider(candidate.provider)) throw new Error("Choose a supported API provider.");
  if (candidate.provider === "openai") return { provider: "openai", apiKey: toOpenAIApiKey(candidate.apiKey) };
  const apiKey = toProviderApiKey(candidate.apiKey);
  return candidate.provider === "custom" ? { provider: "custom", apiKey, baseURL: validateCustomBaseURL(candidate.baseURL) } : { provider: candidate.provider, apiKey };
};
export const providerBaseURL = (connection: ApiKeyConnection): string => connection.provider === "custom" ? validateCustomBaseURL(connection.baseURL) : API_KEY_PROVIDERS.find(item => item.id === connection.provider)!.baseURL;
export const providerHeaders = (connection: ApiKeyConnection): Record<string, string> => ({
  Accept: "application/json",
  ...(connection.provider === "anthropic" ? { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
    : connection.provider === "google" ? { "x-goog-api-key": connection.apiKey } : { Authorization: `Bearer ${connection.apiKey}` }),
});
export const connectionCredential = (connection: ApiKeyConnection): CompletionCredential => connection.provider === "openai" ? { kind: "openai", apiKey: connection.apiKey } : { kind: "api-key", connection };
