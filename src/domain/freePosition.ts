import type { Position } from "./types";

type Box = Position & { width: number; height: number };

/** Find a nearby empty rectangle using the actual sizes of existing cards. */
export const findFreePosition = (preferred: Position, size: { width: number; height: number }, occupied: Box[], minimumX = -Infinity, gap = 24): Position => {
  const initial = { x: Math.max(preferred.x, minimumX), y: preferred.y };
  const distance = (point: Position) => (point.x - initial.x) ** 2 + (point.y - initial.y) ** 2;
  const pending = [initial];
  const visited = new Set<string>();
  for (let attempts = 0; pending.length && attempts < 5000; attempts += 1) {
    pending.sort((a, b) => distance(a) - distance(b));
    const point = pending.shift()!;
    const key = `${point.x}:${point.y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const obstacle = occupied.find(box => point.x < box.x + box.width + gap && point.x + size.width + gap > box.x && point.y < box.y + box.height + gap && point.y + size.height + gap > box.y);
    if (!obstacle) return point;
    pending.push(...[
      { x: obstacle.x + obstacle.width + gap, y: point.y },
      { x: obstacle.x - size.width - gap, y: point.y },
      { x: point.x, y: obstacle.y + obstacle.height + gap },
      { x: point.x, y: obstacle.y - size.height - gap },
    ].filter(candidate => candidate.x >= minimumX && !visited.has(`${candidate.x}:${candidate.y}`)));
  }
  return { x: initial.x, y: Math.max(initial.y, ...occupied.map(box => box.y + box.height + gap)) };
};
