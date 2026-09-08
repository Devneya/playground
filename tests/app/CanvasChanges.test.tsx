import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { NodeChange } from "@xyflow/react";
import { WorkspaceCanvas } from "../../src/features/canvas/WorkspaceCanvas";

const state = vi.hoisted(() => ({ dispatch: vi.fn(), onNodesChange: (_changes: NodeChange[]) => {} }));
vi.mock("../../src/features/workspace/useWorkspace", () => ({ useWorkspace: () => ({
  activeFlow: { id: "flow", nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, dispatch: state.dispatch,
}) }));
vi.mock("@xyflow/react", async (original) => ({ ...await original<object>(), ReactFlow: (props: { onNodesChange: typeof state.onNodesChange }) => {
  state.onNodesChange = props.onNodesChange;
  return null;
} }));

beforeEach(() => { vi.clearAllMocks(); render(<WorkspaceCanvas />); });

it("does not detach automatic placement for measurement-generated positions", () => {
  state.onNodesChange([
    { id: "answer", type: "dimensions", dimensions: { width: 480, height: 76 } },
    { id: "answer", type: "position", position: { x: 0, y: 316 } },
    { id: "answer", type: "position", position: { x: 0, y: 316 }, dragging: false },
  ]);
  expect(state.dispatch.mock.calls.map(([action]) => action.type)).toEqual(["node/measure"]);
});

it("detaches placement when the user actually drags a card", () => {
  state.onNodesChange([{ id: "answer", type: "position", position: { x: 23, y: 71 }, dragging: true }]);
  expect(state.dispatch).toHaveBeenCalledWith({ type: "node/move", flowId: "flow", nodeId: "answer", position: { x: 23, y: 71 } });
});
