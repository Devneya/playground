import { describe, expect, it, vi } from "vitest";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";
import { CorruptWorkspaceError } from "../../src/persistence/IndexedDbWorkspaceRepository";
import { InMemoryWorkspaceRepository } from "../../src/persistence/InMemoryWorkspaceRepository";
import { ResilientWorkspaceRepository } from "../../src/persistence/ResilientWorkspaceRepository";
import { WorkspaceSaveQueue } from "../../src/persistence/WorkspaceSaveQueue";
import type { WorkspaceRepository } from "../../src/persistence/WorkspaceRepository";

describe("resilient local persistence", () => {
  it("isolates in-memory snapshots from later caller mutation", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const workspace = createStarterWorkspace(() => crypto.randomUUID());
    await repository.save("user-a", workspace);
    workspace.flows[0]!.name = "mutated after save";
    const loaded = await repository.load("user-a");
    expect(loaded?.flows[0]?.name).toBe("Untitled flow");
    if (loaded) loaded.flows[0]!.name = "mutated after load";
    expect((await repository.load("user-a"))?.flows[0]?.name).toBe("Untitled flow");
  });

  it("falls back after a storage failure and reports the degraded mode", async () => {
    const primary: WorkspaceRepository = {
      load: vi.fn().mockRejectedValue(new Error("quota exceeded")),
      save: vi.fn().mockRejectedValue(new Error("quota exceeded")),
      delete: vi.fn().mockRejectedValue(new Error("quota exceeded")),
    };
    const fallback = new InMemoryWorkspaceRepository();
    const warnings: unknown[] = [];
    const repository = new ResilientWorkspaceRepository(primary, { repository: fallback, onFallback: (error) => warnings.push(error) });
    const workspace = createStarterWorkspace(() => crypto.randomUUID());
    await repository.save("user-a", workspace);
    expect(await repository.load("user-a")).toEqual(workspace);
    expect(warnings).toHaveLength(1);
    expect(primary.save).toHaveBeenCalledTimes(1);
    await repository.delete("user-a");
    expect(await repository.load("user-a")).toBeNull();
  });

  it("loads from the fallback after the primary load fails", async () => {
    const workspace = createStarterWorkspace(() => crypto.randomUUID());
    const primary: WorkspaceRepository = {
      load: vi.fn().mockRejectedValue(new Error("primary load")),
      save: vi.fn(),
      delete: vi.fn(),
    };
    const fallback: WorkspaceRepository = {
      load: vi.fn().mockResolvedValue(workspace),
      save: vi.fn(),
      delete: vi.fn(),
    };
    const repository = new ResilientWorkspaceRepository(primary, { repository: fallback, onFallback: vi.fn() });
    await expect(repository.load("user-a")).resolves.toEqual(workspace);
    expect(fallback.load).toHaveBeenCalledWith("user-a");
  });

  it("propagates failures after the fallback has already been activated", async () => {
    const primary: WorkspaceRepository = {
      load: vi.fn().mockRejectedValue(new Error("primary load")),
      save: vi.fn().mockRejectedValue(new Error("primary save")),
      delete: vi.fn().mockRejectedValue(new Error("primary delete")),
    };
    const fallback: WorkspaceRepository = {
      load: vi.fn().mockRejectedValue(new Error("fallback load")),
      save: vi.fn().mockRejectedValue(new Error("fallback save")),
      delete: vi.fn().mockRejectedValue(new Error("fallback delete")),
    };
    const repository = new ResilientWorkspaceRepository(primary, { repository: fallback, onFallback: vi.fn() });
    const workspace = createStarterWorkspace(() => crypto.randomUUID());
    await expect(repository.save("user-a", workspace)).rejects.toThrow("fallback save");
    await expect(repository.load("user-a")).rejects.toThrow("fallback load");
    await expect(repository.delete("user-a")).rejects.toThrow("fallback delete");
  });

  it("does not hide corrupt primary data behind the fallback", async () => {
    const primary: WorkspaceRepository = {
      load: vi.fn().mockRejectedValue(new CorruptWorkspaceError()),
      save: vi.fn(),
      delete: vi.fn(),
    };
    const onFallback = vi.fn();
    const repository = new ResilientWorkspaceRepository(primary, { repository: new InMemoryWorkspaceRepository(), onFallback });
    await expect(repository.load("user-a")).rejects.toBeInstanceOf(CorruptWorkspaceError);
    expect(onFallback).not.toHaveBeenCalled();
  });
});

describe("workspace save queue", () => {
  it("coalesces rapid edits into the latest serialized save", async () => {
    vi.useFakeTimers();
    try {
      const queue = new WorkspaceSaveQueue();
      const first = createStarterWorkspace(() => crypto.randomUUID());
      const second = { ...first, updatedAt: "2026-08-19T00:00:01.000Z" };
      const saved: string[] = [];
      const request = (workspace: typeof first) => ({
        userId: "user-a",
        workspace,
        save: async (_userId: string, document: typeof first) => { saved.push(document.updatedAt); },
        isCurrent: () => true,
        onStart: vi.fn(),
        onSettled: vi.fn(),
      });
      queue.schedule(request(first), 20);
      queue.schedule(request(second), 20);
      await vi.advanceTimersByTimeAsync(20);
      await queue.flush();
      expect(saved).toEqual([second.updatedAt]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops stale requests and reports save failures", async () => {
    vi.useFakeTimers();
    try {
      const queue = new WorkspaceSaveQueue();
      const workspace = createStarterWorkspace(() => crypto.randomUUID());
      const staleStart = vi.fn();
      queue.schedule({ userId: "user-a", workspace, save: vi.fn(async () => {}), isCurrent: () => false, onStart: staleStart, onSettled: vi.fn() }, 1);
      await vi.advanceTimersByTimeAsync(1);
      await queue.flush();
      expect(staleStart).not.toHaveBeenCalled();

      const settled = vi.fn();
      queue.schedule({ userId: "user-a", workspace, save: vi.fn(async () => { throw new Error("save failed"); }), isCurrent: () => true, onStart: vi.fn(), onSettled: settled }, 1);
      await vi.advanceTimersByTimeAsync(1);
      await queue.flush();
      expect(settled).toHaveBeenCalledWith(expect.any(Number), "user-a", expect.any(Error));

      const flushed = vi.fn();
      queue.schedule({ userId: "user-a", workspace, save: vi.fn(async () => {}), isCurrent: () => true, onStart: vi.fn(), onSettled: flushed }, 100);
      await queue.flush();
      expect(flushed).toHaveBeenCalledWith(expect.any(Number), "user-a");
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidates a pending save during logout or workspace clearing", async () => {
    vi.useFakeTimers();
    try {
      const queue = new WorkspaceSaveQueue();
      const save = vi.fn(async () => {});
      const workspace = createStarterWorkspace(() => crypto.randomUUID());
      queue.schedule({ userId: "user-a", workspace, save, isCurrent: () => true, onStart: vi.fn(), onSettled: vi.fn() }, 20);
      queue.invalidate();
      await vi.advanceTimersByTimeAsync(20);
      await queue.flush();
      expect(save).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
