export const useLocalCodex = import.meta.env.DEV && import.meta.env.VITE_LOCAL_CODEX === "true";
export const apiBaseUrl = (useLocalCodex ? "/local-api" : import.meta.env.VITE_API_BASE_URL || "https://api.devneya.com").replace(/\/+$/, "");
const parseBoolean = (value: unknown) => value === "true";

export const gotrueAnonKey = import.meta.env.VITE_GOTRUE_ANON_KEY || (import.meta.env.MODE === "test" ? "test-public-anon-key" : "");

export const config = {
  apiBaseUrl,
  useLocalCodex,
  gotrueAnonKey,
  appOrigin: "https://app.devneya.com",
  useMocks: parseBoolean(import.meta.env.VITE_USE_MOCKS),
  playgroundOrigin: window.location.origin,
  catalogTimeoutMs: 15_000,
  accountTimeoutMs: 15_000,
  completionTimeoutMs: useLocalCodex ? 605_000 : 120_000,
} as const;

export const apiUrl = (path: string) => `${config.apiBaseUrl}/${path.replace(/^\/+/, "")}`;
