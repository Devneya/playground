import type { FlowDocument, Position } from "./types";

// Card geometry shared with the canvas CSS. Cards render at 480px wide.
// nodeHeight is a conservative fallback before DOM measurement. The spatial
// layout uses actual heights and an 8px gap once cards have been measured.
export const LAYOUT = {
  nodeWidth: 480,
  nodeHeight: 240,
} as const;

// Horizontal distance between sibling answer cards in the side-by-side result
// row and between parallel fork columns: 480px cards plus a 24px gutter.
export const RESULT_COL_STRIDE = 504;
// Legacy fallback placement strides; automatic spatial anchors supersede
// these positions during creation and subsequent measurement.
export const GEN_TO_RESULT_STRIDE = 315;
// Vertical distance from a result card's top to the card directly below it
// (a continuation Generation). Result cards are ~85px tall, so 165 yields an
// ~80px visual gap.
export const RESULT_TO_CONTINUATION_STRIDE = 165;
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
