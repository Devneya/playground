import type { FlowDocument, Position } from "./types";

// Card geometry shared with the canvas CSS. Cards render at 480px wide; the
// taller Generation/continuation card drives the overlap-check height.
// (Measured heights: generation ~241px, result ~101px.)
export const LAYOUT = {
  nodeWidth: 480,
  nodeHeight: 200,
} as const;

// Horizontal distance between sibling answer cards in the side-by-side result
// row and between parallel fork columns. Cards are 480px wide, so a 520px
// stride leaves a 40px gutter between columns.
export const RESULT_COL_STRIDE = 520;
// Vertical distance from a Generation card's top to its result row's top.
// Generation cards are ~241px tall, so 300 yields a ~59px visual gap.
export const GEN_TO_RESULT_STRIDE = 300;
// Vertical distance from a result card's top to the card directly below it
// (a continuation Generation). Result cards are ~101px tall, so 160 yields a
// ~59px visual gap.
export const RESULT_TO_CONTINUATION_STRIDE = 160;
// Vertical spacing between successive result rows, used when re-running a
// generation so fresh answers clear the previous row and its continuations.
export const RESULT_ROW_STRIDE = 460;

type Rect = { x: number; y: number; width: number; height: number };
const rectFor = (position: Position): Rect => ({ ...position, width: LAYOUT.nodeWidth, height: LAYOUT.nodeHeight });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const placeNewResultNodes = (flow: FlowDocument, generationNodeId: string, count: number): Position[] => {
  const generation = flow.nodes.find((node) => node.id === generationNodeId);
  if (!generation || count < 1) return [];
  // Sibling results form a horizontal answer row directly below the
  // generation node, reading like a chat's multi-model response. Each
  // result_i sits one column to the right so the row stays side by side
  // (the fork point, where each answer can continue its own thread down).
  const occupied = flow.nodes.filter((node) => node.id !== generationNodeId).map((node) => rectFor(node.position));
  for (let row = 0; row < 1000; row += 1) {
    const baseY = generation.position.y + GEN_TO_RESULT_STRIDE + row * RESULT_ROW_STRIDE;
    const positions = Array.from({ length: count }, (_, index) => ({
      x: generation.position.x + index * RESULT_COL_STRIDE,
      y: baseY,
    }));
    if (positions.every((position) => !occupied.some((existing) => overlaps(rectFor(position), existing)))) return positions;
  }
  const baseY = generation.position.y + GEN_TO_RESULT_STRIDE + 1000 * RESULT_ROW_STRIDE;
  return Array.from({ length: count }, (_, index) => ({
    x: generation.position.x + index * RESULT_COL_STRIDE,
    y: baseY,
  }));
};
