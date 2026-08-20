import { CorruptWorkspaceError } from "./IndexedDbWorkspaceRepository";
import type { WorkspaceDocument } from "../domain/types";
import type { WorkspaceRepository } from "./WorkspaceRepository";

export type RepositoryFallback = {
  repository: WorkspaceRepository;
  onFallback(error: unknown): void;
};

/** Keeps the editor usable when browser storage is unavailable. */
export class ResilientWorkspaceRepository implements WorkspaceRepository {
  private active: WorkspaceRepository;
  private fallbackActive = false;

  public constructor(private readonly primary: WorkspaceRepository, private readonly fallback: RepositoryFallback) {
    this.active = primary;
  }

  public async load(userId: string): Promise<WorkspaceDocument | null> {
    try {
      return await this.active.load(userId);
    } catch (error) {
      if (error instanceof CorruptWorkspaceError || this.fallbackActive) throw error;
      this.activateFallback(error);
      return this.active.load(userId);
    }
  }

  public async save(userId: string, workspace: WorkspaceDocument): Promise<void> {
    try {
      await this.active.save(userId, workspace);
    } catch (error) {
      if (error instanceof CorruptWorkspaceError || this.fallbackActive) throw error;
      this.activateFallback(error);
      await this.active.save(userId, workspace);
    }
  }

  public async delete(userId: string): Promise<void> {
    try {
      await this.active.delete(userId);
    } catch (error) {
      if (this.fallbackActive) throw error;
      this.activateFallback(error);
      await this.active.delete(userId);
    }
  }

  private activateFallback(error: unknown): void {
    this.fallbackActive = true;
    this.active = this.fallback.repository;
    this.fallback.onFallback(error);
  }
}
