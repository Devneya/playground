export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "https://api.devneya.com").replace(/\/+$/, "");
const parseBoolean = (value: unknown) => value === "true";

export const gotrueAnonKey = import.meta.env.VITE_GOTRUE_ANON_KEY || "devneya-playground-test-anon-key";

export const config = {
  apiBaseUrl,
  gotrueAnonKey,
  useMocks: parseBoolean(import.meta.env.VITE_USE_MOCKS),
  playgroundOrigin: window.location.origin,
  catalogTimeoutMs: 15_000,
  accountTimeoutMs: 15_000,
  completionTimeoutMs: 120_000,
} as const;

export const apiUrl = (path: string) => `${config.apiBaseUrl}/${path.replace(/^\/+/, "")}`;
