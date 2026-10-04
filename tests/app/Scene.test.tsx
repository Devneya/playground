import { act, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Scene, sceneDocument } from "../../src/features/surface/Scene";
import { sceneStateSchema } from "../../src/domain/sceneState";
import { surfaceObjectSchema, applySurfaceOperations, emptySurface, type SurfaceObject } from "../../src/domain/surface";

const scene: SurfaceObject = { id: "experiment", kind: "scene", title: "Experiment", x: 0, y: 0, width: 900, height: 500, color: "ink", html: "<button>Move</button>", state: { moves: 0 }, interaction: "Move the object" };
it("accepts only bounded primitive state and requires a usable scene description", () => {
  expect(sceneStateSchema.safeParse({ text: "test", value: 1, active: true, choices: [1, "two", null], absent: null }).success).toBe(true);
  for (const invalid of [{ nested: { value: 1 } }, { value: Infinity }, { text: "x".repeat(1001) }, { items: Array(101).fill(1) }, Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`key${i}`, i])), { constructor: "bad" }, Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`key${i}`, "x".repeat(1000)]))]) expect(sceneStateSchema.safeParse(invalid).success).toBe(false);
  expect(surfaceObjectSchema.safeParse({ ...scene, html: undefined }).success).toBe(false);
  expect(surfaceObjectSchema.safeParse({ ...scene, interaction: undefined }).success).toBe(false);
});
it("isolates code, escapes restored state and ignores messages from other or old documents", () => {
  const onState = vi.fn();
  const { container, rerender } = render(<Scene object={scene} onState={onState} />);
  const frame = container.querySelector("iframe")!;
  const token = () => /token:"([^"]+)"/.exec(frame.srcdoc)![1];
  const firstToken = token();
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.srcdoc).toContain("connect-src 'none'");
  expect(frame.srcdoc).toContain("form-action 'none'");
  const post = (source: MessageEventSource | null, data: unknown) => act(() => window.dispatchEvent(new MessageEvent("message", { source, data })));
  post(window, { type: "devneya:state", token: firstToken, state: { moves: 1 } });
  post(frame.contentWindow, { type: "devneya:state", token: "wrong", state: { moves: 1 } });
  post(frame.contentWindow, { type: "devneya:state", token: firstToken, state: { nested: {} } });
  post(frame.contentWindow, { type: "devneya:state", token: firstToken, state: { moves: 0 } });
  post(frame.contentWindow, { type: "devneya:request", token: firstToken, prompt: "No automatic model calls" });
  expect(onState).not.toHaveBeenCalled();
  post(frame.contentWindow, { type: "devneya:state", token: firstToken, state: { moves: 2 } });
  expect(onState).toHaveBeenCalledExactlyOnceWith({ moves: 2 });
  const originalDocument = frame.srcdoc;
  rerender(<Scene object={{ ...scene, state: { moves: 2 } }} onState={onState} />);
  expect(frame.srcdoc).toBe(originalDocument);
  rerender(<Scene object={{ ...scene, html: "<button>Another instrument</button>" }} onState={onState} />);
  expect(token()).not.toBe(firstToken);
  post(frame.contentWindow, { type: "devneya:state", token: firstToken, state: { moves: 8 } });
  expect(onState).toHaveBeenCalledTimes(1);
  const malicious = sceneDocument("<p>Safe</p>", { value: '</script><img src="https://example.invalid/leak">' }, "test-token");
  expect(malicious).not.toContain('</script><img');
  expect(malicious).toContain('\\u003c/script>');
});
it("preserves scene interaction state across model code revisions and rejects conflicting resets", () => {
  const base = { ...emptySurface(), objects: [scene] };
  const human = applySurfaceOperations(base, base, [{ op: "edit", id: scene.id, changes: { state: { moves: 3 } } }]).surface;
  const revised = applySurfaceOperations(human, base, [{ op: "edit", id: scene.id, changes: { html: "<button>New control</button>" } }]).surface;
  expect(revised.objects[0]?.state).toEqual({ moves: 3 });
  expect(() => applySurfaceOperations(human, base, [{ op: "edit", id: scene.id, changes: { state: { moves: 0 } } }])).toThrow("Your work has been kept");
});
