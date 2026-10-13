// Node-only release verification. Never import this module from the browser app.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const PRODUCTION_URL = "https://playground.devneya.com";
export const MODEL = "gpt-6-luna";
export const MODELS_URL = "https://api.openai.com/v1/models";
export const COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export const MISSING_KEY_MESSAGE = "No local OpenAI Platform API key is available. Publication and live verification are blocked.";
const messages = {
  missing_key: MISSING_KEY_MESSAGE,
  credential_file: "The local Platform key source could not be read safely.",
  ci_refused: "Live OpenAI verification is local-only; CI execution is refused.",
  debug_refused: "Live OpenAI verification refuses DEBUG and PWDEBUG.",
  origin_refused: "Live verification requires the fixed production HTTPS origin.",
  release_sha: "PLAYGROUND_RELEASE_SHA must be the expected full 40-character commit SHA.",
  release_mismatch: "Production release metadata does not match the expected SHA.",
  release_unavailable: "Production release metadata is unavailable over validated HTTPS.",
  https_required: "Production HTTP must redirect to the fixed HTTPS origin.",
  security: "A request or artifact violated the credential or destination safeguards.",
  request_limit: "The completion request allowance has been exhausted.",
  cost_limit: "The estimated release usage allowance has been exhausted.",
  budget_state: "The local release allowance is invalid or another run is active.",
  invalid_request: "The app sent an unexpected inference request.",
  unauthorized: "OpenAI returned 401 for the real Platform key.",
  forbidden: "OpenAI returned 403 for the real Platform key.",
  quota_or_rate_limit: "OpenAI reported a quota or rate-limit failure.",
  model_unavailable: "The authenticated catalog does not contain gpt-6-luna.",
  http_error: "OpenAI returned an unexpected HTTP error.",
  cors: "The browser reported CORS blocking an OpenAI request.",
  network: "The browser OpenAI request failed without a usable HTTP response.",
  invalid_response: "OpenAI returned an unusable completion or numeric usage.",
  application: "A browser scenario did not meet the release requirements.",
  cleanup: "The isolated browser cleanup did not finish successfully.",
  arguments: "Use no option, --preflight, or --check-cors; combinations are refused.",
  cors_preflight: "The genuine browser CORS preflight failed.",
  cors_response: "The synthetic authentication response was not browser-readable.",
  cors_evidence: "Required genuine browser CORS evidence is missing or mismatched.",
  cors_redirect: "The synthetic CORS request encountered a redirect.",
  cors_timeout: "The synthetic browser CORS request timed out.",
  cors_origin: "The synthetic CORS context could not load the required origin.",
  cors_network: "The synthetic browser CORS request failed at the network stage.",
};

export class LiveTestFailure extends Error {
  constructor(category) {
    super(messages[category] ?? messages.application);
    this.category = Object.hasOwn(messages, category) ? category : "application";
  }
}

// Never return arbitrary exception text, URLs, headers, or provider messages.
export const safeFailure = (error) => {
  const category = error instanceof LiveTestFailure && Object.hasOwn(messages, error.category) ? error.category : "application";
  return { category, message: messages[category] };
};

export function assertLocalEnvironment(env) {
  if (env.CI !== undefined) throw new LiveTestFailure("ci_refused");
  if (env.DEBUG !== undefined || env.PWDEBUG !== undefined) throw new LiveTestFailure("debug_refused");
  if (env.PLAYGROUND_E2E_BASE_URL !== undefined && env.PLAYGROUND_E2E_BASE_URL !== PRODUCTION_URL) throw new LiveTestFailure("origin_refused");
}

export function expectedRelease(env) {
  if (!/^[a-f0-9]{40}$/i.test(env.PLAYGROUND_RELEASE_SHA ?? "")) throw new LiveTestFailure("release_sha");
  return env.PLAYGROUND_RELEASE_SHA.toLowerCase();
}

export async function resolveLocalPlatformKey({ env = process.env, read = readFile } = {}) {
  // Refuse CI/debug before any credential read, including standalone preflight.
  assertLocalEnvironment(env);
  let auth;
  try {
    auth = JSON.parse(await read(join(env.CODEX_HOME || "/home/alex/.codex", "auth.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new LiveTestFailure("credential_file");
  }
  const fileKey = auth?.OPENAI_API_KEY;
  if (typeof fileKey === "string" && fileKey.trim()) return { key: fileKey.trim(), source: "codex-auth-file" };
  const environmentKey = env.OPENAI_API_KEY;
  if (typeof environmentKey === "string" && environmentKey.trim()) return { key: environmentKey.trim(), source: "process-environment" };
  throw new LiveTestFailure("missing_key");
}

export const containsSecret = (value, key) => [key, encodeURIComponent(key), encodeURI(key)].some((variant) => value.includes(variant));

export function inspectRequest({ url, method, headers, body = "", key, catalogKey, expectedMessages, resourceType }) {
  if (containsSecret(url, key) || containsSecret(body, key)) throw new LiveTestFailure("security");
  const destination = new URL(url);
  const authorization = headers.authorization;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "authorization" && containsSecret(value, key)) throw new LiveTestFailure("security");
  }
  const staticPath = /^\/(?:assets\/[^?]+|index\.html|robots\.txt|favicon\.(?:png|ico)|logo(?:192|512)\.png|manifest\.json)?$/.test(destination.pathname);
  if (destination.origin === PRODUCTION_URL && staticPath && (!resourceType || ["document", "script", "stylesheet", "image", "font", "other", "manifest"].includes(resourceType))
    && !destination.username && !destination.password && ["GET", "HEAD"].includes(method) && !authorization) return { kind: "static" };
  if (![MODELS_URL, COMPLETIONS_URL].includes(url)) throw new LiveTestFailure("security");
  // Routed UI requests are guarded separately from the genuine-preflight
  // context. These routed observations do not certify upstream OPTIONS.
  if (method === "OPTIONS" && !authorization && !body) return { kind: "preflight" };
  if (url === MODELS_URL && method === "GET" && !body && authorization === `Bearer ${catalogKey}` && catalogKey) return { kind: "catalog" };
  if (url !== COMPLETIONS_URL || method !== "POST" || authorization !== `Bearer ${key}`) throw new LiveTestFailure("security");
  let data;
  try { data = JSON.parse(body); } catch { throw new LiveTestFailure("invalid_request"); }
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some((name) => !["model", "stream", "messages", "reasoning_effort"].includes(name))
    || data.model !== MODEL || data.stream !== false || !expectedMessages || JSON.stringify(data.messages) !== JSON.stringify(expectedMessages)
    || Buffer.byteLength(JSON.stringify(data.messages), "utf8") > 4096) throw new LiveTestFailure("invalid_request");
  return { kind: "completion", postData: JSON.stringify({ ...data, max_completion_tokens: 4096 }) };
}

// A byte-bounded text prompt is conservatively reserved as up to 4096 input
// tokens. Reserve the entire output cap even when a forwarded request fails.
export const REQUEST_RESERVE_USD = 4096 * (0.10 + 0.50) / 1_000_000;
export function createReleaseAllowance(state = { runs: 0, forwarded: 0, reservedUsd: 0, estimatedUsd: 0 }, save = () => {}) {
  if (!state || Object.keys(state).sort().join(",") !== "estimatedUsd,forwarded,reservedUsd,runs" || !Number.isInteger(state.runs) || state.runs < 0 || state.runs > 2 || !Number.isInteger(state.forwarded) || state.forwarded < 0 || state.forwarded > state.runs * 2
    || !Number.isFinite(state.reservedUsd) || state.reservedUsd + 1e-12 < state.forwarded * REQUEST_RESERVE_USD || state.reservedUsd > 0.10
    || !Number.isFinite(state.estimatedUsd) || state.estimatedUsd < 0 || state.estimatedUsd > 0.10) throw new LiveTestFailure("budget_state");
  let runForwarded = 0;
  let begun = false;
  return {
    state,
    begin() {
      if (begun || state.runs >= 2) throw new LiveTestFailure("request_limit");
      state.runs += 1; begun = true; save(state);
    },
    forward() {
      if (!begun || runForwarded >= 2 || state.forwarded >= 4) throw new LiveTestFailure("request_limit");
      if (Math.max(state.reservedUsd, state.estimatedUsd) + REQUEST_RESERVE_USD > 0.10) throw new LiveTestFailure("cost_limit");
      runForwarded += 1; state.forwarded += 1; state.reservedUsd += REQUEST_RESERVE_USD;
      save(state); // Durable count BEFORE continuing the potentially paid request.
      return runForwarded;
    },
    recordUsage(usage) {
      if (![usage?.prompt_tokens, usage?.completion_tokens, usage?.total_tokens].every((value) => Number.isInteger(value) && value >= 0)
        || usage.completion_tokens > 4096 || usage.prompt_tokens > 4096 || usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens) throw new LiveTestFailure("invalid_response");
      const cost = (usage.prompt_tokens * 0.10 + usage.completion_tokens * 0.50) / 1_000_000;
      state.estimatedUsd += cost; save(state);
      if (state.estimatedUsd > 0.10) throw new LiveTestFailure("cost_limit");
      return { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens, estimatedUsd: cost };
    },
    get runForwarded() { return runForwarded; },
  };
}

export function requireSuccessfulStatus(status, code) {
  if (status === 401) throw new LiveTestFailure("unauthorized");
  if (status === 403) throw new LiveTestFailure("forbidden");
  if (status === 429 || code === "insufficient_quota" || code === "rate_limit_exceeded") throw new LiveTestFailure("quota_or_rate_limit");
  if (status < 200 || status >= 300) throw new LiveTestFailure("http_error");
}

export async function installRedirectGuard(context, page, onFailure) {
  // Playwright routing covers the initial URL only. Pause actual responses
  // before Chromium follows redirects, including same-origin redirects that
  // would otherwise retain Authorization. No responses are synthesized.
  const session = await context.newCDPSession(page);
  session.on("Fetch.requestPaused", async ({ requestId, responseStatusCode, responseErrorReason }) => {
    try {
      if (responseErrorReason) {
        onFailure(new LiveTestFailure("network"));
        await session.send("Fetch.failRequest", { requestId, errorReason: "Failed" });
      } else if (responseStatusCode >= 300 && responseStatusCode < 400) {
        onFailure(new LiveTestFailure("security"));
        await session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      } else {
        await session.send("Fetch.continueResponse", { requestId });
      }
    } catch { onFailure(new LiveTestFailure("security")); }
  });
  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] });
}

export function parseLiveArguments(args) {
  if (args.length === 0) return "live";
  if (args.length === 1 && args[0] === "--preflight") return "preflight";
  if (args.length === 1 && args[0] === "--check-cors") return "cors";
  throw new LiveTestFailure("arguments");
}

const CORS_LABELS = ["models", "chat/completions"];
const CORS_HEADERS = ["accept", "authorization", "content-type"];
const CORS_FAILURES = ["cors_preflight", "cors_response", "cors_evidence", "cors_redirect", "cors_timeout", "cors_origin", "cors_network", "cleanup"];
const corsTargets = [
  { endpoint: "models", url: MODELS_URL, method: "GET" },
  { endpoint: "chat/completions", url: COMPLETIONS_URL, method: "POST" },
];
const statusNumber = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const headerNames = (value) => String(value ?? "").toLowerCase().split(",").map((name) => name.trim()).filter(Boolean).sort();
const intendedHeaders = (method) => method === "POST" ? ["authorization", "content-type"] : ["authorization"];

// Keep raw CDP data in memory only. Output is a fixed schema, never headers,
// URLs, response bodies, exception text, or credentials from the events.
export function createCorsCollector(targets = corsTargets) {
  const records = targets.map((target) => ({
    endpoint: CORS_LABELS.includes(target.endpoint) ? target.endpoint : "models",
    method: target.method === "POST" ? "POST" : "GET",
    preflight: { observed: false, status: null, requestedMethod: null, requestedHeaders: [], matches: false },
    response: { status: null, readable: false }, failure: null,
  }));
  const requests = new Map(), pendingHeaders = new Map(), pendingStatuses = new Map();
  const applyHeaders = (request, headers) => {
    if (request.method !== "OPTIONS") return;
    const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    const method = normalized["access-control-request-method"];
    const names = headerNames(normalized["access-control-request-headers"]);
    const preflight = request.record.preflight;
    preflight.requestedMethod = ["GET", "POST"].includes(method) ? method : null;
    preflight.requestedHeaders = names.filter((name) => CORS_HEADERS.includes(name));
    preflight.matches = method === request.record.method && JSON.stringify(names) === JSON.stringify(intendedHeaders(request.record.method));
  };
  const applyStatus = (request, status) => {
    if (request.method === "OPTIONS") request.record.preflight.status = statusNumber(status);
    else {
      request.record.response.status = statusNumber(status);
      if (status >= 300 && status < 400) request.record.failure = "cors_redirect";
    }
  };
  return {
    observe(name, event) {
      if (name === "Network.requestWillBeSent") {
        const index = targets.findIndex((target) => target.url === event.request.url);
        if (index < 0) return;
        const record = records[index];
        const request = { record, method: event.request.method };
        requests.set(event.requestId, request);
        if (request.method === "OPTIONS") record.preflight.observed = true;
        if (event.redirectResponse) record.failure = "cors_redirect";
        applyHeaders(request, event.request.headers ?? {});
        if (pendingHeaders.has(event.requestId)) applyHeaders(request, pendingHeaders.get(event.requestId));
        if (pendingStatuses.has(event.requestId)) applyStatus(request, pendingStatuses.get(event.requestId));
      } else if (name === "Network.requestWillBeSentExtraInfo") {
        const request = requests.get(event.requestId);
        if (request) applyHeaders(request, event.headers ?? {});
        else pendingHeaders.set(event.requestId, event.headers ?? {});
      } else if (["Network.responseReceived", "Network.responseReceivedExtraInfo"].includes(name)) {
        const status = event.response?.status ?? event.statusCode;
        const request = requests.get(event.requestId);
        if (request) applyStatus(request, status);
        else pendingStatuses.set(event.requestId, status);
      } else if (name === "Network.loadingFailed") {
        const request = requests.get(event.requestId);
        if (request && !request.record.failure) request.record.failure = event.corsErrorStatus
          ? (request.method === "OPTIONS" || String(event.corsErrorStatus.corsError).includes("Preflight") ? "cors_preflight" : "cors_response") : "cors_network";
      }
    },
    readable(endpoint, result) {
      const record = records.find((item) => item.endpoint === endpoint);
      if (!record) return;
      record.response.readable = result.readable === true;
      if (result.readable) record.response.status = statusNumber(result.status);
      if (result.timedOut) record.failure = "cors_timeout";
    },
    finish() {
      return records.map((record) => ({ ...record,
        preflight: { ...record.preflight, requestedHeaders: [...record.preflight.requestedHeaders] }, response: { ...record.response },
        failure: record.failure ?? (!record.preflight.observed || !record.preflight.matches ? "cors_evidence"
          : !(record.preflight.status >= 200 && record.preflight.status < 300) ? "cors_preflight"
            : !record.response.readable || record.response.status !== 401 ? "cors_response" : null),
      }));
    },
  };
}

export function assertCorsResult(result) {
  // Validate evidence independently of a claimed result: partial observations
  // or failed cleanup cannot open the paid allowance.
  if (result?.failure) throw new LiveTestFailure(CORS_FAILURES.includes(result.failure) ? result.failure : "cors_evidence");
  if (!result?.cleanup?.contextClosed || !result.cleanup.browserClosed) throw new LiveTestFailure("cleanup");
  if (result.navigationStatus !== 200 || !result.originMatched) throw new LiveTestFailure("cors_origin");
  if (!Array.isArray(result.endpoints) || result.endpoints.length !== 2) throw new LiveTestFailure("cors_evidence");
  for (const [index, item] of result.endpoints.entries()) {
    const target = corsTargets[index];
    if (item?.endpoint !== target.endpoint || item.method !== target.method || !item.preflight?.observed || !item.preflight.matches
      || item.preflight.requestedMethod !== target.method || JSON.stringify(item.preflight.requestedHeaders) !== JSON.stringify(intendedHeaders(target.method))) throw new LiveTestFailure("cors_evidence");
    if (item.failure) throw new LiveTestFailure(CORS_FAILURES.includes(item.failure) ? item.failure : "cors_evidence");
    if (!(item.preflight.status >= 200 && item.preflight.status < 300)) throw new LiveTestFailure("cors_preflight");
    if (!item.response?.readable || item.response.status !== 401) throw new LiveTestFailure("cors_response");
  }
}

// Testable transport harness. Production callers use checkProductionCors,
// which fixes both the origin and endpoints. No routing or Fetch interception.
export async function collectBrowserCors({ chromium, origin, navigationUrl, targets = corsTargets, timeoutMs = 20_000, env = process.env }) {
  const collector = createCorsCollector(targets);
  let browser, context, navigationStatus = null, originMatched = false, failure = null;
  const cleanup = { contextClosed: false, browserClosed: false };
  try {
    const browserEnv = { ...env };
    delete browserEnv.OPENAI_API_KEY;
    browser = await chromium.launch({ channel: "chromium", headless: true, env: browserEnv });
    context = await browser.newContext({ serviceWorkers: "block", ignoreHTTPSErrors: false });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    for (const name of ["Network.requestWillBeSent", "Network.requestWillBeSentExtraInfo", "Network.responseReceived", "Network.responseReceivedExtraInfo", "Network.loadingFailed"]) {
      session.on(name, (event) => collector.observe(name, event));
    }
    await session.send("Network.enable");
    const navigation = await page.goto(navigationUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    navigationStatus = statusNumber(navigation?.status());
    originMatched = new URL(page.url()).origin === origin;
    if (navigationStatus !== 200 || !originMatched) throw new LiveTestFailure("cors_origin");
    for (const target of targets) {
      const result = await page.evaluate(async ({ url, method, timeoutMs }) => {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        try {
          const response = await fetch(url, {
            method, mode: "cors", credentials: "omit", redirect: "error", signal: controller.signal,
            headers: { Authorization: "Bearer invalid-openai-key-for-cors-check", Accept: "application/json", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
            ...(method === "POST" ? { body: "{}" } : {}),
          });
          await response.text();
          return { readable: true, status: response.status, timedOut: false };
        } catch { return { readable: false, status: null, timedOut }; }
        finally { clearTimeout(timer); }
      }, { url: target.url, method: target.method, timeoutMs });
      collector.readable(target.endpoint, result);
    }
  } catch (error) {
    failure = error instanceof LiveTestFailure && CORS_FAILURES.includes(error.category) ? error.category : "cors_network";
  } finally {
    try { if (context) { await context.close(); cleanup.contextClosed = true; } } catch { failure ??= "cleanup"; }
    try { if (browser) { await browser.close(); cleanup.browserClosed = true; } } catch { failure ??= "cleanup"; }
  }
  const result = { navigationStatus, originMatched, endpoints: collector.finish(), cleanup, failure };
  try { assertCorsResult(result); } catch (error) { result.failure = safeFailure(error).category; }
  return result;
}

export async function checkProductionCors() {
  assertLocalEnvironment(process.env);
  const { chromium } = await import("playwright");
  return collectBrowserCors({ chromium, origin: PRODUCTION_URL, navigationUrl: `${PRODUCTION_URL}/robots.txt` });
}

export async function prepareLiveRun({ env, selectCredential, verifyRelease, checkCors, openAllowance }) {
  assertLocalEnvironment(env);
  const credential = await selectCredential();
  const sha = expectedRelease(env);
  await verifyRelease(sha);
  const cors = await checkCors(sha);
  assertCorsResult(cors);
  const budget = await openAllowance();
  return { credential, sha, cors, budget };
}
