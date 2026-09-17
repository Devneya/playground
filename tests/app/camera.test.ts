import { describe, expect, it } from "vitest";
import { panToRevealCard } from "../../src/features/canvas/camera";

describe("panToRevealCard", () => {
  it("returns null when the card is already in view", () => {
    expect(panToRevealCard({ x: 0, y: 0, zoom: 1 }, { position: { x: 40, y: 40 }, height: 120 }, { width: 800, height: 600 })).toBeNull();
  });

  it("pans only enough to reveal an overflowing card", () => {
    expect(panToRevealCard({ x: 0, y: 0, zoom: 1 }, { position: { x: 400, y: 500 }, height: 240 }, { width: 800, height: 600 })).toEqual({ x: -104, y: -188, zoom: 1 });
  });
});
