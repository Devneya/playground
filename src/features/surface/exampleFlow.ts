import { moveBoardSchema } from "../../domain/moveBoard";
import { createBlankFlow } from "../../domain/workspaceFactory";
import type { WorkspaceDocument } from "../../domain/types";

export const loadExampleFlow = async (workspace: WorkspaceDocument) => {
  const { exampleBoard } = await import("./examplePosition");
  return { ...createBlankFlow(workspace, undefined, undefined, "Example · visual moves"), board: moveBoardSchema.parse(exampleBoard) };
};
