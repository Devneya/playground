// @vitest-environment node
import { describe, expect, it } from "vitest";
import { authObservationGrantType, authObservationHeaders } from "../auth-live/browser-observation";

describe("browser authentication observations", () => {
  it("accepts Chromium HTTP/2 headers without retaining pseudo-headers or unrelated values", () => {
    const headers = {
      ":authority": "api.example.test", ":method": "POST", ":path": "/auth/token", ":scheme": "https",
      apikey: "synthetic-client-key", authorization: "Bearer synthetic-user-token", cookie: "synthetic-cookie",
    };
    expect(() => new Headers(headers)).toThrow();
    expect([...authObservationHeaders(headers)]).toEqual([
      ["apikey", "synthetic-client-key"], ["authorization", "Bearer synthetic-user-token"],
    ]);
  });

  it("normalizes authentication names and retains missing headers as absent", () => {
    expect(authObservationHeaders({ APIKEY: "synthetic-client-key", Authorization: "Bearer synthetic-user-token" }).get("authorization")).toBe("Bearer synthetic-user-token");
    expect(authObservationHeaders({ ":method": "OPTIONS" }).has("apikey")).toBe(false);
  });

  it("distinguishes a refresh from password login without exposing URL parameters", () => {
    expect(authObservationGrantType(new URL("https://api.example.test/auth/token?grant_type=refresh_token&token=synthetic-token"))).toBe("refresh_token");
    expect(authObservationGrantType(new URL("https://api.example.test/auth/token?grant_type=password"))).toBe("password");
    expect(authObservationGrantType(new URL("https://api.example.test/auth/token?grant_type=synthetic-unknown"))).toBeNull();
  });
});
