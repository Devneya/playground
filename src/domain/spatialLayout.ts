import { LAYOUT, RESULT_COL_STRIDE } from "./resultPlacement";
import { findFreePosition } from "./freePosition";
import type { FlowDocument, PlaygroundNode } from "./types";

export const CHAT_GAP = 8;
export const IDEA_WIDTH = 340;
export const IDEA_GAP = 24;
export const ATLAS_WIDTH = 384;
export const cardWidth = (node: PlaygroundNode) => {
  if (node.data.kind !== "text" || node.data.origin !== "generated" || !node.data.presentation) return LAYOUT.nodeWidth;
  if (node.data.presentation === "atlas") return ATLAS_WIDTH;
  if (node.data.presentation === "visual") return node.data.wide ? 1000 : 704;
  if (node.data.presentation === "support") return 400;
  return node.data.wide ? IDEA_WIDTH * 2 + IDEA_GAP : IDEA_WIDTH;
};
export const cardHeight = (node: PlaygroundNode) => node.measuredHeight ?? LAYOUT.nodeHeight;

// Only cards created with an explicit placement anchor participate. Imported
// or manually positioned cards are obstacles, never targets of a global fit.
export const layoutAutomaticNodes = (flow: FlowDocument): FlowDocument => {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const settled = new Map(flow.nodes.filter((node) => !node.placement && !node.gridPlacement).map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const resolve = (node: PlaygroundNode): PlaygroundNode => {
    const existing = settled.get(node.id);
    if (existing) return existing;
    if (node.gridPlacement && !visiting.has(node.id)) {
      visiting.add(node.id);
      const grid = node.gridPlacement;
      const source = byId.get(grid.anchorId);
      if (!source) { settled.set(node.id, node); return node; }
      const anchor = resolve(source);
      const group = flow.nodes.filter((item) => item.gridPlacement?.anchorId === grid.anchorId);
      if (grid.layout === "spread") {
        const ordered = [...group].sort((a, b) => a.gridPlacement!.row - b.gridPlacement!.row || a.gridPlacement!.col - b.gridPlacement!.col);
        const visuals = ordered.filter((member) => member.data.kind === "text" && member.data.origin === "generated" && member.data.artifact);
        const notes = ordered.filter((member) => !visuals.includes(member));
        const stageWidth = visuals.length > 1 ? 1456 : 1000;
        const stageX = anchor.position.x + (cardWidth(anchor) - stageWidth) / 2;
        const top = anchor.position.y + cardHeight(anchor) + IDEA_GAP;
        const columnY = [top, top + 70];
        const positions = visuals.map((member, index) => {
          const column = index % 2;
          const position = { x: stageX + (visuals.length > 1 ? column * 752 : (1000 - cardWidth(member)) / 2), y: columnY[column]! };
          columnY[column]! += cardHeight(member) + 48;
          return { member, position };
        });
        // Supporting thoughts are satellites, never a single descending transcript.
        // Alternate the sides of the stage; pack each side independently.
        const sideY = [anchor.position.y + cardHeight(anchor) + 90, anchor.position.y + cardHeight(anchor) + 220];
        notes.forEach((member, index) => {
          const side = index % 2;
          positions.push({ member, position: { x: side === 0 ? stageX - cardWidth(member) - 48 : stageX + stageWidth + 48, y: sideY[side]! } });
          sideY[side]! += cardHeight(member) + 48;
        });
        let shiftY = 0;
        for (let tries = 0; tries <= flow.nodes.length; tries += 1) {
          const collision = positions.flatMap(({ member, position }) => {
            const obstacle = [...settled.values()].find((other) => other.id !== anchor.id && other.gridPlacement?.anchorId !== grid.anchorId &&
              position.x < other.position.x + cardWidth(other) && position.x + cardWidth(member) > other.position.x &&
              position.y + shiftY < other.position.y + cardHeight(other) + IDEA_GAP && position.y + shiftY + cardHeight(member) + IDEA_GAP > other.position.y);
            return obstacle ? [{ obstacle, position }] : [];
          })[0];
          if (!collision) break;
          shiftY = collision.obstacle.position.y + cardHeight(collision.obstacle) + IDEA_GAP - collision.position.y;
        }
        for (const { member, position } of positions) settled.set(member.id, { ...member, position: { x: position.x, y: position.y + shiftY } });
        visiting.delete(node.id);
        return settled.get(node.id)!;
      }
      const heights = Array.from({ length: Math.max(...group.map((item) => item.gridPlacement!.row)) + 1 }, (_, row) => { const members = group.filter((item) => item.gridPlacement!.row === row); return members.length ? Math.max(...members.map(cardHeight)) : LAYOUT.nodeHeight; });
      const columnWidth = grid.layout === "atlas" ? ATLAS_WIDTH : IDEA_WIDTH;
      const stride = grid.below ? columnWidth + IDEA_GAP : RESULT_COL_STRIDE;
      const gap = grid.below ? IDEA_GAP : CHAT_GAP;
      const width = grid.columns * stride - (grid.below ? IDEA_GAP : RESULT_COL_STRIDE - LAYOUT.nodeWidth);
      const x = grid.below ? anchor.position.x + (cardWidth(anchor) - width) / 2 : anchor.position.x + RESULT_COL_STRIDE;
      let y = anchor.position.y + (grid.below ? cardHeight(anchor) + IDEA_GAP : 0);
      const height = heights.reduce((sum, h) => sum + h + gap, 0);
      // Shift the entire rectangle together; deliberate empty cells stay empty.
      for (let tries = 0; tries <= flow.nodes.length; tries += 1) {
        const obstacle = [...settled.values()].find((other) => other.id !== anchor.id && other.gridPlacement?.anchorId !== grid.anchorId && x < other.position.x + cardWidth(other) && x + width > other.position.x && y < other.position.y + cardHeight(other) + CHAT_GAP && y + height > other.position.y);
        if (!obstacle) break;
        y = obstacle.position.y + cardHeight(obstacle) + CHAT_GAP;
      }
      for (const member of group) {
        const cell = member.gridPlacement!;
        settled.set(member.id, { ...member, position: { x: x + cell.col * stride, y: y + heights.slice(0, cell.row).reduce((sum, h) => sum + h + gap, 0) } });
      }
      visiting.delete(node.id);
      return settled.get(node.id)!;
    }
    if (!node.placement || visiting.has(node.id)) return node;
    visiting.add(node.id);
    const source = byId.get(node.placement.anchorId);
    if (!source) { settled.set(node.id, node); return node; }
    const anchor = resolve(source);
    let position = {
      x: anchor.position.x + node.placement.offsetX,
      y: anchor.position.y + (node.placement.direction === "below" ? cardHeight(anchor) + CHAT_GAP : node.placement.direction === "above" ? -cardHeight(node) - CHAT_GAP : 0),
    };
    if (node.placement.direction === "right" && node.data.kind === "text" && node.data.origin === "manual") {
      position = findFreePosition(position, { width: cardWidth(node), height: cardHeight(node) }, [...settled.values()].filter(other => other.id !== node.id && other.id !== anchor.id).map(other => ({ ...other.position, width: cardWidth(other), height: cardHeight(other) })), position.x);
    }
    for (let tries = 0; tries <= flow.nodes.length; tries += 1) {
      const obstruction = [...settled.values()].find((other) => other.id !== node.id && other.id !== anchor.id &&
        position.x < other.position.x + cardWidth(other) && position.x + cardWidth(node) > other.position.x &&
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
  const { placement: _placement, gridPlacement: _gridPlacement, ...detached } = node;
  return detached;
};
