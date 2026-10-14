import { createClient, type SupportedStorage } from "@supabase/supabase-js";

export const AUTH_STORAGE_KEY = "devneya-playground-auth";

export type GoTrueClientOptions = {
  baseUrl: string;
  clientKey: string;
  storage: SupportedStorage;
  fetch?: typeof globalThis.fetch;
};

export type GoTrueFetchOptions = Pick<GoTrueClientOptions, "baseUrl" | "fetch">;

const rewriteAuthPath = (url: URL, baseUrl: string): URL => {
  const apiOrigin = new URL(baseUrl).origin;
  if (url.origin === apiOrigin && (url.pathname === "/auth/v1" || url.pathname.startsWith("/auth/v1/"))) {
    url.pathname = url.pathname.replace(/^\/auth\/v1/, "/auth");
  }
  return url;
};

export const rewriteGoTrueAuthUrl = (input: string, baseUrl: string): string =>
  rewriteAuthPath(new URL(input, baseUrl), baseUrl).toString();

const rewriteAuthUrl = (input: RequestInfo | URL, baseUrl: string): RequestInfo | URL => {
  const inputUrl = input instanceof Request ? input.url : input.toString();
  const resolutionBase = globalThis.location?.origin ?? baseUrl;
  const url = rewriteAuthPath(new URL(inputUrl, resolutionBase), baseUrl);
  if (input instanceof Request) {
    const request = input.clone();
    const requestInit: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers: request.headers,
      signal: request.signal,
      cache: request.cache,
      credentials: request.credentials,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
    };
    if (request.body) {
      requestInit.body = request.body;
      requestInit.duplex = "half";
    }
    return new Request(url, requestInit);
  }
  return url;
};

export const createGoTrueFetch = ({ baseUrl, fetch: fetchOverride }: GoTrueFetchOptions): typeof globalThis.fetch =>
  (input, init) => {
    const fetchImplementation = fetchOverride ?? globalThis.fetch;
    return fetchImplementation.call(globalThis, rewriteAuthUrl(input, baseUrl), init);
  };

export const createGoTrueClient = ({ baseUrl, clientKey, storage, fetch: fetchOverride }: GoTrueClientOptions) =>
  createClient(baseUrl, clientKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      storageKey: AUTH_STORAGE_KEY,
      storage,
    },
    global: { fetch: createGoTrueFetch({ baseUrl, ...(fetchOverride ? { fetch: fetchOverride } : {}) }) },
  });
