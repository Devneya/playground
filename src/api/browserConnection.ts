import { toOpenAIApiKey, type OpenAIApiKey } from "./credentials";

export const CONNECTION_STORAGE_KEY = "devneya-playground-connection";

export type BrowserConnection =
  | { provider: "devneya" }
  | { provider: "openai"; apiKey: OpenAIApiKey }
  | { provider: "local-codex" };

// Connection credentials are separate from GoTrue sessions and workspace exports.
// undefined means no previous choice; null means the person disconnected.
export const readBrowserConnection = (): BrowserConnection | null | undefined => {
  try {
    const raw = globalThis.localStorage?.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("provider" in value)) return undefined;
    if (value.provider === null) return null;
    if (value.provider === "devneya" || value.provider === "local-codex") return { provider: value.provider };
    if (value.provider === "openai" && "apiKey" in value) return { provider: "openai", apiKey: toOpenAIApiKey(value.apiKey) };
  } catch { /* Malformed or unavailable browser storage returns to setup. */ }
  return undefined;
};

export const saveBrowserConnection = (connection: BrowserConnection | null): void => {
  try {
    if (!globalThis.localStorage) throw new Error("Storage unavailable.");
    globalThis.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(connection ?? { provider: null }));
  } catch {
    throw new Error("Unable to save the connection in this browser. Allow browser storage, then try again.");
  }
};
