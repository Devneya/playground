import {
  Edge,
  EdgeChange,
  MarkerType,
  OnEdgesChange,
  applyEdgeChanges,
} from "@xyflow/react";
import {StateCreator} from "zustand";
import {NodeSlice} from "./nodeSlice";
import {SharedSlice} from "./sharedSlice";
import {ViewportSlice} from "./viewportSlice";

export type FloatingEdgeData = { hovered: boolean };
export type FloatingEdge = Edge<FloatingEdgeData>;

export type AddNewEdgeError = "cycle" | "second-input" | "inner-error";

export type EdgeSlice = {
  edges: FloatingEdge[];

  _setEdges: (
    transform: FloatingEdge[] | ((edges: FloatingEdge[]) => FloatingEdge[])
  ) => void;
  addNewEdge: (fromId: string, toId: string) => FloatingEdge | undefined;
  deleteEdge: (id: string) => void;

  onEdgesChange: OnEdgesChange;

  setMouseHovered: (edgeId: string, hovered: boolean) => void;
  onEdgeMouseEnter: (event: React.MouseEvent, edge: FloatingEdge) => void;
  onEdgeMouseLeave: (event: React.MouseEvent, edge: FloatingEdge) => void;
};

export const createEdgeSlice: StateCreator<
  NodeSlice & EdgeSlice & ViewportSlice & SharedSlice,
  [],
  [],
  EdgeSlice
> = (set, get) => ({
  edges: [],

  _setEdges(transform) {
    if (Array.isArray(transform))
      set({
        edges: transform,
      });
    else
      set({
        edges: transform(get().edges),
      });
  },

  addNewEdge(fromId, toId) {
    if (
      get().edges.find(
        (edge) => edge.source === fromId && edge.target === toId
      ) ||
      fromId === toId
    ) {
      return undefined;
    }
    const newEdge: FloatingEdge = {
      id: `e${fromId}-${toId}`,
      source: fromId,
      target: toId,
      style: {
        stroke: "text.secondary",
      },
      markerStart: "edgeStart",
      markerEnd: {
        type: MarkerType.Arrow,
        width: 25,
        height: 25,
      },
      type: "floating",
      data: {hovered: false},
    };
    set({
      edges: [...get().edges, newEdge],
    });
    // console.log(`New edge ${newEdge.id} created`);
    get().scheduleSave();
    return newEdge;
  },

  deleteEdge(id) {
    // console.log(`Edge with id ${id} deleted.`);
    set({
      edges: get().edges.filter((e) => e.id !== id),
    });
    get().scheduleSave();
  },

  onEdgesChange(changes: EdgeChange[]) {
    set({
      edges: applyEdgeChanges(changes, get().edges) as FloatingEdge[],
    });
    if (changes.length > 0) {
      get().scheduleSave();
    }
  },

  setMouseHovered(edgeId, hovered) {
    set({
      edges: get().edges.map((edge) => {
        if (edge.id === edgeId) {
          edge.data = {
            ...edge.data,
            hovered: hovered,
          };
        }
        return edge;
      }),
    });
  },

  onEdgeMouseEnter(event, edge) {
    get().setMouseHovered(edge.id, true);
  },

  onEdgeMouseLeave(event, edge) {
    get().setMouseHovered(edge.id, false);
  },
});
