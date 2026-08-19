import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import { validateWorkspaceInvariants } from "../domain/graph";
import { LIMITS, utf8ByteLength } from "../domain/limits";
import { parseWorkspace } from "../domain/schemas";
import type { WorkspaceDocument } from "../domain/types";
import type { LocalWorkspaceMaintenance, WorkspaceRepository } from "./WorkspaceRepository";

const DATABASE_NAME = "devneya-playground";
const DATABASE_VERSION = 1;
const WORKSPACE_STORE = "workspaces";

type WorkspaceRecord = {
  userId: string;
  document: WorkspaceDocument;
  savedAt: string;
};

interface PlaygroundDatabase extends DBSchema {
  workspaces: {
    key: string;
    value: WorkspaceRecord;
  };
}

export class CorruptWorkspaceError extends Error {
  public constructor(message = "The saved workspace is invalid and was not loaded.") {
    super(message);
    this.name = "CorruptWorkspaceError";
  }
}

const openWorkspaceDatabase = (): Promise<IDBPDatabase<PlaygroundDatabase>> =>
  openDB<PlaygroundDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: "userId" });
      }
    },
  });

const assertWorkspace = (workspace: WorkspaceDocument): WorkspaceDocument => {
  const errors = validateWorkspaceInvariants(workspace);
  if (errors.length > 0) throw new CorruptWorkspaceError(errors[0]);
  const size = utf8ByteLength(JSON.stringify(workspace));
  if (size > LIMITS.maxWorkspaceBytes) throw new CorruptWorkspaceError("The saved workspace is too large.");
  return workspace;
};

export class IndexedDbWorkspaceRepository implements WorkspaceRepository, LocalWorkspaceMaintenance {
  public async load(userId: string): Promise<WorkspaceDocument | null> {
    const database = await openWorkspaceDatabase();
    try {
      const record = await database.get(WORKSPACE_STORE, userId);
      if (!record) return null;
      try {
        return assertWorkspace(parseWorkspace(record.document));
      } catch (error) {
        if (error instanceof CorruptWorkspaceError) throw error;
        throw new CorruptWorkspaceError();
      }
    } finally {
      database.close();
    }
  }

  public async save(userId: string, workspace: WorkspaceDocument): Promise<void> {
    const document = assertWorkspace(workspace);
    const database = await openWorkspaceDatabase();
    try {
      await database.put(WORKSPACE_STORE, { userId, document, savedAt: new Date().toISOString() });
    } finally {
      database.close();
    }
  }

  public async delete(userId: string): Promise<void> {
    const database = await openWorkspaceDatabase();
    try {
      await database.delete(WORKSPACE_STORE, userId);
    } finally {
      database.close();
    }
  }

  public async clearAllBrowserData(): Promise<void> {
    await deleteDB(DATABASE_NAME, { blocked() {} });
  }
}
