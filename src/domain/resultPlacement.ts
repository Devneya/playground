import type { FlowDocument, Position } from "./types";

export const LAYOUT = { nodeWidth: 300, nodeHeight: 220, horizontalStride: 360, verticalStride: 260 } as const;
type Rect = { x: number; y: number; width: number; height: number };
const rectFor = (position: Position): Rect => ({ ...position, width: LAYOUT.nodeWidth, height: LAYOUT.nodeHeight });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const placeNewResultNodes = (flow: FlowDocument, generationNodeId: string, count: number): Position[] => {
  const generation = flow.nodes.find((node) => node.id === generationNodeId);
  if (!generation || count < 1) return [];
  const occupied = flow.nodes.filter((node) => node.id !== generationNodeId).map((node) => rectFor(node.position));
  for (let column = 1; column < 1000; column += 1) {
    const positions = Array.from({ length: count }, (_, index) => ({ x: generation.position.x + column * LAYOUT.horizontalStride, y: generation.position.y + index * LAYOUT.verticalStride }));
    if (positions.every((position) => !occupied.some((existing) => overlaps(rectFor(position), existing)))) return positions;
  }
  return Array.from({ length: count }, (_, index) => ({ x: generation.position.x + 1000 * LAYOUT.horizontalStride, y: generation.position.y + index * LAYOUT.verticalStride }));
};
