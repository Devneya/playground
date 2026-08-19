import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbWorkspaceRepository, CorruptWorkspaceError } from "../../src/persistence/IndexedDbWorkspaceRepository";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { validateWorkspaceInvariants } from "../../src/domain/graph";

describe("IndexedDbWorkspaceRepository", () => {
  const repository = new IndexedDbWorkspaceRepository();
  beforeEach(async () => repository.clearAllBrowserData());

  it("saves and loads a workspace by user id", async () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID());
    await repository.save("user-1", workspace);
    expect(await repository.load("user-1")).toEqual(workspace);
    expect(await repository.load("user-2")).toBeNull();
  });

  it("does not silently accept corrupt saved data", async () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID());
    await repository.save("user-1", workspace);
    const database = await (await import("idb")).openDB("devneya-playground");
    await database.put("workspaces", { userId: "user-1", document: { broken: true }, savedAt: new Date().toISOString() });
    database.close();
    await expect(repository.load("user-1")).rejects.toBeInstanceOf(CorruptWorkspaceError);
  });
  it("keeps user records isolated and deletes only the requested record", async () => {
    const first = createStarterWorkspace(() => crypto.randomUUID());
    const second = createStarterWorkspace(() => crypto.randomUUID());
    await repository.save("user-1", first);
    await repository.save("user-2", second);
    await repository.delete("user-1");
    expect(await repository.load("user-1")).toBeNull();
    expect(await repository.load("user-2")).toEqual(second);
  });

  it("rejects invalid workspaces before writing them", async () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID());
    const invalid = { ...workspace, activeFlowId: "missing" };
    expect(validateWorkspaceInvariants(invalid)).not.toEqual([]);
    await expect(repository.save("user-1", invalid)).rejects.toThrow("Active flow");
    expect(await repository.load("user-1")).toBeNull();
  });

  it("loads a missing record and supports explicit browser cleanup", async () => {
    expect(await repository.load("missing")).toBeNull();
    await repository.save("user-1", createStarterWorkspace(() => crypto.randomUUID()));
    await repository.clearAllBrowserData();
    expect(await repository.load("user-1")).toBeNull();
  });
});
