import { LIMITS, utf8ByteLength } from "./limits";
import type { WorkspaceAction } from "./workspaceReducer";
import type { WorkspaceDocument } from "./types";

// Actions that should be recorded in the undo history. Viewport changes are
// excluded because they are high-frequency, camera-only state that must never
// be reverted by undo; this mirrors how node/move is treated (a history
// action) so the two can be reasoned about together.
export const isHistoryAction = (action: WorkspaceAction): boolean =>
  !action.type.startsWith("batch/")
  && !action.type.startsWith("execution/")
  && action.type !== "workspace/reset"
  && action.type !== "workspace/imported"
  && action.type !== "viewport/update";

export type HistoryState = { past: WorkspaceDocument[]; future: WorkspaceDocument[]; bytes: number };
export const emptyHistory = (): HistoryState => ({ past: [], future: [], bytes: 0 });

export const pushHistory = (history: HistoryState, previous: WorkspaceDocument): HistoryState => {
  const bytes = utf8ByteLength(JSON.stringify(previous));
  if (bytes > LIMITS.maxHistoryBytes) return history;
  const past = [...history.past, structuredClone(previous)];
  let nextPast = past;
  let nextBytes = history.bytes + bytes;
  while (nextPast.length > LIMITS.maxHistoryEntries || nextBytes > LIMITS.maxHistoryBytes) {
    const removed = nextPast.shift();
    if (removed) nextBytes -= utf8ByteLength(JSON.stringify(removed));
  }
  return { past: nextPast, future: [], bytes: Math.max(0, nextBytes) };
};

export const undoHistory = (history: HistoryState, current: WorkspaceDocument) => {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return { workspace: structuredClone(previous), history: { past: history.past.slice(0, -1), future: [structuredClone(current), ...history.future], bytes: Math.max(0, history.bytes - utf8ByteLength(JSON.stringify(previous))) } };
};

export const redoHistory = (history: HistoryState, current: WorkspaceDocument) => {
  const next = history.future[0];
  if (!next) return null;
  return { workspace: structuredClone(next), history: { past: [...history.past, structuredClone(current)], future: history.future.slice(1), bytes: history.bytes + utf8ByteLength(JSON.stringify(current)) } };
};
