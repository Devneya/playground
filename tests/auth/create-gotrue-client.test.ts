// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupportedStorage } from "@supabase/supabase-js";
import { AUTH_STORAGE_KEY, createGoTrueClient, createGoTrueFetch, rewriteGoTrueAuthUrl } from "../../src/auth/createGoTrueClient";

const API_URL = "https://api.example.test";
const CLIENT_KEY = "sb_publishable_synthetic-public-client-value";

const createMapStorage = () => {
  const values = new Map<string, string>();
  const storage: SupportedStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { storage, values };
};

const readRequest = (input: RequestInfo | URL) =>
  input instanceof Request ? new URL(input.url) : new URL(input.toString());

const requestHeaders = (input: RequestInfo | URL, init?: RequestInit) =>
  new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

const makeJwt = (payload: Record<string, unknown>) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.synthetic-signature`;
};

describe("GoTrue client factory", () => {
  it.each(["google", "github"])("rewrites the %s OAuth URL path without changing its query", (provider) => {
    const original = new URL(`${API_URL}/auth/v1/authorize`);
    original.searchParams.set("provider", provider);
    original.searchParams.set("redirect_to", "https://playground.example.test/auth/callback?source=oauth");
    original.searchParams.set("code_challenge", "synthetic+challenge/with=query");
    original.searchParams.set("code_challenge_method", "s256");
    const rewritten = new URL(rewriteGoTrueAuthUrl(original.toString(), API_URL));

    expect(rewritten.origin).toBe(new URL(API_URL).origin);
    expect(rewritten.pathname).toBe("/auth/authorize");
    expect(rewritten.search).toBe(original.search);
    expect(rewritten.searchParams.get("provider")).toBe(provider);
  });

  it("uses a non-JWT public client value for API and anonymous bearer headers", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const { storage } = createMapStorage();
    const client = createGoTrueClient({ baseUrl: API_URL, clientKey: CLIENT_KEY, storage, fetch: fetchMock });

    const result = await client.from("items").select();
    expect(result.error).toBeNull();
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const [input, init] = call!;
    const headers = requestHeaders(input, init);
    expect(CLIENT_KEY.split(".")).toHaveLength(1);
    expect(headers.get("apikey")).toBe(CLIENT_KEY);
    expect(headers.get("Authorization")).toBe(`Bearer ${CLIENT_KEY}`);
    expect(readRequest(input).pathname).toBe("/rest/v1/items");
  });

  it("uses a real session JWT as the bearer token while retaining the client key", async () => {
    const sessionToken = makeJwt({ sub: "session-user", exp: Math.floor(Date.now() / 1000) + 3600 });
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: typeof globalThis.fetch = async (input, init) => {
      calls.push({ input, ...(init ? { init } : {}) });
      const path = readRequest(input).pathname;
      const body = path === "/auth/user"
        ? { id: "session-user", aud: "authenticated", role: "authenticated", email: "session@example.test" }
        : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const { storage, values } = createMapStorage();
    const client = createGoTrueClient({ baseUrl: API_URL, clientKey: CLIENT_KEY, storage, fetch: fetchMock });

    const sessionResult = await client.auth.setSession({ access_token: sessionToken, refresh_token: "synthetic-refresh-token" });
    expect(sessionResult.error).toBeNull();
    expect(sessionResult.data.session?.access_token).toBe(sessionToken);
    const queryResult = await client.from("items").select();
    expect(queryResult.error).toBeNull();

    const restCall = calls.find(({ input }) => readRequest(input).pathname === "/rest/v1/items");
    expect(restCall).toBeDefined();
    const headers = requestHeaders(restCall!.input, restCall!.init);
    expect(headers.get("apikey")).toBe(CLIENT_KEY);
    expect(headers.get("Authorization")).toBe(`Bearer ${sessionToken}`);
    expect(values.has(AUTH_STORAGE_KEY)).toBe(true);
  });

  it("rewrites auth URL strings and preserves a Request's method, headers, and body", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchMock: typeof globalThis.fetch = async (input, init) => {
      calls.push({ input, ...(init ? { init } : {}) });
      return new Response(null, { status: 204 });
    };
    const authFetch = createGoTrueFetch({ baseUrl: API_URL, fetch: fetchMock });

    await authFetch(`${API_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-ID": "string-request" },
      body: '{"email":"person@example.test"}',
    });
    const stringCall = calls[0]!;
    expect(readRequest(stringCall.input).pathname).toBe("/auth/token");
    expect(stringCall.init?.method).toBe("POST");
    expect(requestHeaders(stringCall.input, stringCall.init).get("X-Request-ID")).toBe("string-request");
    expect(stringCall.init?.body).toBe('{"email":"person@example.test"}');

    const request = new Request(`${API_URL}/auth/v1/user?include=profile`, {
      method: "PATCH",
      headers: { "Content-Type": "text/plain", "X-Request-ID": "request-object" },
      body: "preserved request body",
      credentials: "omit",
      redirect: "error",
    });
    await authFetch(request);
    const requestCall = calls[1]!;
    expect(requestCall.input).toBeInstanceOf(Request);
    const rewritten = requestCall.input as Request;
    expect(readRequest(rewritten).pathname).toBe("/auth/user");
    expect(rewritten.method).toBe("PATCH");
    expect(rewritten.headers.get("X-Request-ID")).toBe("request-object");
    expect(rewritten.credentials).toBe("omit");
    expect(rewritten.redirect).toBe("error");
    expect(await rewritten.text()).toBe("preserved request body");
  });

  it("leaves external and non-auth URLs untouched and resolves the default fetch at call time", async () => {
    const requests: Array<RequestInfo | URL> = [];
    const fetchMock: typeof globalThis.fetch = async (input) => {
      requests.push(input);
      return new Response(null, { status: 204 });
    };
    const authFetch = createGoTrueFetch({ baseUrl: API_URL, fetch: fetchMock });
    await authFetch("https://external.example.test/auth/v1/token");
    await authFetch(`${API_URL}/rest/v1/items`);
    expect(readRequest(requests[0]!).href).toBe("https://external.example.test/auth/v1/token");
    expect(readRequest(requests[1]!).pathname).toBe("/rest/v1/items");

    const originalFetch = globalThis.fetch;
    const dynamicFetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    const defaultedFetch = createGoTrueFetch({ baseUrl: API_URL });
    vi.stubGlobal("fetch", dynamicFetch);
    try {
      await defaultedFetch(`${API_URL}/auth/v1`);
      expect(dynamicFetch).toHaveBeenCalledOnce();
      expect(readRequest(dynamicFetch.mock.calls[0]![0]).pathname).toBe("/auth");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
