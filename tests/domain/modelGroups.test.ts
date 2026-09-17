import { describe, expect, it } from "vitest";
import { groupModels, modelGroupForId } from "../../src/domain/modelGroups";

describe("modelGroupForId", () => {
  it("groups live ids by prefix because the catalog has no provider field", () => {
    expect(modelGroupForId("gpt-5.6-sol")).toBe("OpenAI");
    expect(modelGroupForId("o3")).toBe("OpenAI");
    expect(modelGroupForId("claude-sonnet-5")).toBe("Claude");
    expect(modelGroupForId("deepseek-flash")).toBe("DeepSeek");
    expect(modelGroupForId("glm-5.3")).toBe("GLM");
    expect(modelGroupForId("mystery-model")).toBe("Other");
  });
});

describe("groupModels", () => {
  it("omits empty groups and keeps OpenAI, Claude, DeepSeek, GLM, Other order", () => {
    expect(groupModels([
      { id: "glm-5.3" },
      { id: "custom-a" },
      { id: "claude-sonnet-5" },
      { id: "gpt-6-astra" },
      { id: "deepseek-flash" },
    ]).map((group) => group.name)).toEqual(["OpenAI", "Claude", "DeepSeek", "GLM", "Other"]);
  });
});
