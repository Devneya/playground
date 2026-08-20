import type { WorkspaceDocument } from "../domain/types";
import type { WorkspaceRepository } from "./WorkspaceRepository";

const clone = (workspace: WorkspaceDocument): WorkspaceDocument => structuredClone(workspace);

/** A session-only fallback for browsers where IndexedDB cannot be opened. */
export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly documents = new Map<string, WorkspaceDocument>();

  public async load(userId: string): Promise<WorkspaceDocument | null> {
    const document = this.documents.get(userId);
    return document ? clone(document) : null;
  }

  public async save(userId: string, workspace: WorkspaceDocument): Promise<void> {
    this.documents.set(userId, clone(workspace));
  }

  public async delete(userId: string): Promise<void> {
    this.documents.delete(userId);
  }
}
