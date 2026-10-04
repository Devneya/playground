// Development-only bridge. Imported by Vite, never by browser code.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { storedFileSchema, MAX_REQUEST_FILE_BYTES } from "../domain/files.ts";

const CODEX_ORIGIN = "https://chatgpt.com/backend-api/codex";
const MODEL = "gpt-6.1-sol";
const MAX_BODY = 6 * 1024 * 1024;
const efforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

export async function readCodexCredentials() {
  const auth = JSON.parse(await readFile(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"), "utf8"));
  if (!auth.tokens?.access_token) throw new Error("Sign in with ChatGPT using codex login, then retry the connection.");
  return { Authorization: `Bearer ${auth.tokens.access_token}`, ...(auth.tokens.account_id ? { "ChatGPT-Account-Id": auth.tokens.account_id } : {}) };
}

export async function readResponseStream(body, onDelta = () => {}, requestedModel = MODEL) {
  if (!body) throw new Error("Codex returned an empty response.");
  let buffer = "", content = "", completed = false, usage, serviceTier;
  const decoder = new TextDecoder();
  const consume = (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (event.type === "response.output_text.delta") { content += event.delta; onDelta(event.delta); }
    if (["error", "response.failed", "response.incomplete"].includes(event.type)) throw new Error("Codex could not complete this response. Retry or check your account's model access and usage limits.");
    if (event.type === "response.completed") {
      if (event.response?.status !== "completed") throw new Error("Codex returned an incomplete response.");
      if (event.response?.model !== requestedModel) throw new Error("Codex returned a different model than requested.");
      completed = true;
      if (typeof event.response.service_tier === "string") serviceTier = event.response.service_tier;
      const u = event.response.usage;
      if (u) usage = { promptTokens: u.input_tokens, completionTokens: u.output_tokens, totalTokens: u.total_tokens };
    }
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
    for (const line of lines) consume(line.replace(/\r$/, ""));
    if (Buffer.byteLength(content) > 256 * 1024 || buffer.length > 2 * 1024 * 1024) throw new Error("Codex returned too much content.");
    if (completed) break;
  }
  buffer += decoder.decode();
  if (buffer) consume(buffer);
  if (!completed || !content.trim()) throw new Error("The Codex connection closed before a complete answer arrived.");
  return { content, ...(serviceTier ? { serviceTier } : {}), ...(usage ? { usage } : {}) };
}

export function createCodexBridge({ credentials = readCodexCredentials, fetcher = fetch } = {}) {
  let verified;
  let available = new Set([MODEL]);
  let capabilities = new Map([[MODEL, { supportedReasoningEfforts: ["xhigh"], defaultReasoningEffort: "xhigh" }]]);
  async function request(path, init, signal) {
    const headers = await credentials();
    const response = await fetcher(`${CODEX_ORIGIN}/${path}`, { ...init, headers: { ...headers, "Content-Type": "application/json", Accept: path === "responses" ? "text/event-stream" : "application/json" }, signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 401 ? "Codex sign-in expired. Sign in again with codex login, then retry." : `Codex request failed (HTTP ${response.status}). Check model access and account usage limits.`);
    }
    return response;
  }
  async function complete(messages, instructions, signal, onDelta, model = MODEL, effort) {
    if (!available.has(model)) await catalog(signal);
    if (!available.has(model)) throw new Error("Codex model is not available in this account's catalog.");
    if (effort && !capabilities.get(model)?.supportedReasoningEfforts.includes(effort)) {
      await catalog(signal);
      if (!capabilities.get(model)?.supportedReasoningEfforts.includes(effort)) throw new Error("Codex does not support that reasoning effort for this model.");
    }
    const capability = capabilities.get(model);
    const selectedEffort = effort ?? (capability?.supportedReasoningEfforts.includes("xhigh") ? "xhigh" : capability?.defaultReasoningEffort);
    const input = messages.map(({ role, content, files }) => ({ role, content: files?.length ? [
      { type: "input_text", text: content },
      ...files.map(file => file.mimeType.startsWith("image/") ? { type: "input_image", image_url: file.dataUrl } : { type: "input_file", filename: file.name, file_data: file.dataUrl }),
    ] : content }));
    const response = await request("responses", { method: "POST", body: JSON.stringify({ model, service_tier: "priority", ...(selectedEffort ? { reasoning: { effort: selectedEffort } } : {}), instructions, input, tools: [], store: false, stream: true }) }, signal);
    return readResponseStream(response.body, onDelta, model);
  }
  async function catalog(signal) {
    const response = await request("models?client_version=0.160.0", { method: "GET" }, signal);
    const body = await response.json();
    if (!Array.isArray(body.models)) throw new Error("Codex returned an invalid model catalog.");
    // Some accounts can infer with a model before their catalog lists it.
    // Verify this configured model once per server lifetime; never fabricate access.
    if (!body.models.some(m => m.slug === MODEL && m.visibility === "list") && !verified) {
      verified = complete([{ role: "user", content: "Reply with OK." }], "Connection check. Reply with OK only.", signal).catch((error) => { verified = undefined; throw error; });
    }
    if (verified) await verified;
    const visible = body.models.filter(m => m.visibility === "list" && typeof m.slug === "string" && /^[a-zA-Z0-9._-]{1,120}$/.test(m.slug));
    available = new Set([MODEL, ...visible.map(m => m.slug)]);
    capabilities = new Map(visible.map(m => {
      const supportedReasoningEfforts = [...new Set((m.supported_reasoning_levels ?? []).map(level => level.effort).filter(effort => efforts.has(effort)))];
      const defaultReasoningEffort = supportedReasoningEfforts.includes(m.default_reasoning_level) ? m.default_reasoning_level : supportedReasoningEfforts[0];
      return [m.slug, { supportedReasoningEfforts, ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}) }];
    }));
    if (!capabilities.has(MODEL)) capabilities.set(MODEL, { supportedReasoningEfforts: ["xhigh"], defaultReasoningEffort: "xhigh" });
    return { object: "list", data: [...available].map((id) => ({ id, object: "model", created: 0, owned_by: "devneya", ...capabilities.get(id) })), connection: { provider: "Codex" } };
  }
  return { complete, catalog };
}

export function isLocalRequest(req) {
  const host = req.headers.host;
  if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  return req.method === "GET" || (req.headers.origin === `http://${host}` && req.headers["x-devneya-local"] === "1" && req.headers["content-type"] === "application/json");
}

export function localCodexPlugin() {
  const bridge = createCodexBridge();
  return {
    name: "local-codex-connection", apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (!path?.startsWith("/local-api/")) return next();
        const json = (status, body) => { if (!res.destroyed) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); } };
        if (!isLocalRequest(req)) return json(403, { error: { message: "This connection only accepts requests from its local playground." } });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 600_000);
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });
        try {
          if (req.method === "GET" && path === "/local-api/llm/v1/models") {
            const result = await bridge.catalog(controller.signal);
            return json(200, { object: result.object, data: result.data });
          }
          if (req.method !== "POST" || path !== "/local-api/completion") return json(404, { error: { message: "Unknown local endpoint." } });
          let raw = "";
          for await (const chunk of req) { raw += chunk.toString(); if (Buffer.byteLength(raw) > MAX_BODY) return json(413, { error: { message: "The prompt is too large." } }); }
          const input = JSON.parse(raw);
          const parsed = z.object({
            model: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/),
            instructions: z.string().max(64 * 1024),
            messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(262144), files: z.array(storedFileSchema).max(8).optional() }).strict()).min(1).max(500),
            reasoning_effort: z.enum([...efforts]).optional(),
            stream: z.boolean().optional(),
          }).strict().safeParse(input);
          if (!parsed.success || parsed.data.messages.flatMap(message => message.files ?? []).reduce((size, file) => size + file.size, 0) > MAX_REQUEST_FILE_BYTES) return json(400, { error: { message: "Invalid local completion request." } });
          const messages = parsed.data.messages;
          if (input.stream === true) {
            res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
            const emit = (event) => { if (!res.destroyed) res.write(JSON.stringify(event) + "\n"); };
            emit({ type: "status", text: "Request sent to Codex" });
            try {
              const result = await bridge.complete(messages, input.instructions, controller.signal, (text) => emit({ type: "delta", text }), input.model, input.reasoning_effort);
              emit({ type: "done", serviceTier: result.serviceTier, usage: result.usage });
            } catch (error) {
              emit({ type: "error", message: controller.signal.aborted ? "Generation stopped." : error instanceof Error && /^(Codex|Sign in|The Codex)/.test(error.message) ? error.message : "The connection ended. Completed moves have been kept." });
            }
            res.end();
          } else json(200, await bridge.complete(messages, input.instructions, controller.signal, undefined, input.model, input.reasoning_effort));
        } catch (error) {
          json(error instanceof SyntaxError ? 400 : 502, { error: { message: controller.signal.aborted ? "The Codex request was cancelled or timed out." : error instanceof Error && /^(Codex|Sign in|The Codex)/.test(error.message) ? error.message : "Unable to connect to Codex. Check your local sign-in and network connection." } });
        } finally { clearTimeout(timeout); }
      });
    },
  };
}
