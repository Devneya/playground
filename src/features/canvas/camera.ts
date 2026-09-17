import type { Position, Viewport } from "../../domain/types";
import { LAYOUT } from "../../domain/resultPlacement";

type CardBox = { position: Position; height: number };

// Pan just enough to bring a card into the visible canvas. Does not recenter,
// so the current thread stays on screen when a new card appears nearby.
export const panToRevealCard = (viewport: Viewport, card: CardBox, container: { width: number; height: number }, nodeWidth = LAYOUT.nodeWidth): Viewport | null => {
  const nodeRight = (card.position.x + nodeWidth) * viewport.zoom + viewport.x;
  const nodeBottom = (card.position.y + card.height) * viewport.zoom + viewport.y;
  const visibleBottom = container.height - 48;
  let panY = 0;
  if (nodeBottom > visibleBottom) panY = nodeBottom - visibleBottom;
  const visibleRight = container.width - 24;
  let panX = 0;
  if (nodeRight > visibleRight) panX = nodeRight - visibleRight;
  const nodeLeft = card.position.x * viewport.zoom + viewport.x;
  const nodeTop = card.position.y * viewport.zoom + viewport.y;
  panX = Math.min(panX, nodeLeft - 24);
  panY = Math.min(panY, nodeTop - 24);
  if (panX === 0 && panY === 0) return null;
  return { x: viewport.x - panX, y: viewport.y - panY, zoom: viewport.zoom };
};
