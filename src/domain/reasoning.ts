import { z } from "zod";
import type { Model } from "./types";

export const reasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export const defaultEffort = (model: Model | undefined) => model?.supportedReasoningEfforts?.includes("xhigh") ? "xhigh" : model?.defaultReasoningEffort ?? model?.supportedReasoningEfforts?.[0];
