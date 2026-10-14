import { z } from "zod";
import { sceneStateSchema } from "./sceneState";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export type Formula = number | { ref: string } | { op: "add" | "subtract" | "multiply" | "divide" | "min" | "max"; args: Formula[] };
const expression = (depth: number): z.ZodType<Formula> => z.union([
  z.number().finite().min(-1e9).max(1e9), z.object({ ref: id }).strict(),
  ...(depth < 5 ? [z.object({ op: z.enum(["add", "subtract", "multiply", "divide", "min", "max"]), args: z.array(expression(depth + 1)).min(2).max(8) }).strict()] : []),
]) as z.ZodType<Formula>;
export const formulaSchema = expression(0);
const color = z.enum(["ink", "moss", "blue", "plum", "coral", "gold"]);
const fields = {
  kind: z.enum(["text", "region", "token", "control", "metric", "bars", "scene"]),
  html: z.string().min(1).max(32000).optional(), state: sceneStateSchema.optional(), interaction: z.string().min(1).max(250).optional(),
  title: z.string().min(1).max(80), text: z.string().max(3000).optional(),
  x: z.number().finite().min(-5000).max(10000), y: z.number().finite().min(-5000).max(10000),
  width: z.number().min(120).max(1200), height: z.number().min(40).max(1000), color: color.default("ink"),
  value: z.number().finite().min(-1e9).max(1e9).optional(), min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().finite().positive().optional(),
  unit: z.string().max(24).optional(), formula: formulaSchema.optional(),
  series: z.array(z.object({ label: z.string().min(1).max(50), formula: formulaSchema, color: color.optional() }).strict()).min(1).max(10).optional(),
};
const objectFieldsSchema = z.object(fields).strict();
export const surfaceObjectSchema = objectFieldsSchema.extend({ id }).strict().superRefine((object, ctx) => {
  if (object.kind === "scene" && (!object.html || !object.interaction)) ctx.addIssue({ code: "custom", message: "An experience needs its interface and an explicit interaction." });
  if (object.kind === "control" && (object.value === undefined || object.min === undefined || object.max === undefined || object.step === undefined || object.min >= object.max || object.value < object.min || object.value > object.max)) ctx.addIssue({ code: "custom", message: "A control needs a value, ordered bounds and a positive step." });
  if (object.kind === "metric" && object.formula === undefined) ctx.addIssue({ code: "custom", message: "A metric needs a formula." });
  if (object.kind === "bars" && !object.series?.length) ctx.addIssue({ code: "custom", message: "A chart needs series." });
});
export type SurfaceObject = z.infer<typeof surfaceObjectSchema>;
export const surfaceLinkSchema = z.object({ id, from: id, to: id, label: z.string().max(100) }).strict();
export type SurfaceLink = z.infer<typeof surfaceLinkSchema>;
export const surfaceOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), object: surfaceObjectSchema }).strict(),
  z.object({ op: z.literal("edit"), id, changes: objectFieldsSchema.partial() }).strict(),
  z.object({ op: z.literal("remove"), id }).strict(),
  z.object({ op: z.literal("connect"), link: surfaceLinkSchema }).strict(),
  z.object({ op: z.literal("disconnect"), id }).strict(),
]);
export type SurfaceOperation = z.infer<typeof surfaceOperationSchema>;
const actionsSchema = z.array(z.object({ label: z.string().min(1).max(45), instruction: z.string().min(1).max(2000) }).strict()).max(3);
export const surfaceReplySchema = z.object({ summary: z.string().min(1).max(1000), operations: z.array(surfaceOperationSchema).max(40), actions: actionsSchema.default([]) }).strict();
export type SurfaceReply = z.infer<typeof surfaceReplySchema>;
export const surfaceSchema = z.object({
  objects: z.array(surfaceObjectSchema).max(80), links: z.array(surfaceLinkSchema).max(120),
  turns: z.array(z.object({ id: z.string(), instruction: z.string().max(8000), summary: z.string().max(1000), model: z.string(), at: z.string().datetime(), changedIds: z.array(id).max(80) }).strict()).max(30),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(.2).max(3) }).strict().optional(),
  actions: actionsSchema, notice: z.string().max(1000).optional(),
}).strict();
export type Surface = z.infer<typeof surfaceSchema>;
export const emptySurface = (): Surface => ({ objects: [], links: [], turns: [], actions: [] });

export const formulaReferences = (formula: Formula): string[] => typeof formula === "number" ? [] : "ref" in formula ? [formula.ref] : formula.args.flatMap(formulaReferences);
export const surfaceProblems = (surface: Surface): string[] => {
  const errors: string[] = [];
  const byId = new Map(surface.objects.map((object) => [object.id, object]));
  if (byId.size !== surface.objects.length || new Set(surface.links.map((link) => link.id)).size !== surface.links.length) errors.push("Object and connection IDs must be unique.");
  for (const link of surface.links) if (!byId.has(link.from) || !byId.has(link.to) || link.from === link.to) errors.push("A connection needs two existing objects.");
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (object: SurfaceObject): void => {
    if (visiting.has(object.id)) { errors.push("Calculations cannot refer back to themselves."); return; }
    if (visited.has(object.id)) return;
    visiting.add(object.id);
    for (const ref of [object.formula, ...(object.series?.map((s) => s.formula) ?? [])].filter((f): f is Formula => f !== undefined).flatMap(formulaReferences)) {
      const dependency = byId.get(ref);
      if (!dependency || !["control", "metric"].includes(dependency.kind)) errors.push(`Calculation refers to unavailable value ${ref}.`);
      else visit(dependency);
    }
    visiting.delete(object.id); visited.add(object.id);
  };
  surface.objects.forEach(visit);
  return [...new Set(errors)];
};
export const evaluateFormula = (formula: Formula, surface: Surface, seen = new Set<string>()): number | null => {
  if (typeof formula === "number") return formula;
  if ("ref" in formula) {
    if (seen.has(formula.ref)) return null;
    const object = surface.objects.find((item) => item.id === formula.ref);
    if (object?.kind === "control") return object.value ?? null;
    return object?.kind === "metric" && object.formula !== undefined ? evaluateFormula(object.formula, surface, new Set([...seen, formula.ref])) : null;
  }
  const values = formula.args.map((arg) => evaluateFormula(arg, surface, seen));
  if (values.some((value) => value === null)) return null;
  const v = values as number[];
  const value = formula.op === "add" ? v.reduce((a, b) => a + b, 0) : formula.op === "subtract" ? v.slice(1).reduce((a, b) => a - b, v[0]!) : formula.op === "multiply" ? v.reduce((a, b) => a * b, 1) : formula.op === "divide" ? v.slice(1).reduce((a, b) => b === 0 ? NaN : a / b, v[0]!) : formula.op === "min" ? Math.min(...v) : Math.max(...v);
  return Number.isFinite(value) ? value : null;
};
const canonical = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
/** Atomic optimistic edits: reject conflicting fields, while preserving independent human changes. */
export const applySurfaceOperations = (current: Surface, base: Surface, operations: SurfaceOperation[]): { surface: Surface; changedIds: string[] } => {
  const parsed = z.array(surfaceOperationSchema).max(40).parse(operations);
  let objects = structuredClone(current.objects), links = structuredClone(current.links);
  const changed = new Set<string>();
  const created = new Set<string>();
  for (const operation of parsed) {
    if (operation.op === "create") {
      if (objects.some((object) => object.id === operation.object.id)) throw new Error("An object with that name already exists. Ask again using the current workspace.");
      objects.push(operation.object); created.add(operation.object.id); changed.add(operation.object.id);
    } else if (operation.op === "edit" || operation.op === "remove") {
      const object = objects.find((item) => item.id === operation.id), original = base.objects.find((item) => item.id === operation.id);
      if (!object || (!original && !created.has(operation.id))) throw new Error("An object changed or was removed while the model was working. Your work has been kept.");
      if (operation.op === "edit") {
        for (const key of Object.keys(operation.changes) as (keyof typeof fields)[]) if (original && !changed.has(operation.id + ':' + key) && !same(object[key], original[key]) && !same(object[key], operation.changes[key])) throw new Error(`You changed ${object.title} while the model was working. Your work has been kept; send the request again.`);
        objects = objects.map((item) => item.id === object.id ? surfaceObjectSchema.parse({ ...item, ...operation.changes }) : item);
        Object.keys(operation.changes).forEach((key) => changed.add(operation.id + ':' + key));
      } else {
        if (original && !same(object, original)) throw new Error("The model tried to remove an object you changed. Your work has been kept.");
        const incident = (list: SurfaceLink[]) => list.filter((link) => link.from === operation.id || link.to === operation.id);
        if (original && !same(incident(current.links), incident(base.links))) throw new Error("Connections to this object changed while the model was working. Your work has been kept.");
        objects = objects.filter((item) => item.id !== operation.id);
        links = links.filter((link) => link.from !== operation.id && link.to !== operation.id);
      }
      changed.add(operation.id);
    } else if (operation.op === "connect") {
      if (links.some((link) => link.id === operation.link.id)) throw new Error("A connection with that name already exists.");
      links.push(operation.link);
    } else {
      if (!same(links.find((link) => link.id === operation.id), base.links.find((link) => link.id === operation.id))) throw new Error("That connection changed while the model was working.");
      links = links.filter((link) => link.id !== operation.id);
    }
  }
  const next = surfaceSchema.parse({ ...current, objects, links });
  const problems = surfaceProblems(next);
  if (problems.length) throw new Error(problems[0]);
  return { surface: next, changedIds: [...changed].filter((key) => !key.includes(':')) };
};
