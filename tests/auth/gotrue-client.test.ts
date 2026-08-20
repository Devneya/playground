import { beforeEach, describe, expect, it } from "vitest";
import { AUTH_STORAGE_KEY, clearAuthStorage } from "../../src/auth/gotrueClient";

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

});
