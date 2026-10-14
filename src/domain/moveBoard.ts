import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const layoutSchema = z.enum(["comparison", "sequence", "map"]);
export const pieceSchema = z.object({ id, label: z.string().min(1).max(70), detail: z.string().min(1).max(600), kind: z.enum(["idea", "action", "question", "constraint"]), basis: z.enum(["given", "proposal", "assumption"]) }).strict();
export const routeSchema = z.object({ id, title: z.string().min(1).max(65), premise: z.string().min(1).max(180), pieces: z.array(pieceSchema).min(2).max(4), tradeoff: z.string().min(1).max(200), test: z.string().min(1).max(200) }).strict();
export const positionSchema = z.object({ title: z.string().max(100), question: z.string().max(250), layout: layoutSchema.optional(), routes: z.array(routeSchema).max(4), marks: z.record(id, z.enum(["keep", "question", "dismiss"])) }).strict();
export type BoardPosition = z.infer<typeof positionSchema>;
export type BoardPiece = z.infer<typeof pieceSchema>;
export type BoardRoute = z.infer<typeof routeSchema>;
export const moveSchema = z.object({ label: z.string().min(1).max(100), reason: z.string().min(1).max(400), title: z.string().max(100).optional(), question: z.string().max(250).optional(), layout: layoutSchema.optional(), routes: z.array(routeSchema).max(4), remove: z.array(id).max(4) }).strict();
export type BoardMove = z.infer<typeof moveSchema>;
const revisionSchema = z.object({ id, parent: id.nullable(), actor: z.enum(["you", "model"]), label: z.string().max(8000), reason: z.string().max(400), model: z.string(), at: z.string().datetime(), position: positionSchema }).strict();
export const moveBoardSchema = z.object({ head: id.nullable(), revisions: z.array(revisionSchema).max(80) }).strict().superRefine((board, ctx) => {
  const seen = new Set<string>();
  for (const revision of board.revisions) {
    if (seen.has(revision.id) || revision.parent && !seen.has(revision.parent)) ctx.addIssue({ code: "custom", message: "Invalid move history." });
    seen.add(revision.id);
    const ids = revision.position.routes.flatMap((r) => [r.id, ...r.pieces.map((p) => p.id)]);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Pieces need unique identifiers." });
  }
  if (board.head && !seen.has(board.head)) ctx.addIssue({ code: "custom", message: "Missing current move." });
});
export type MoveBoard = z.infer<typeof moveBoardSchema>;
export type BoardRevision = z.infer<typeof revisionSchema>;
export const emptyBoard = (): MoveBoard => ({ head: null, revisions: [] });
export const blankPosition = (): BoardPosition => ({ title: "", question: "", routes: [], marks: {} });
export const boardPosition = (board: MoveBoard): BoardPosition => board.revisions.find((r) => r.id === board.head)?.position ?? blankPosition();
export const boardLineage = (board: MoveBoard) => {
  const lineage: BoardRevision[] = [];
  let head = board.head;
  while (head && lineage.length < board.revisions.length) {
    const revision = board.revisions.find((r) => r.id === head);
    if (!revision) break;
    lineage.unshift(revision); head = revision.parent;
  }
  return lineage;
};

/** Each revision is a complete position. Branches keep their original future. */
export const appendBoardRevision = (board: MoveBoard, revision: BoardRevision): MoveBoard => {
  if (revision.parent !== board.head) throw new Error("The position changed while the model was moving. Its late move was not applied.");
  const revisions = [...board.revisions, revision].slice(-80);
  const retained = new Set(revisions.map((r) => r.id));
  return moveBoardSchema.parse({ head: revision.id, revisions: revisions.map((r) => ({ ...r, parent: r.parent && retained.has(r.parent) ? r.parent : null })) });
};
export const applyBoardMove = (position: BoardPosition, value: unknown): BoardPosition => {
  const move = moveSchema.parse(value);
  let routes = position.routes.filter((r) => !move.remove.includes(r.id));
  for (const route of move.routes) routes = routes.some((r) => r.id === route.id) ? routes.map((r) => r.id === route.id ? route : r) : [...routes, route];
  const pieces = routes.flatMap((r) => r.pieces);
  for (const piece of position.routes.flatMap((r) => r.pieces)) {
    if (position.marks[piece.id] === "keep" && JSON.stringify(pieces.find((p) => p.id === piece.id)) !== JSON.stringify(piece)) throw new Error(`“${piece.label}” is kept. The model cannot replace it; release it first.`);
  }
  const ids = routes.flatMap((r) => [r.id, ...r.pieces.map((p) => p.id)]);
  if (new Set(ids).size !== ids.length) throw new Error("The move reused a piece identifier.");
  return positionSchema.parse({ ...position, ...(move.layout ? { layout: move.layout } : {}), title: move.title || position.title, question: move.question ?? position.question, routes, marks: Object.fromEntries(Object.entries(position.marks).filter(([key]) => pieces.some((p) => p.id === key))) });
};

/** Compare the work itself, independent of a model's description of its move. */
export const boardChanges = (before: BoardPosition, after: BoardPosition) => {
  const oldPieces = before.routes.flatMap((r) => r.pieces);
  const newPieces = after.routes.flatMap((r) => r.pieces);
  const added = newPieces.filter((p) => !oldPieces.some((old) => old.id === p.id));
  const updated = newPieces.flatMap((piece) => {
    const old = oldPieces.find((p) => p.id === piece.id);
    return old && JSON.stringify(old) !== JSON.stringify(piece) ? [{ before: old, after: piece }] : [];
  });
  const removed = oldPieces.filter((p) => !newPieces.some((next) => next.id === p.id));
  const layoutChanged = (before.layout ?? "comparison") !== (after.layout ?? "comparison");
  const framingChanged = before.title !== after.title || before.routes.some((route, i) => {
    const next = after.routes[i];
    return !next || route.id !== next.id || route.title !== next.title || route.premise !== next.premise || route.tradeoff !== next.tradeoff || route.test !== next.test;
  });
  return { added, updated, removed, layoutChanged, framingChanged, changed: !!(added.length || updated.length || removed.length || layoutChanged || framingChanged) };
};
