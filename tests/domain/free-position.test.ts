import { describe, expect, it } from "vitest";
import { findFreePosition } from "../../src/domain/freePosition";

describe("findFreePosition", () => {
  it("uses an obstacle's actual width when placing to its right", () => {
    const preferred = { x: 100, y: 100 };
    const position = findFreePosition(
      preferred,
      { width: 200, height: 200 },
      [{ x: 100, y: 100, width: 40, height: 500 }],
      preferred.x,
    );

    expect(position).toEqual({ x: 164, y: 100 });
  });

  it("uses an obstacle's actual height when placing below it", () => {
    const preferred = { x: 100, y: 100 };
    const position = findFreePosition(
      preferred,
      { width: 200, height: 200 },
      [{ x: 100, y: 100, width: 500, height: 40 }],
      preferred.x,
    );

    expect(position).toEqual({ x: 100, y: 164 });
  });

  it("keeps the result at or to the right of the optional minimum X", () => {
    const position = findFreePosition(
      { x: -50, y: 25 },
      { width: 100, height: 100 },
      [],
      120,
    );

    expect(position).toEqual({ x: 120, y: 25 });
  });

  it("does not search left of the optional minimum X when clearing an obstacle", () => {
    const position = findFreePosition(
      { x: 120, y: 100 },
      { width: 50, height: 200 },
      [{ x: 120, y: 100, width: 300, height: 300 }],
      120,
    );

    expect(position).toEqual({ x: 120, y: -124 });
  });
});
