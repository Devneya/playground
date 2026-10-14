import type { SupportedStorage } from "@supabase/supabase-js";
import { apiBaseUrl, config, gotrueAnonKey } from "../config";
import { AUTH_STORAGE_KEY, createGoTrueClient } from "./createGoTrueClient";

export { AUTH_STORAGE_KEY } from "./createGoTrueClient";

if (!gotrueAnonKey && !config.useMocks && import.meta.env.MODE !== "test") throw new Error("Missing VITE_GOTRUE_ANON_KEY for the production authentication client.");
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

export const supabase = createGoTrueClient({ baseUrl: apiBaseUrl, clientKey: gotrueAnonKey, storage });

export const clearAuthStorage = () => {
  const localStorage = globalThis.localStorage;
  if (!localStorage) return;
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
    (key): key is string => key !== null && key.startsWith(AUTH_STORAGE_PREFIX),
  );
  keys.forEach((key) => localStorage.removeItem(key));
};
