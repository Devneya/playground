import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CameraFollow } from "../../src/features/canvas/WorkspaceCanvas";
import type { PlaygroundNode } from "../../src/domain/types";

const camera = vi.hoisted(() => ({
  getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  setViewport: vi.fn(),
}));
vi.mock("@xyflow/react", async (original) => ({ ...await original<object>(), useReactFlow: () => camera }));

const result = (id: string, x: number, y: number): PlaygroundNode => ({
  id, position: { x, y }, measuredHeight: 240, createdAt: "", updatedAt: "",
  data: { kind: "text", origin: "generated", title: id, text: "Answer", batchId: "batch", executionId: id },
});

beforeEach(() => {
  vi.clearAllMocks();
  camera.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  const shell = document.createElement("div");
  shell.className = "canvas-shell";
  const canvas = document.createElement("div");
  canvas.className = "react-flow";
  canvas.getBoundingClientRect = () => ({ x: 200, y: 100, left: 200, top: 100, right: 1000, bottom: 700, width: 800, height: 600, toJSON: () => ({}) });
  shell.append(canvas);
  document.body.replaceChildren(shell);
});

it("reveals a new result within canvas bounds even when the canvas is offset on the page", () => {
  const { rerender } = render(<CameraFollow flowId="flow" nodes={[]} edges={[]} />);
  rerender(<CameraFollow flowId="flow" nodes={[result("new", 400, 500)]} edges={[]} />);
  expect(camera.setViewport).toHaveBeenCalledWith({ x: -104, y: -188, zoom: 1 }, { duration: 400 });
});

it("follows the added branch instead of an older, more distant node", () => {
  const old = result("old", 3000, 3000);
  const { rerender } = render(<CameraFollow flowId="flow" nodes={[old]} edges={[]} />);
  rerender(<CameraFollow flowId="flow" nodes={[old, result("new", 50, 50)]} edges={[]} />);
  expect(camera.setViewport).not.toHaveBeenCalled();
});

it("reveals branches above and left of a panned, zoomed viewport", () => {
  camera.getViewport.mockReturnValue({ x: -1000, y: -1000, zoom: 0.5 });
  const { rerender } = render(<CameraFollow flowId="flow" nodes={[]} edges={[]} />);
  rerender(<CameraFollow flowId="flow" nodes={[result("new", 0, 0)]} edges={[]} />);
  expect(camera.setViewport).toHaveBeenCalledWith({ x: 24, y: 24, zoom: 0.5 }, { duration: 400 });
});

it("leaves toolbar additions and flow restoration to their own camera handlers", () => {
  const manual: PlaygroundNode = { ...result("manual", 3000, 3000), data: { kind: "generation", title: "Prompt", instruction: "", modelIds: [] } };
  const { rerender } = render(<CameraFollow flowId="flow" nodes={[]} edges={[]} />);
  rerender(<CameraFollow flowId="flow" nodes={[manual]} edges={[]} />);
  rerender(<CameraFollow flowId="other" nodes={[result("restored", 5000, 5000)]} edges={[]} />);
  expect(camera.setViewport).not.toHaveBeenCalled();
});

it("follows a newly connected continuation prompt", () => {
  const answer = result("answer", 0, 0);
  const prompt: PlaygroundNode = { ...result("prompt", 0, 700), data: { kind: "generation", title: "Prompt", instruction: "", modelIds: [] } };
  const { rerender } = render(<CameraFollow flowId="flow" nodes={[answer]} edges={[]} />);
  rerender(<CameraFollow flowId="flow" nodes={[answer, prompt]} edges={[{ id: "input", kind: "input", source: answer.id, target: prompt.id, order: 0 }]} />);
  expect(camera.setViewport).toHaveBeenCalledWith({ x: 24, y: -388, zoom: 1 }, { duration: 400 });
});
