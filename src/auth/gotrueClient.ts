import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import { apiBaseUrl, gotrueAnonKey } from "../config";

export const AUTH_STORAGE_KEY = "devneya-playground-auth";
const AUTH_STORAGE_PREFIX = `${AUTH_STORAGE_KEY}:`;

const storage: SupportedStorage = {
  getItem(key) {
    return globalThis.localStorage?.getItem(`${AUTH_STORAGE_PREFIX}${key}`) ?? null;
  },
  setItem(key, value) {
    globalThis.localStorage?.setItem(`${AUTH_STORAGE_PREFIX}${key}`, value);
  },
  removeItem(key) {
    globalThis.localStorage?.removeItem(`${AUTH_STORAGE_PREFIX}${key}`);
  },
};

const rewriteAuthUrl = (input: RequestInfo | URL): RequestInfo | URL => {
  const inputUrl = input instanceof Request ? input.url : input.toString();
  const url = new URL(inputUrl, globalThis.location?.origin ?? apiBaseUrl);
  const base = new URL(apiBaseUrl);
  if (url.origin === base.origin && (url.pathname === "/auth/v1" || url.pathname.startsWith("/auth/v1/"))) {
    url.pathname = url.pathname.replace(/^\/auth\/v1/, "/auth");
  }
  if (input instanceof Request) return new Request(url, input);
  return url;
};

const authFetch: typeof fetch = (input, init) => globalThis.fetch(rewriteAuthUrl(input), init);

export const supabase = createClient(apiBaseUrl, gotrueAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    storageKey: AUTH_STORAGE_KEY,
    storage,
  },
  global: { fetch: authFetch },
});

export const clearAuthStorage = () => {
  const localStorage = globalThis.localStorage;
  if (!localStorage) return;
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
    (key): key is string => key !== null && key.startsWith(AUTH_STORAGE_PREFIX),
  );
  keys.forEach((key) => localStorage.removeItem(key));
};
