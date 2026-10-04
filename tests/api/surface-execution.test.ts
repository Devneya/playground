import { afterEach, expect, it, vi } from "vitest";
import { createChatCompletion } from "../../src/api/completions";
import { toBifrostVirtualKey } from "../../src/api/credentials";
import { startSurfaceRun } from "../../src/features/execution/executeSurface";
import { emptySurface, type SurfaceObject } from "../../src/domain/surface";
import { LIMITS } from "../../src/domain/limits";

vi.mock("../../src/api/completions", () => ({ createChatCompletion: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const options = () => ({ id: "run", flowId: "flow", surface: emptySurface(), instruction: "Make a model", selectedIds: [], model: "model-a", credential: toBifrostVirtualKey("sk-bf-test-key"), dispatch: vi.fn(), canDispatch: () => true });
const response = { summary: "Added a thought", operations: [{ op: "create", object: { id: "idea", kind: "text", title: "An idea", x: 0, y: 0, width: 300, height: 100, color: "ink" } }], actions: [] };
it("sends current state and applies a complete validated operation transaction", async () => {
  vi.mocked(createChatCompletion).mockResolvedValue({ content: '```json\n'+JSON.stringify(response)+'\n```' });
  const opts = options();
  await startSurfaceRun(opts).completed;
  expect(createChatCompletion).toHaveBeenCalledWith(opts.credential, expect.objectContaining({ model: "model-a", stream: false, instructions: expect.stringContaining("PATCH only") }), expect.any(AbortSignal));
  expect(opts.dispatch).toHaveBeenCalledOnce();
  expect(opts.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "surface/acted", flowId: "flow", reply: response, base: emptySurface() }));
});
it("freezes the starting state and ignores cancelled or stale requests", async () => {
  let resolve!: (value: {content: string}) => void;
  vi.mocked(createChatCompletion).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const opts = options();
  const run = startSurfaceRun(opts);
  opts.surface.objects.push({ id: "later", kind: "text", title: "Later", x: 0, y: 0, width: 200, height: 50, color: "ink" });
  resolve({ content: JSON.stringify(response) });
  await run.completed;
  expect(opts.dispatch.mock.calls[0]![0].base.objects).toEqual([]);
  const cancelled = options();
  const cancelledRun = startSurfaceRun(cancelled);
  cancelledRun.cancel(); resolve({ content: JSON.stringify(response) }); await cancelledRun.completed;
  expect(cancelled.dispatch).not.toHaveBeenCalled();
  vi.mocked(createChatCompletion).mockResolvedValue({ content: JSON.stringify(response) });
  const stale = { ...options(), canDispatch: () => false };
  await startSurfaceRun(stale).completed;
  expect(stale.dispatch).not.toHaveBeenCalled();
});
it.each(['not JSON', '{"summary":"Unsupported","operations":[{"op":"exec","cmd":"rm"}]}', 'x'.repeat(LIMITS.maxGeneratedBytes + 1)])("does not apply invalid or oversized results", async (content) => {
  vi.mocked(createChatCompletion).mockResolvedValue({ content });
  const opts = options();
  await expect(startSurfaceRun(opts).completed).rejects.toThrow();
  expect(opts.dispatch).not.toHaveBeenCalled();
});
it("rejects empty instructions and oversized workspace context before sending", () => {
  expect(() => startSurfaceRun({ ...options(), instruction: " " })).toThrow();
  expect(() => startSurfaceRun({ ...options(), instruction: "x".repeat(8001) })).toThrow();
  const huge = options();
  huge.surface.objects = [{ id: "large", kind: "text", title: "large", text: "x".repeat(LIMITS.maxPromptBytes), x: 0, y: 0, width: 300, height: 100, color: "ink" } as SurfaceObject];
  expect(() => startSurfaceRun(huge)).toThrow("too large");
  expect(createChatCompletion).not.toHaveBeenCalled();
});
