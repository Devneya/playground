import { OnMove, Viewport, XYPosition } from '@xyflow/react';
import { StateCreator } from "zustand";
import { NodeSlice } from "./nodeSlice";
import { EdgeSlice } from "./edgeSlice";
import { SharedSlice } from "./sharedSlice";

export type ViewportSlice = {
  storeViewport: Viewport;

  getStoreViewport: () => Viewport;
  setStoreViewport: (newViewport: Viewport) => void;

  onMoveEnd: OnMove;

  project: (position: XYPosition) => XYPosition;
  pointToRendererPoint: (
    position: XYPosition,
    { x, y, zoom }: Viewport,
    snapToGrid: boolean,
    [snapX, snapY]: number[]
  ) => XYPosition;
};

export const createViewportSlice: StateCreator<
  NodeSlice & EdgeSlice & ViewportSlice & SharedSlice,
  [],
  [],
  ViewportSlice
> = (set, get) => ({
  storeViewport: { x: 0, y: 0, zoom: 1 },

  getStoreViewport() {
    return get().storeViewport;
  },

  setStoreViewport(newViewport) {
    set({
      storeViewport: newViewport,
    });
  },

  onMoveEnd: (_, newVeiwport) => {
    set({
      storeViewport: newVeiwport,
    });
  },

  /**
   * limited functionality
   * snapToGrid and snapGrid variables hardcoded
   * transform ?== viewport
   */
  pointToRendererPoint(pos, { x, y, zoom }, snapToGrid, [snapX, snapY]) {
    const position = {
      x: (pos.x - x) / zoom,
      y: (pos.y - y) / zoom,
    };
    if (snapToGrid) {
      return {
        x: snapX * Math.round(position.x / snapX),
        y: snapY * Math.round(position.y / snapY),
      };
    }
    return position;
  },
  project(position) {
    const transform = get().storeViewport;

    return get().pointToRendererPoint(position, transform, false, [25, 25]);
  },
});
