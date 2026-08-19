import { describe, expect, it } from "vitest";
import { buildCompletionMessagesV1 } from "../../src/domain/completion";

describe("buildCompletionMessagesV1", () => {
  const input = { nodeId: "text-1", title: "Source", text: "Hello" };

  it("passes one input through unchanged when instruction is blank", () => {
    expect(buildCompletionMessagesV1([input], "")).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("uses the instruction unchanged when there are no inputs", () => {
    expect(buildCompletionMessagesV1([], "Translate this")).toEqual([{ role: "user", content: "Translate this" }]);
  });

  it("labels multiple inputs and appends a nonblank instruction", () => {
    expect(buildCompletionMessagesV1([input, { ...input, nodeId: "text-2", title: "Second", text: "World" }], "Summarize")).toEqual([
      { role: "user", content: "### Input 1: Source\nHello\n\n### Input 2: Second\nWorld\n\n### Instruction\nSummarize" },
    ]);
  });

  it("preserves content while omitting a blank instruction section", () => {
    expect(buildCompletionMessagesV1([input, { ...input, nodeId: "text-2", title: "Second", text: "World" }], "  "))
      .toEqual([{ role: "user", content: "### Input 1: Source\nHello\n\n### Input 2: Second\nWorld" }]);
  });
});
