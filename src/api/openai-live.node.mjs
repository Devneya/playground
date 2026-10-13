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
  arguments: "Only --preflight is accepted as a runner option.",
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
  // Let Chromium issue its own preflight. No route.fetch/fulfill or CORS bypass.
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
