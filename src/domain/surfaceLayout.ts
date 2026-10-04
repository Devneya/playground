import type { SurfaceObject } from "./surface";

/** Preserve authored gaps when rendered content exceeds the model's estimated height.
 * Regions intentionally contain other objects and do not participate in this pass.
 * Authored coordinates remain stable; drag commits the displayed position.
 */
export const surfacePositions = (objects: SurfaceObject[], measured: Record<string, { height: number }>) => {
  const placed: SurfaceObject[] = [];
  const positions: Record<string, { x: number; y: number }> = {};
  for (const object of [...objects].sort((a, b) => a.y - b.y)) {
    let y = object.y;
    if (object.kind !== "region") {
      for (const above of placed) {
        const gap = object.y - (above.y + above.height);
        if (gap < 0 || object.x >= above.x + above.width || object.x + object.width <= above.x) continue;
        y = Math.max(y, positions[above.id]!.y + Math.max(above.height, measured[above.id]?.height ?? above.height) + gap);
      }
      placed.push(object);
    }
    positions[object.id] = { x: object.x, y };
  }
  return positions;
};
