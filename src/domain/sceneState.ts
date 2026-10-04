import { z } from "zod";

const value = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
/** Serializable interaction state, never workspace operations or executable code. */
export const sceneStateSchema = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/).refine((key) => !["__proto__", "constructor", "prototype"].includes(key)), z.union([value, z.array(value).max(100)]))
  .refine((state) => Object.keys(state).length <= 40 && new TextEncoder().encode(JSON.stringify(state)).length <= 16000, "Interaction state is too large.");
export type SceneState = z.infer<typeof sceneStateSchema>;
