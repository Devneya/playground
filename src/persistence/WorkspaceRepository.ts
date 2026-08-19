import type { WorkspaceDocument } from "../domain/types";

export interface WorkspaceRepository {
  load(userId: string): Promise<WorkspaceDocument | null>;
  save(userId: string, workspace: WorkspaceDocument): Promise<void>;
  delete(userId: string): Promise<void>;
}

export interface LocalWorkspaceMaintenance {
  clearAllBrowserData(): Promise<void>;
}
