// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";
import {
  COMPLETIONS_URL, MODELS_URL, MODEL, PRODUCTION_URL, LiveTestFailure,
  MISSING_KEY_MESSAGE, REQUEST_RESERVE_USD, assertLocalEnvironment, containsSecret,
  expectedRelease, inspectRequest, resolveLocalPlatformKey, safeFailure,
  createReleaseAllowance, requireSuccessfulStatus,
  installRedirectGuard,
} from "../../src/api/openai-live.node.mjs";

const key = "synthetic-platform-key";
const messages = [{ role: "user", content: "synthetic prompt" }];
const request = () => ({ url: COMPLETIONS_URL, method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, stream: false, messages }), key, expectedMessages: messages });
const notFound = async (): Promise<string> => { throw Object.assign(new Error("synthetic file missing"), { code: "ENOENT" }); };

describe("Node-only local Platform credential selection", () => {
  it("prefers only the top-level key in the active Codex file over the environment", async () => {
    const read = vi.fn(async () => JSON.stringify({ OPENAI_API_KEY: ` ${key} `, tokens: { access_token: "synthetic-oauth" } }));
    await expect(resolveLocalPlatformKey({ env: { CODEX_HOME: "/synthetic/codex", OPENAI_API_KEY: "synthetic-environment" }, read })).resolves.toEqual({ key, source: "codex-auth-file" });
    expect(read).toHaveBeenCalledWith("/synthetic/codex/auth.json", "utf8");
  });

  it("uses the default file path and falls back to an existing environment key", async () => {
    const read = vi.fn(notFound);
    await expect(resolveLocalPlatformKey({ env: { OPENAI_API_KEY: key }, read })).resolves.toEqual({ key, source: "process-environment" });
    expect(read).toHaveBeenCalledWith("/home/alex/.codex/auth.json", "utf8");
    await expect(resolveLocalPlatformKey({ env: { OPENAI_API_KEY: key }, read: async () => JSON.stringify({ OPENAI_API_KEY: "   " }) })).resolves.toEqual({ key, source: "process-environment" });
  });

  it("rejects OAuth-only sign-in and nested keys without using either token", async () => {
    const read = async () => JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", OPENAI_API_KEY: key } });
    await expect(resolveLocalPlatformKey({ env: {}, read })).rejects.toThrow(MISSING_KEY_MESSAGE);
    await expect(resolveLocalPlatformKey({ env: { OPENAI_API_KEY: " " }, read: notFound })).rejects.toThrow(MISSING_KEY_MESSAGE);
    await expect(resolveLocalPlatformKey({ env: { OPENAI_API_KEY: key }, read })).resolves.toEqual({ key, source: "process-environment" });
  });

  it("returns fixed errors for malformed or unreadable credential files", async () => {
    for (const read of [async () => key, async () => { throw new Error(key); }]) {
      try { await resolveLocalPlatformKey({ env: {}, read }); expect.fail("must reject"); }
      catch (error) { expect(safeFailure(error)).toEqual({ category: "credential_file", message: "The local Platform key source could not be read safely." }); }
    }
  });

  it("refuses CI and Playwright debugging before reading any credentials", async () => {
    for (const env of [{ CI: "true" }, { CI: "" }, { DEBUG: "pw:*" }, { PWDEBUG: "0" }, { DEBUG: "" }]) {
      const read = vi.fn(notFound);
      await expect(resolveLocalPlatformKey({ env, read })).rejects.toBeInstanceOf(LiveTestFailure);
      expect(read).not.toHaveBeenCalled();
    }
    expect(() => assertLocalEnvironment({})).not.toThrow();
  });
});

describe("local production network safeguards", () => {
  it("requires the exact production origin and a full SHA", () => {
    expect(() => assertLocalEnvironment({ PLAYGROUND_E2E_BASE_URL: "https://other.example.test" })).toThrow("fixed production");
    expect(() => assertLocalEnvironment({ PLAYGROUND_E2E_BASE_URL: PRODUCTION_URL })).not.toThrow();
    expect(expectedRelease({ PLAYGROUND_RELEASE_SHA: "A".repeat(40) })).toBe("a".repeat(40));
    for (const sha of ["", "a".repeat(39), "g".repeat(40)]) expect(() => expectedRelease({ PLAYGROUND_RELEASE_SHA: sha })).toThrow("40-character");
  });

  it("preserves the app request and adds only the completion safety cap", () => {
    const original = request();
    original.body = JSON.stringify({ model: MODEL, stream: false, messages, reasoning_effort: "medium" });
    const inspected = inspectRequest(original);
    expect(inspected.kind).toBe("completion");
    expect(JSON.parse(inspected.postData!)).toEqual({ ...JSON.parse(original.body), max_completion_tokens: 4096 });
    expect(original.headers.authorization).toBe(`Bearer ${key}`);
  });

  it("allows credential-free production assets and real Chromium preflights", () => {
    expect(inspectRequest({ ...request(), url: `${PRODUCTION_URL}/assets/app.js`, method: "GET", headers: {}, body: "" })).toEqual({ kind: "static" });
    expect(inspectRequest({ ...request(), url: MODELS_URL, method: "OPTIONS", headers: {}, body: "" })).toEqual({ kind: "preflight" });
    expect(inspectRequest({ ...request(), url: MODELS_URL, method: "GET", headers: { authorization: "Bearer invalid-openai-key-for-release-test" }, catalogKey: "invalid-openai-key-for-release-test", body: "" })).toEqual({ kind: "catalog" });
  });

  it("blocks key leakage in URLs, bodies and other headers and any Devneya or unapproved request", () => {
    for (const change of [
      { url: `${MODELS_URL}?key=${key}` }, { body: key }, { headers: { authorization: `Bearer ${key}`, "x-secret": key } },
      { url: "https://api.devneya.com/llm/v1/models" }, { url: "https://api.openai.com/v1/responses" },
      { url: `${PRODUCTION_URL}/assets/app.js`, method: "GET", body: "" },
      { url: `${PRODUCTION_URL}/upload`, method: "POST", headers: {}, body: "" },
      { url: `${PRODUCTION_URL}/assets/data.json`, method: "GET", headers: {}, body: "", resourceType: "fetch" },
      { url: `${PRODUCTION_URL}/api`, method: "GET", headers: {}, body: "" },
      { method: "GET" }, { headers: { authorization: "Bearer synthetic-other" } },
    ]) expect(() => inspectRequest({ ...request(), ...change })).toThrow(LiveTestFailure);
    expect(containsSecret(encodeURIComponent("synthetic/key"), "synthetic/key")).toBe(true);
  });

  it("rejects changed messages, another model, streaming, tools and oversized UTF-8 input", () => {
    for (const data of [
      { model: "synthetic-other-model", stream: false, messages }, { model: MODEL, stream: true, messages },
      { model: MODEL, stream: false, messages, tools: [] }, { model: MODEL, stream: false, messages: [] },
      { model: MODEL, stream: false, messages, max_completion_tokens: 1 }, null,
    ]) expect(() => inspectRequest({ ...request(), body: JSON.stringify(data) })).toThrow("unexpected inference");
    expect(() => inspectRequest({ ...request(), body: "{" })).toThrow("unexpected inference");
    const oversized = [{ role: "user", content: "é".repeat(2200) }];
    expect(() => inspectRequest({ ...request(), expectedMessages: oversized, body: JSON.stringify({ model: MODEL, stream: false, messages: oversized }) })).toThrow("unexpected inference");
    expect(() => inspectRequest({ ...request(), expectedMessages: null })).toThrow("unexpected inference");
  });
});

describe("paid request allowance and sanitized reporting", () => {
  it("blocks redirects before Chromium can reuse Authorization and preserves other real responses", async () => {
    let paused: ((event: { requestId: string; responseStatusCode?: number; responseErrorReason?: string }) => Promise<void>) | undefined;
    const session = { on: vi.fn((_name: string, callback: typeof paused) => { paused = callback; }), send: vi.fn(async () => {}) };
    const context = { newCDPSession: vi.fn(async () => session) };
    const failures = vi.fn();
    await installRedirectGuard(context as unknown as BrowserContext, {} as Page, failures);
    expect(session.send).toHaveBeenCalledWith("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] });
    await paused!({ requestId: "synthetic-redirect", responseStatusCode: 302 });
    expect(session.send).toHaveBeenCalledWith("Fetch.failRequest", { requestId: "synthetic-redirect", errorReason: "BlockedByClient" });
    expect(safeFailure(failures.mock.calls[0]![0]).category).toBe("security");
    await paused!({ requestId: "synthetic-response", responseStatusCode: 200 });
    expect(session.send).toHaveBeenCalledWith("Fetch.continueResponse", { requestId: "synthetic-response" });
    expect(failures).toHaveBeenCalledTimes(1);
    await paused!({ requestId: "synthetic-network-failure", responseErrorReason: "Failed" });
    expect(session.send).toHaveBeenCalledWith("Fetch.failRequest", { requestId: "synthetic-network-failure", errorReason: "Failed" });
    expect(safeFailure(failures.mock.calls[1]![0]).category).toBe("network");
  });

  it("durably counts failed forwards and refuses a third request or third release run", () => {
    const saved: string[] = [];
    const first = createReleaseAllowance(undefined, (state) => saved.push(JSON.stringify(state)));
    expect(() => first.forward()).toThrow("exhausted");
    first.begin(); first.forward(); first.forward();
    expect(first.runForwarded).toBe(2);
    expect(JSON.parse(saved.at(-1)!)).toMatchObject({ forwarded: 2, runs: 1 });
    expect(() => first.forward()).toThrow("exhausted");
    // No usage is needed: timeouts/failed responses still consumed the limit.
    const corrective = createReleaseAllowance(JSON.parse(saved.at(-1)!));
    corrective.begin(); corrective.forward(); corrective.forward();
    expect(corrective.state.forwarded).toBe(4);
    expect(() => corrective.forward()).toThrow("exhausted");
    expect(() => createReleaseAllowance(corrective.state).begin()).toThrow("exhausted");
  });

  it("validates usage, reserves failed requests and enforces the cost cap", () => {
    const allowance = createReleaseAllowance(); allowance.begin(); allowance.forward();
    expect(allowance.state.reservedUsd).toBe(REQUEST_RESERVE_USD);
    expect(allowance.recordUsage({ prompt_tokens: 20, completion_tokens: 100, total_tokens: 120 })).toEqual({ promptTokens: 20, completionTokens: 100, totalTokens: 120, estimatedUsd: 0.000052 });
    for (const usage of [{ prompt_tokens: NaN, completion_tokens: 1, total_tokens: 1 }, { prompt_tokens: 1, completion_tokens: 4097, total_tokens: 4098 }, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 4 }]) expect(() => allowance.recordUsage(usage)).toThrow("numeric usage");
    const capped = createReleaseAllowance({ runs: 1, forwarded: 1, reservedUsd: 0.099, estimatedUsd: 0.099 });
    capped.begin(); expect(() => capped.forward()).toThrow("usage allowance");
    expect(() => createReleaseAllowance({ runs: 0, forwarded: 2, reservedUsd: 0, estimatedUsd: 0 })).toThrow("allowance is invalid");
  });

  it("reports fixed categories without copying unsafe exception text", () => {
    expect(safeFailure(new Error(`https://synthetic.test/${key} Bearer ${key}`))).toEqual({ category: "application", message: "A browser scenario did not meet the release requirements." });
    const error = new LiveTestFailure("security"); error.message = key;
    expect(safeFailure(error).message).not.toContain(key);
    expect(safeFailure(new LiveTestFailure(key))).toEqual(safeFailure(new Error(key)));
    for (const [status, code, category] of [[401, undefined, "unauthorized"], [403, undefined, "forbidden"], [429, undefined, "quota_or_rate_limit"], [400, "insufficient_quota", "quota_or_rate_limit"], [500, undefined, "http_error"]] as const) {
      try { requireSuccessfulStatus(status, code); expect.fail("must reject"); }
      catch (failure) { expect(safeFailure(failure).category).toBe(category); }
    }
    expect(() => requireSuccessfulStatus(200)).not.toThrow();
  });
});
