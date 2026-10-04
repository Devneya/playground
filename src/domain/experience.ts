import { z } from "zod";
import { utf8ByteLength } from "./limits";

const MAX_STATE_DEPTH = 8;
const MAX_STATE_ENTRIES = 2_000;
const MAX_STATE_BYTES = 32_000;
const MAX_REVISIONS = 40;
const MAX_EXPERIENCE_BYTES = 1_500_000;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type WorkState = Record<string, JsonValue>;

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isJsonSafeState = (value: unknown): value is WorkState => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;

  let entries = 0;
  const ancestors = new Set<object>();

  const visit = (item: unknown, depth: number): boolean => {
    if (depth > MAX_STATE_DEPTH) return false;
    if (item === null || typeof item === "boolean") return true;
    if (typeof item === "string") return item.length <= 8_000;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item !== "object") return false;

    if (ancestors.has(item)) return false;
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype) return false;
        const keys = Reflect.ownKeys(item);
        if (keys.some((key) => typeof key !== "string" || (key !== "length" && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)))) return false;
        if (item.length > MAX_STATE_ENTRIES - entries) return false;
        for (let index = 0; index < item.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
          entries += 1;
          if (entries > MAX_STATE_ENTRIES || !visit(descriptor.value, depth + 1)) return false;
        }
        return true;
      }

      if (!isPlainObject(item)) return false;
      for (const key of Reflect.ownKeys(item)) {
        if (typeof key !== "string" || key === "__proto__" || key === "prototype" || key === "constructor" || key.length > 8_000) return false;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
        entries += 1;
        if (entries > MAX_STATE_ENTRIES || !visit(descriptor.value, depth + 1)) return false;
      }
      return true;
    } finally {
      ancestors.delete(item);
    }
  };

  try {
    if (!isPlainObject(value) || !visit(value, 0)) return false;
    return utf8ByteLength(JSON.stringify(value)) <= MAX_STATE_BYTES;
  } catch {
    return false;
  }
};

const cloneJsonValue = (value: JsonValue): JsonValue => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item));
  const clone: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(clone, key, { value: cloneJsonValue(item), enumerable: true, writable: true, configurable: true });
  }
  return clone;
};

const cloneWorkState = (state: WorkState): WorkState => {
  const clone: WorkState = {};
  for (const [key, value] of Object.entries(state)) {
    Object.defineProperty(clone, key, { value: cloneJsonValue(value), enumerable: true, writable: true, configurable: true });
  }
  return clone;
};

export const workStateSchema = z.custom<WorkState>(isJsonSafeState, "Expected a bounded JSON object state.").transform(cloneWorkState);

const identifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const experienceReplySchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(400),
  html: z.string().min(1).max(48_000),
  state: workStateSchema,
}).strict();

export type ExperienceReply = z.infer<typeof experienceReplySchema>;

const experienceRevisionSchema = z.object({
  id: identifierSchema,
  parent: identifierSchema.nullable(),
  actor: z.enum(["you", "model"]),
  label: z.string().min(1).max(8_000),
  model: z.string().max(120),
  at: z.string().datetime(),
  title: z.string().max(100),
  description: z.string().max(400),
  html: z.string().max(48_000),
  state: workStateSchema,
}).strict().superRefine((revision, context) => {
  if (revision.actor === "model" && revision.model.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Model revisions require a model name." });
  }
});

export type ExperienceRevision = z.infer<typeof experienceRevisionSchema>;

export const experienceSchema = z.object({
  head: identifierSchema.nullable(),
  revisions: z.array(experienceRevisionSchema).max(MAX_REVISIONS),
}).strict().superRefine((experience, context) => {
  const seen = new Set<string>();
  experience.revisions.forEach((revision, index) => {
    if (seen.has(revision.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["revisions", index, "id"], message: "Revision ids must be unique." });
    }
    if (revision.parent !== null && !seen.has(revision.parent)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["revisions", index, "parent"], message: "A revision parent must appear earlier in history." });
    }
    seen.add(revision.id);
  });
  if (experience.head !== null && !seen.has(experience.head)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["head"], message: "The selected revision must be retained." });
  }
  if (utf8ByteLength(JSON.stringify(experience)) > MAX_EXPERIENCE_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Experience history exceeds the byte limit." });
  }
});

export type Experience = z.infer<typeof experienceSchema>;

export const emptyExperience = (): Experience => ({ head: null, revisions: [] });

export const currentExperience = (experience: Experience): ExperienceRevision | undefined =>
  experience.head === null ? undefined : experience.revisions.find((revision) => revision.id === experience.head);

export const selectExperience = (experience: Experience, id: string): Experience => {
  const parsed = experienceSchema.parse(experience);
  if (!parsed.revisions.some((revision) => revision.id === id)) throw new Error(`Revision ${id} is not present in this experience.`);
  return experienceSchema.parse({ ...parsed, head: id });
};

const serializedBytes = (experience: Experience): number => utf8ByteLength(JSON.stringify(experience));

export const appendExperience = (experience: Experience, revision: ExperienceRevision, activate = true): Experience => {
  const current = experienceSchema.parse(experience);
  const nextRevision = experienceRevisionSchema.parse(revision);
  const existingIds = new Set(current.revisions.map((item) => item.id));
  if (existingIds.has(nextRevision.id)) throw new Error(`Revision ${nextRevision.id} already exists.`);
  if (nextRevision.parent !== null && !existingIds.has(nextRevision.parent)) {
    throw new Error(`Revision parent ${nextRevision.parent} is not present in this experience.`);
  }

  let revisions = [...current.revisions, nextRevision];
  const requestedHead = activate ? nextRevision.id : current.head;
  let head = requestedHead;
  let candidate: Experience = { head, revisions };

  while ((revisions.length > MAX_REVISIONS || serializedBytes(candidate) > MAX_EXPERIENCE_BYTES) && revisions.length > 1) {
    revisions = revisions.slice(1);
    candidate = { head, revisions };
  }

  const retainedIds = new Set(revisions.map((item) => item.id));
  revisions = revisions.map((item) => item.parent !== null && !retainedIds.has(item.parent) ? { ...item, parent: null } : item);
  if (head !== null && !retainedIds.has(head)) head = nextRevision.id;
  candidate = { head, revisions };
  return experienceSchema.parse(candidate);
};

export const experienceLineage = (experience: Experience): ExperienceRevision[] => {
  const parsed = experienceSchema.parse(experience);
  const byId = new Map(parsed.revisions.map((revision) => [revision.id, revision]));
  const lineage: ExperienceRevision[] = [];
  let revision = currentExperience(parsed);
  while (revision) {
    lineage.push(revision);
    revision = revision.parent === null ? undefined : byId.get(revision.parent);
  }
  return lineage.reverse();
};
