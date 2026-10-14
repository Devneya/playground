export type GoTrueAccessToken = string & { readonly __brand: "GoTrueAccessToken" };
export type BifrostVirtualKey = string & { readonly __brand: "BifrostVirtualKey" };
export type OpenAIApiKey = string & { readonly __brand: "OpenAIApiKey" };
export type ProviderApiKey = string & { readonly __brand: "ProviderApiKey" };

export const toGoTrueAccessToken = (value: unknown): GoTrueAccessToken => {
  if (typeof value !== "string" || value.length < 1) throw new Error("Missing GoTrue access token.");
  return value as GoTrueAccessToken;
};

export const toBifrostVirtualKey = (value: unknown): BifrostVirtualKey => {
  if (typeof value !== "string" || !value.startsWith("sk-bf-") || value.length <= 6) throw new Error("Invalid Bifrost virtual key.");
  return value as BifrostVirtualKey;
};

export const toOpenAIApiKey = (value: unknown): OpenAIApiKey => {
  if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error("Enter an OpenAI API key.");
  return value.trim() as OpenAIApiKey;
};

export const toProviderApiKey = (value: unknown): ProviderApiKey => {
  if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error("Enter an API key without line breaks.");
  return value.trim() as ProviderApiKey;
};

export type NewApiKeyConnection =
  | { provider: "anthropic" | "google" | "openrouter" | "groq" | "mistral" | "deepseek"; apiKey: ProviderApiKey }
  | { provider: "custom"; apiKey: ProviderApiKey; baseURL: string };
export type ApiKeyConnection = { provider: "openai"; apiKey: OpenAIApiKey } | NewApiKeyConnection;
export type CompletionCredential = BifrostVirtualKey | { readonly kind: "local-codex" } | { readonly kind: "openai"; readonly apiKey: OpenAIApiKey } | { readonly kind: "api-key"; readonly connection: NewApiKeyConnection };
