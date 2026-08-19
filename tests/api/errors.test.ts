import { describe, expect, it } from "vitest";
import { ApiError, errorFromResponse, normalizeApiError } from "../../src/api/errors";
import { composeSignals } from "../../src/api/http";
import { getVirtualKey, revokeSession } from "../../src/api/account";
import { toGoTrueAccessToken } from "../../src/api/credentials";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const server = setupServer(
  http.get("https://api.devneya.com/account/key", ({ request }) => request.headers.get("authorization") === "Bearer jwt" ? HttpResponse.json({ key: "sk-bf-account" }) : HttpResponse.json({ error: "unauthorized" }, { status: 401 })),
  http.post("https://api.devneya.com/account/logout", () => new HttpResponse(null, { status: 204 })),
);

describe("API error and account boundaries", () => {
  it("normalizes response and network failures safely", async () => {
    const responseError = await errorFromResponse(new Response(JSON.stringify({ error: "Nope", code: "nope" }), { status: 400, statusText: "Bad request", headers: { "Content-Type": "application/json" } }));
    expect(responseError).toEqual(expect.objectContaining({ kind: "http", status: 400, code: "nope", message: "Nope" }));
    expect(normalizeApiError(new TypeError("offline"))).toEqual(expect.objectContaining({ kind: "network" }));
    expect(normalizeApiError(new DOMException("cancel", "AbortError"))).toEqual(expect.objectContaining({ kind: "aborted" }));
    expect(normalizeApiError(new Error("unknown"))).toEqual(expect.objectContaining({ kind: "network" }));
    expect(new ApiError("timeout", "slow").kind).toBe("timeout");
  });

  it("composes caller abort signals and cleans up", () => {
    const caller = new AbortController();
    const composed = composeSignals([caller.signal], 10_000);
    caller.abort();
    expect(composed.signal.aborted).toBe(true);
    composed.cleanup();
  });

  it("keeps account calls on the GoTrue credential path", async () => {
    server.listen({ onUnhandledRequest: "error" });
    await expect(getVirtualKey(toGoTrueAccessToken("jwt"))).resolves.toBe("sk-bf-account");
    await expect(revokeSession(toGoTrueAccessToken("jwt"))).resolves.toBeUndefined();
    server.close();
  });
});
