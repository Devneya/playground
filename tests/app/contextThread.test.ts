import { describe, expect, it } from "vitest";
import { contextThread } from "../../src/features/canvas/contextLabel";

describe("contextThread", () => {
  it("puts the current prompt ahead of prior turns", () => {
    expect(contextThread("Hello", [{ role: "assistant", content: "Hi", nodeId: "a", modelId: "model-a" }])).toEqual([
      { role: "user", content: "Hello", nodeId: "instruction" },
      { role: "assistant", content: "Hi", nodeId: "a", modelId: "model-a" },
    ]);
  });

  it("skips a blank prompt", () => {
    expect(contextThread("  ", [{ role: "user", content: "Earlier", nodeId: "u" }])).toEqual([{ role: "user", content: "Earlier", nodeId: "u" }]);
  });
});
