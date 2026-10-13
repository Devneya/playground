// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright";
import {
  COMPLETIONS_URL, MODELS_URL, MODEL, PRODUCTION_URL, LiveTestFailure,
  MISSING_KEY_MESSAGE, REQUEST_RESERVE_USD, assertLocalEnvironment, containsSecret,
  expectedRelease, inspectRequest, resolveLocalPlatformKey, safeFailure,
  createReleaseAllowance, requireSuccessfulStatus,
  parseLiveArguments, createCorsCollector, assertCorsResult, collectBrowserCors, prepareLiveRun,
  type CorsResult,
  installRedirectGuard,
} from "../../src/api/openai-live.node.mjs";

const key = "synthetic-platform-key";
const messages = [{ role: "user", content: "synthetic prompt" }];
const request = () => ({ url: COMPLETIONS_URL, method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, stream: false, messages }), key, expectedMessages: messages });
const notFound = async (): Promise<string> => { throw Object.assign(new Error("synthetic file missing"), { code: "ENOENT" }); };

const validCorsResult = (): CorsResult => ({
  navigationStatus: 200,
  originMatched: true,
  endpoints: [
    { endpoint: "models", method: "GET", preflight: { observed: true, status: 204, requestedMethod: "GET", requestedHeaders: ["authorization"], matches: true }, response: { status: 401, readable: true }, failure: null },
    { endpoint: "chat/completions", method: "POST", preflight: { observed: true, status: 204, requestedMethod: "POST", requestedHeaders: ["authorization", "content-type"], matches: true }, response: { status: 401, readable: true }, failure: null },
  ],
  cleanup: { contextClosed: true, browserClosed: true },
  failure: null,
});

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

describe("browser CORS evidence and live-run gate", () => {
  it("accepts only the three supported command-line modes", () => {
    expect(parseLiveArguments([])).toBe("live");
    expect(parseLiveArguments(["--preflight"])).toBe("preflight");
    expect(parseLiveArguments(["--check-cors"])).toBe("cors");
    for (const args of [["--preflight", "--check-cors"], ["--preflight", "--other"], ["--unknown"], ["live"]]) {
      expect(() => parseLiveArguments(args)).toThrow("Use no option");
    }
  });

  it("validates both endpoint labels, their exact preflight headers, and readable 401 responses", () => {
    expect(() => assertCorsResult(validCorsResult())).not.toThrow();

    const missingEndpoint = validCorsResult();
    missingEndpoint.endpoints.pop();
    expect(() => assertCorsResult(missingEndpoint)).toThrow("evidence is missing");

    const mislabeled = validCorsResult();
    mislabeled.endpoints[0]!.endpoint = "chat/completions";
    expect(() => assertCorsResult(mislabeled)).toThrow("evidence is missing");

    const extraHeader = validCorsResult();
    extraHeader.endpoints[1]!.preflight.requestedHeaders.push("x-unexpected");
    expect(() => assertCorsResult(extraHeader)).toThrow("evidence is missing");

    const unreadable = validCorsResult();
    unreadable.endpoints[0]!.response = { readable: false, status: null };
    expect(() => assertCorsResult(unreadable)).toThrow("not browser-readable");

    const redirect = validCorsResult();
    redirect.endpoints[0]!.failure = "cors_redirect";
    expect(() => assertCorsResult(redirect)).toThrow("redirect");

    const timeout = validCorsResult();
    timeout.endpoints[0]!.failure = "cors_timeout";
    expect(() => assertCorsResult(timeout)).toThrow("timed out");

    const cleanup = validCorsResult();
    cleanup.cleanup.contextClosed = false;
    expect(() => assertCorsResult(cleanup)).toThrow("cleanup");
  });

  it("records real CDP event shapes while returning sanitized preflight evidence", () => {
    const collector = createCorsCollector();
    const secret = "synthetic-untrusted-header-value";
    const targetEvents = [
      { id: "models-options", url: MODELS_URL, method: "OPTIONS", requestedMethod: "GET", requestedHeaders: "authorization" },
      { id: "models-get", url: MODELS_URL, method: "GET" },
      { id: "completions-options", url: COMPLETIONS_URL, method: "OPTIONS", requestedMethod: "POST", requestedHeaders: "content-type, authorization" },
      { id: "completions-post", url: COMPLETIONS_URL, method: "POST" },
    ];
    for (const event of targetEvents) {
      collector.observe("Network.requestWillBeSent", {
        requestId: event.id,
        request: {
          url: event.url,
          method: event.method,
          headers: event.method === "OPTIONS" ? {
            "access-control-request-method": event.requestedMethod,
            "access-control-request-headers": event.requestedHeaders,
          } : {},
        },
      });
      if (event.method === "OPTIONS") {
        collector.observe("Network.responseReceived", { requestId: event.id, response: { status: 204 } });
      } else {
        collector.observe("Network.responseReceived", { requestId: event.id, response: { status: 401 } });
        collector.readable(event.url === MODELS_URL ? "models" : "chat/completions", { readable: true, status: 401 });
      }
    }
    // An unrecognized requested header must make evidence fail, without being echoed into results.
    collector.observe("Network.requestWillBeSentExtraInfo", {
      requestId: "models-options",
      headers: { "access-control-request-method": "GET", "access-control-request-headers": `authorization, x-private-${secret}` },
    });
    const evidence = collector.finish();
    expect(evidence[0]?.preflight.matches).toBe(false);
    expect(evidence[0]?.preflight.requestedHeaders).toEqual(["authorization"]);
    expect(JSON.stringify(evidence)).not.toContain(secret);
    expect(() => assertCorsResult({ ...validCorsResult(), endpoints: evidence })).toThrow("evidence is missing");
  });

  it("joins out-of-order CDP ExtraInfo headers and statuses to their requests", () => {
    const collector = createCorsCollector();
    const exchanges = [
      { endpoint: "models", url: MODELS_URL, method: "GET", requestedHeaders: "authorization" },
      { endpoint: "chat/completions", url: COMPLETIONS_URL, method: "POST", requestedHeaders: "content-type, authorization" },
    ] as const;
    for (const [index, exchange] of exchanges.entries()) {
      const optionsId = `options-${index}`;
      const actualId = `actual-${index}`;
      collector.observe("Network.requestWillBeSentExtraInfo", {
        requestId: optionsId,
        headers: {
          "access-control-request-method": exchange.method,
          "access-control-request-headers": exchange.requestedHeaders,
        },
      });
      collector.observe("Network.responseReceivedExtraInfo", { requestId: optionsId, statusCode: 204 });
      collector.observe("Network.requestWillBeSent", { requestId: optionsId, request: { url: exchange.url, method: "OPTIONS", headers: {} } });

      collector.observe("Network.responseReceivedExtraInfo", { requestId: actualId, statusCode: 401 });
      collector.observe("Network.requestWillBeSent", { requestId: actualId, request: { url: exchange.url, method: exchange.method, headers: {} } });
      collector.readable(exchange.endpoint, { readable: true, status: 401 });
    }
    const result = { ...validCorsResult(), endpoints: collector.finish() };
    expect(result.endpoints.map(({ preflight, response }) => [preflight.status, response.status])).toEqual([[204, 401], [204, 401]]);
    expect(() => assertCorsResult(result)).not.toThrow();
  });

  it("runs credential, release, CORS, and allowance checks in order", async () => {
    const order: string[] = [];
    const result = await prepareLiveRun({
      env: { PLAYGROUND_RELEASE_SHA: "b".repeat(40) },
      selectCredential: async () => { order.push("credential"); return { key, source: "synthetic" }; },
      verifyRelease: async (sha) => { order.push(`release:${sha}`); },
      checkCors: async (sha) => { order.push(`cors:${sha}`); return validCorsResult(); },
      openAllowance: async () => { order.push("allowance"); return "open"; },
    });
    expect(order).toEqual(["credential", `release:${"b".repeat(40)}`, `cors:${"b".repeat(40)}`, "allowance"]);
    expect(result.budget).toBe("open");
  });

  it("does not open the allowance when any local precheck fails", async () => {
    const stages = ["credential", "release", "cors"] as const;
    for (const failingStage of stages) {
      const order: string[] = [];
      const openAllowance = vi.fn(async () => "open");
      await expect(prepareLiveRun({
        env: { PLAYGROUND_RELEASE_SHA: "c".repeat(40) },
        selectCredential: async () => {
          order.push("credential");
          if (failingStage === "credential") throw new Error("synthetic credential failure");
          return { key, source: "synthetic" };
        },
        verifyRelease: async () => {
          order.push("release");
          if (failingStage === "release") throw new Error("synthetic release failure");
        },
        checkCors: async () => {
          order.push("cors");
          if (failingStage === "cors") return { ...validCorsResult(), failure: "cors_preflight" };
          return validCorsResult();
        },
        openAllowance,
      })).rejects.toThrow();
      expect(order).toEqual(failingStage === "credential" ? ["credential"] : failingStage === "release" ? ["credential", "release"] : ["credential", "release", "cors"]);
      expect(openAllowance).not.toHaveBeenCalled();
    }

    for (const env of [{ CI: "true" }, { DEBUG: "pw:*" }, { PWDEBUG: "1" }]) {
      const selectCredential = vi.fn(async () => ({ key, source: "synthetic" }));
      const openAllowance = vi.fn(async () => "open");
      await expect(prepareLiveRun({
        env: { ...env, PLAYGROUND_RELEASE_SHA: "d".repeat(40) },
        selectCredential,
        verifyRelease: async () => {},
        checkCors: async () => validCorsResult(),
        openAllowance,
      })).rejects.toBeInstanceOf(LiveTestFailure);
      expect(selectCredential).not.toHaveBeenCalled();
      expect(openAllowance).not.toHaveBeenCalled();
    }
  });

  it("reports cleanup failure even when the injected context closes before throwing", async () => {
    const calls: string[] = [];
    let launchEnv: NodeJS.ProcessEnv | undefined;
    const session = { on: vi.fn(), send: vi.fn(async () => {}) };
    const context = {
      newPage: async () => ({
        goto: async () => ({ status: () => 200 }),
        url: () => "https://local.example.test/",
        evaluate: async () => ({ readable: true, status: 401, timedOut: false }),
      }),
      newCDPSession: async () => session,
      close: async () => { calls.push("context-closed"); throw new Error("synthetic cleanup detail"); },
    };
    const browser = {
      newContext: async () => context,
      close: async () => { calls.push("browser-closed"); },
    };
    const fakeChromium = { launch: async ({ env: browserEnv }: { env: NodeJS.ProcessEnv }) => { launchEnv = browserEnv; return browser; } };
    const result = await collectBrowserCors({
      chromium: fakeChromium as never,
      origin: "https://local.example.test",
      navigationUrl: "https://local.example.test/",
      targets: [
        { endpoint: "models", url: MODELS_URL, method: "GET" },
        { endpoint: "chat/completions", url: COMPLETIONS_URL, method: "POST" },
      ],
      env: { OPENAI_API_KEY: key, SYNTHETIC_SETTING: "preserved" },
    });
    expect(launchEnv?.OPENAI_API_KEY).toBeUndefined();
    expect(launchEnv?.SYNTHETIC_SETTING).toBe("preserved");
    expect(calls).toEqual(["context-closed", "browser-closed"]);
    expect(result.cleanup).toEqual({ contextClosed: false, browserClosed: true });
    expect(result.failure).toBe("cleanup");
    expect(JSON.stringify(result)).not.toContain("synthetic cleanup detail");
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
