import { experienceSchema } from "../../domain/experience";
import { createBlankFlow } from "../../domain/workspaceFactory";
import type { WorkspaceDocument } from "../../domain/types";

/** A recorded live run, loaded into its own flow; subsequent actions use Codex. */
export const loadExperienceExample = async (workspace: WorkspaceDocument) => {
  const { default: captured } = await import("./experienceExampleData.json");
  return { ...createBlankFlow(workspace, undefined, undefined, "Recorded example · working interfaces"), experience: experienceSchema.parse(captured) };
};
