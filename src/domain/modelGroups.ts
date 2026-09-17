export const MODEL_GROUP_ORDER = ["OpenAI", "Claude", "DeepSeek", "GLM", "Other"] as const;

export type ModelGroupName = (typeof MODEL_GROUP_ORDER)[number];

export const modelGroupForId = (id: string): ModelGroupName => {
  const value = id.toLowerCase();
  if (value.startsWith("gpt-") || /^o[0-9]/.test(value)) return "OpenAI";
  if (value.startsWith("claude-")) return "Claude";
  if (value.startsWith("deepseek-")) return "DeepSeek";
  if (value.startsWith("glm-")) return "GLM";
  return "Other";
};

export const groupModels = <T extends { id: string }>(models: T[]): { name: ModelGroupName; models: T[] }[] => {
  const buckets = new Map<ModelGroupName, T[]>(MODEL_GROUP_ORDER.map((name) => [name, []]));
  for (const model of models) buckets.get(modelGroupForId(model.id))!.push(model);
  return MODEL_GROUP_ORDER.flatMap((name) => {
    const items = buckets.get(name) ?? [];
    return items.length ? [{ name, models: items }] : [];
  });
};
