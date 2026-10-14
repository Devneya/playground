// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDisposableMailbox } from "../e2e/real-accounts";

afterEach(() => vi.unstubAllGlobals());

describe("disposable mailbox availability boundary", () => {
  it("uses the second service after a server failure before creation", async () => {
    const createdAt: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.hostname === "api.mail.gw") return new Response("{}", { status: 502 });
      if (url.pathname === "/domains") return Response.json([{ domain: "example.test", isActive: true }]);
      if (url.pathname === "/accounts" && init?.method === "POST") { createdAt.push(url.hostname); return Response.json({ id: "synthetic-mailbox-id" }); }
      return Response.json({ token: "synthetic-mailbox-token" });
    }));
    const account = await createDisposableMailbox();
    expect(account.mailApi).toBe("https://api.mail.tm");
    expect(createdAt).toEqual(["api.mail.tm"]);
  });

  it("does not create another mailbox if token retrieval fails after creation", async () => {
    const createdAt: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === "/domains") return Response.json([{ domain: "example.test", isActive: true }]);
      if (url.pathname === "/accounts" && init?.method === "POST") { createdAt.push(url.hostname); return Response.json({ id: "synthetic-mailbox-id" }); }
      return new Response("{}", { status: 502 });
    }));
    await expect(createDisposableMailbox()).rejects.toThrow("Disposable-mail request failed (502).");
    expect(createdAt).toEqual(["api.mail.gw"]);
  });
});
