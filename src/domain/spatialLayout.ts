import { LAYOUT, RESULT_COL_STRIDE } from "./resultPlacement";
import type { FlowDocument, PlaygroundNode } from "./types";

export const CHAT_GAP = 8;
export const cardHeight = (node: PlaygroundNode) => node.measuredHeight ?? LAYOUT.nodeHeight;

// Only cards created with an explicit placement anchor participate. Imported
// or manually positioned cards are obstacles, never targets of a global fit.
export const layoutAutomaticNodes = (flow: FlowDocument): FlowDocument => {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const settled = new Map(flow.nodes.filter((node) => !node.placement).map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const resolve = (node: PlaygroundNode): PlaygroundNode => {
    const existing = settled.get(node.id);
    if (existing) return existing;
    if (!node.placement || visiting.has(node.id)) return node;
    visiting.add(node.id);
    const source = byId.get(node.placement.anchorId);
    if (!source) { settled.set(node.id, node); return node; }
    const anchor = resolve(source);
    const position = {
      x: anchor.position.x + node.placement.offsetX,
      y: anchor.position.y + (node.placement.direction === "below" ? cardHeight(anchor) + CHAT_GAP : node.placement.direction === "above" ? -cardHeight(node) - CHAT_GAP : 0),
    };
    for (let tries = 0; tries <= flow.nodes.length; tries += 1) {
      const obstruction = [...settled.values()].find((other) => other.id !== node.id && other.id !== anchor.id &&
        position.x < other.position.x + LAYOUT.nodeWidth && position.x + LAYOUT.nodeWidth > other.position.x &&
        position.y < other.position.y + cardHeight(other) + CHAT_GAP && position.y + cardHeight(node) + CHAT_GAP > other.position.y);
      if (!obstruction) break;
      if (node.placement.direction === "above") position.y = obstruction.position.y - cardHeight(node) - CHAT_GAP;
      else if (node.placement.direction === "right" || node.placement.offsetX !== 0) position.x += RESULT_COL_STRIDE;
      else position.y = obstruction.position.y + cardHeight(obstruction) + CHAT_GAP;
    }
    const placed = position.x === node.position.x && position.y === node.position.y ? node : { ...node, position };
    settled.set(node.id, placed);
    visiting.delete(node.id);
    return placed;
  };
  const nodes = flow.nodes.map(resolve);
  return nodes.every((node, index) => node === flow.nodes[index]) ? flow : { ...flow, nodes };
};

export const detachPlacement = (node: PlaygroundNode): PlaygroundNode => {
  const { placement: _placement, ...detached } = node;
  return detached;
};
