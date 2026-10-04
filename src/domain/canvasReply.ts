import { z } from "zod";
import { LIMITS, utf8ByteLength } from "./limits";

const title = z.string().trim().min(1).max(60);
export const branchSuggestionSchema = z.object({ title, instruction: z.string().trim().min(1).max(2000), accepted: z.boolean().optional() }).strict();
export const noteSuggestionSchema = z.object({ title, text: z.string().trim().min(1).max(4000), accepted: z.boolean().optional() }).strict();
export const artifactSchema = z.object({ html: z.string().min(1).max(48000), height: z.number().int().min(160).max(800) }).strict();
export type CanvasArtifact = z.infer<typeof artifactSchema>;
export const gridCellSchema = z.object({ col: z.number().int().min(0).max(3), row: z.number().int().min(0).max(5), title, text: z.string().trim().min(1).max(8000), noted: z.boolean(), span: z.number().int().min(1).max(2).optional(), question: z.string().trim().min(1).max(2000).optional(), artifact: artifactSchema.optional() }).strict();
export const replyGridSchema = z.object({ columns: z.number().int().min(1).max(4), cells: z.array(gridCellSchema).min(1).max(12), layout: z.literal("atlas").optional(), accepted: z.boolean().optional() }).strict().refine((grid) => grid.cells.every((cell) => cell.col + (cell.span ?? 1) <= grid.columns) && new Set(grid.cells.flatMap((cell) => Array.from({ length: cell.span ?? 1 }, (_, i) => `${cell.col + i}:${cell.row}`))).size === grid.cells.reduce((sum, cell) => sum + (cell.span ?? 1), 0), "Grid cells must occupy unique, valid columns.");
export const outputSuggestionsSchema = z.object({ branches: z.array(branchSuggestionSchema).max(3).optional(), notes: z.array(noteSuggestionSchema).max(2).optional(), grid: replyGridSchema.optional() }).strict();
export type OutputSuggestions = z.infer<typeof outputSuggestionsSchema>;
export type ReplyGrid = z.infer<typeof replyGridSchema>;

export const CANVAS_SYSTEM_PROMPT = `Answer the user's actual question on a shared spatial canvas. The answer is a collection of independently explorable objects, not a chat essay and not a single mini-website. Be useful before being surprising. Do not reinterpret an ordinary question as a game or poetic metaphor. The user need not request a visual form.
Return JSON only: {"reply":"A direct answer, 1-2 concrete sentences, not a teaser","grid":{"layout":"atlas","columns":3,"cells":[{"col":0,"row":0,"title":"One subject","text":"The visible answer for this subject, 1-2 concise sentences (about 35 words).","question":"A specific, useful follow-up question about this subject","noted":false,"artifact":{"height":220,"html":"A small HTML fragment with inline CSS, SVG and optional JavaScript"}}]}}.
For broad questions create 3-5 DISTINCT cards, each with its own subject and job: entities, alternatives, mechanisms, evidence, tradeoffs, unknowns or experiments as appropriate. This example shows the shape of ONE cell; output multiple cells. Place the first three at col 0,1,2 row 0; any others at row 1. Do not put the entire answer inside one artifact or repeat the same scene on every card. The host displays title and text; do not duplicate them in the artifact. The reply must directly answer the question even before any interaction. A genuinely atomic fact can omit grid; broad exploratory questions cannot.
Use several complementary representations: a labeled diagram, a comparison, a manipulable example, a cross-section, a small playable object when relevant. At least two cards should use visuals that convey information, not decorative cover images. Give each interaction an explicit verb label and a visible consequence related to the question. A labeled static diagram is better than an unrelated toy. Distinguish facts, illustrative models, assumptions and unknowns. If the question might mean what is happening here/now, answer generally and explicitly ask for the missing location/time; never pretend an illustration is a live observation. No invented observations, measurements or citations.
Each card is 384px wide. Artifacts should fit 200-280px tall with no scrollbars, work from 320px wide, and have legible labels (14px+). Use bold, varied but coherent art direction; avoid tiny entire-websites, repeated headers, or tabs that just swap paragraphs. Native labeled controls, keyboard access and reduced-motion support are required. Keep each HTML fragment under 2500 characters and the total JSON under 11000. No external resources, fetch, storage, frames or navigation. Code is sandboxed. Do not assume outside tools or live data.
After a meaningful human interaction, change the visual and optionally call parent.postMessage({type:'devneya:selection',prompt:'A self-contained follow-up question carrying the selected state'},'*'). Never post on initialization. Each object can also be asked about, selected, compared and connected using host controls; do not recreate those controls inside it. Deliver the complete answer now.`;

export const parseCanvasReply = (raw: string): { text: string; suggestions?: OutputSuggestions } => {
  if (utf8ByteLength(raw) > LIMITS.maxGeneratedBytes) return { text: raw };
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw.trim());
  let value: unknown;
  try { value = JSON.parse(fenced?.[1] ?? raw); } catch { return { text: raw }; }
  if (!value || typeof value !== "object" || !("reply" in value) || typeof value.reply !== "string" || !value.reply.trim()) return { text: raw };
  const record = value as Record<string, unknown>;
  const suggestions: OutputSuggestions = {};
  const branches = Array.isArray(record.suggested_branches) ? record.suggested_branches : [];
  const notes = Array.isArray(record.extracted_notes) ? record.extracted_notes : [];
  // Never trust model-provided acceptance state. A response cannot approve itself.
  suggestions.branches = branches.flatMap((item) => {
    const parsed = branchSuggestionSchema.safeParse(item);
    return parsed.success ? [{ title: parsed.data.title, instruction: parsed.data.instruction }] : [];
  }).slice(0, 3);
  suggestions.notes = notes.flatMap((item) => {
    const parsed = noteSuggestionSchema.safeParse(item);
    return parsed.success ? [{ title: parsed.data.title, text: parsed.data.text }] : [];
  }).slice(0, 2);
  const grid = record.grid;
  if (grid && typeof grid === "object" && "columns" in grid && "cells" in grid && Number.isInteger(grid.columns) && Number(grid.columns) >= 1 && Number(grid.columns) <= 4 && Array.isArray(grid.cells)) {
    const occupied = new Set<string>();
    const cells = grid.cells.flatMap((cell) => {
      let candidate = cell;
      if (cell && typeof cell === "object" && "artifact" in cell && !artifactSchema.safeParse(cell.artifact).success) {
        const { artifact: _artifact, ...fallback } = cell;
        candidate = fallback;
      }
      const parsed = gridCellSchema.safeParse(candidate);
      if (!parsed.success || parsed.data.col + (parsed.data.span ?? 1) > Number(grid.columns)) return [];
      const keys = Array.from({ length: parsed.data.span ?? 1 }, (_, i) => `${parsed.data.col + i}:${parsed.data.row}`);
      if (keys.some((key) => occupied.has(key))) return [];
      keys.forEach((key) => occupied.add(key));
      return [parsed.data];
    }).slice(0, 12);
    if (cells.length) suggestions.grid = { columns: Number(grid.columns), cells, ...("layout" in grid && grid.layout === "atlas" ? { layout: "atlas" as const } : {}) };
  }
  return { text: value.reply, ...(suggestions.branches.length || suggestions.notes.length || suggestions.grid ? { suggestions } : {}) };
};
