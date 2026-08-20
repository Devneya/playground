import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_STORAGE_KEY, clearAuthStorage, supabase } from "../../src/auth/gotrueClient";
import { useAuth } from "../../src/auth/useAuth";
import { renderHook } from "@testing-library/react";

describe("GoTrue browser storage boundary", () => {
  beforeEach(() => localStorage.clear());

  it("removes only the namespaced auth records", () => {
    localStorage.setItem(`${AUTH_STORAGE_KEY}:session`, "session");
    localStorage.setItem(`${AUTH_STORAGE_KEY}:pkce`, "pkce");
    localStorage.setItem("unrelated", "keep");
    clearAuthStorage();
    expect(localStorage.getItem(`${AUTH_STORAGE_KEY}:session`)).toBeNull();
    expect(localStorage.getItem(`${AUTH_STORAGE_KEY}:pkce`)).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("does nothing when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => clearAuthStorage()).not.toThrow();
    vi.unstubAllGlobals();
  });


  it("rewrites the Supabase auth path while preserving auth storage", async () => {
    const originalFetch = globalThis.fetch;
    const requests: RequestInfo[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
      requests.push(input);
      return new Response(JSON.stringify({
        access_token: "test-access",
        refresh_token: "test-refresh",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: { id: "auth-user", aud: "authenticated", role: "authenticated", email: "auth@example.test" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const result = await supabase.auth.signInWithPassword({ email: "auth@example.test", password: "password123" });
    expect(result.error).toBeNull();
    const request = requests[0];
    expect(request instanceof Request ? new URL(request.url).pathname : new URL(String(request)).pathname).toBe("/auth/token");
    expect(result.data.user?.id).toBe("auth-user");
    await supabase.auth.signOut({ scope: "local" });
    globalThis.fetch = originalFetch;
  });

  it("requires the AuthProvider context", () => {
    expect(() => renderHook(() => useAuth())).toThrow("useAuth must be used inside AuthProvider.");
  });

});
