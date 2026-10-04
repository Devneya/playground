import { afterEach, expect, it, vi } from "vitest";
import { streamCompletion } from "../../src/api/streamCompletion";
import { createChatCompletion } from "../../src/api/completions";
import { toBifrostVirtualKey } from "../../src/api/credentials";
const flags = vi.hoisted(() => ({ useLocalCodex: true, completionTimeoutMs: 10000 }));
vi.mock("../../src/config", () => ({ config: flags }));
vi.mock("../../src/api/completions", () => ({ createChatCompletion: vi.fn() }));
const request = { model: "test", messages: [{ role: "user" as const, content: "hello" }], instructions: "test", stream: false as const };
const key = { kind: "local-codex" as const };
const run = (signal = new AbortController().signal) => streamCompletion(key, request, signal, vi.fn(), vi.fn());
const response = (events: object[], trailing = "\n") => {
  const text = events.map((e) => JSON.stringify(e)).join("\n") + trailing;
  return new Response(new ReadableStream({ start(c) { const data = new TextEncoder().encode(text); const size = data.length > 1000 ? 65536 : 7; for (let i = 0; i < data.length; i += size) c.enqueue(data.slice(i, i + size)); c.close(); } }));
};
afterEach(() => { flags.useLocalCodex = true; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("streams UTF-8 output before completion and reports the actual tier", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([{ type: "status", text: "Sent" }, { type: "delta", text: "A 🌱" }, { type: "done", serviceTier: "default" }], "")));
  const delta = vi.fn(), progress = vi.fn();
  await streamCompletion(key, request, new AbortController().signal, delta, progress);
  expect(delta).toHaveBeenCalledWith("A 🌱");
  expect(progress).toHaveBeenLastCalledWith({ text: "Response received", characters: 4, serviceTier: "default" });
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).stream).toBe(true);
});
it("supports ordinary completion credentials without sending them to the local bridge", async () => {
  vi.mocked(createChatCompletion).mockResolvedValue({ content: "move" });
  const delta = vi.fn(), progress = vi.fn();
  await streamCompletion(toBifrostVirtualKey("sk-bf-test-key"), request, new AbortController().signal, delta, progress);
  expect(delta).toHaveBeenCalledWith("move");
  const controller = new AbortController(); controller.abort();
  delta.mockClear();
  await streamCompletion(toBifrostVirtualKey("sk-bf-test-key"), request, controller.signal, delta, progress);
  expect(delta).not.toHaveBeenCalled();
});
it("rejects local credentials outside local mode", async () => {
  flags.useLocalCodex = false;
  await expect(run()).rejects.toThrow("local development");
});
it.each([
  [[], "before completion"],
  [[{ type: "error", message: "Provider failed" }], "Provider failed"],
  [[{ type: "error" }], "connection ended"],
  [[{ type: "delta", text: "x".repeat(262145) }], "size limit"],
])("rejects incomplete and failed streams", async (events, message) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(events as object[])));
  await expect(run()).rejects.toThrow(message as string);
});
it("handles blank/status events and missing optional tier", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([{ type: "status" }, { type: "done" }], "\n\n")));
  await expect(run()).resolves.toEqual({ content: "" });
});
it("rejects HTTP failures, oversized framing, and ignores cancelled output", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 502 })));
  await expect(run()).rejects.toThrow("502");
  vi.mocked(fetch).mockResolvedValue(new Response("x".repeat(524289)));
  await expect(run()).rejects.toThrow("size limit");
  vi.mocked(fetch).mockResolvedValue(response([{ type: "done" }]));
  const controller = new AbortController(); controller.abort();
  await expect(run(controller.signal)).rejects.toThrow("Stopped");
});
