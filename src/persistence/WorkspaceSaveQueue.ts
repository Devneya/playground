import type { WorkspaceDocument } from "../domain/types";

type SaveRequest = {
  queueVersion: number;
  userId: string;
  workspace: WorkspaceDocument;
  save(userId: string, workspace: WorkspaceDocument): Promise<void>;
  isCurrent(queueVersion: number, userId: string): boolean;
  onStart(): void;
  onSettled(queueVersion: number, userId: string, error?: unknown): void;
};

/** Serializes saves while dropping superseded pending snapshots. */
export class WorkspaceSaveQueue {
  private chain = Promise.resolve();
  private pending: SaveRequest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queueVersion = 0;

  public schedule(request: Omit<SaveRequest, "queueVersion">, delayMs = 350): void {
    const queueVersion = ++this.queueVersion;
    this.pending = { ...request, queueVersion };
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, delayMs);
  }

  public invalidate(): void {
    this.queueVersion += 1;
    this.pending = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  public async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.drain();
    }
    await this.chain;
  }

  private drain(): void {
    const request = this.pending;
    this.pending = null;
    if (!request) return;
    this.chain = this.chain.then(async () => {
      if (!request.isCurrent(request.queueVersion, request.userId)) return;
      request.onStart();
      try {
        await request.save(request.userId, request.workspace);
        request.onSettled(request.queueVersion, request.userId);
      } catch (error) {
        request.onSettled(request.queueVersion, request.userId, error);
      }
    });
  }
}
