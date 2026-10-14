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

let databaseConnection: IDBPDatabase<PlaygroundDatabase> | null = null;
let openingDatabase: Promise<IDBPDatabase<PlaygroundDatabase>> | null = null;
const openWorkspaceDatabase = (): Promise<IDBPDatabase<PlaygroundDatabase>> => {
  if (databaseConnection) return Promise.resolve(databaseConnection);
  if (openingDatabase) return openingDatabase;
  openingDatabase = openDB<PlaygroundDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: "userId" });
      }
    },
    blocking() { databaseConnection?.close(); databaseConnection = null; },
    terminated() { databaseConnection = null; },
  }).then(database => { databaseConnection = database; openingDatabase = null; return database; }, error => { openingDatabase = null; throw error; });
  return openingDatabase;
};

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
    const record = await database.get(WORKSPACE_STORE, userId);
    if (!record) return null;
    try {
      return assertWorkspace(parseWorkspace(record.document));
    } catch (error) {
      if (error instanceof CorruptWorkspaceError) throw error;
      throw new CorruptWorkspaceError();
    }
  }

  public async save(userId: string, workspace: WorkspaceDocument): Promise<void> {
    const document = assertWorkspace(workspace);
    // Keep the loaded connection ready so a pagehide flush can start its
    // transaction immediately, without an asynchronous database-open step.
    const database = databaseConnection ?? await openWorkspaceDatabase();
    const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
    const writing = transaction.store.put({ userId, document, savedAt: new Date().toISOString() });
    // Submit the commit before the document can finish unloading, rather
    // than relying on the next event-loop turn to auto-commit.
    transaction.commit();
    await writing;
    await transaction.done;
  }

  public async delete(userId: string): Promise<void> {
    const database = await openWorkspaceDatabase();
    await database.delete(WORKSPACE_STORE, userId);
  }

  public async clearAllBrowserData(): Promise<void> {
    if (openingDatabase) await openingDatabase;
    databaseConnection?.close();
    databaseConnection = null;
    await deleteDB(DATABASE_NAME, { blocked() {} });
  }
}
