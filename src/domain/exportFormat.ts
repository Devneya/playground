import { validateWorkspaceInvariants } from "./graph";
import { LIMITS, utf8ByteLength } from "./limits";
import { parseExport } from "./schemas";
import type { Clock, WorkspaceDocument } from "./types";

export const EXPORT_FORMAT = "devneya-flow-v1" as const;

export type WorkspaceExport = {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  workspace: WorkspaceDocument;
};

export class WorkspaceExportError extends Error {
  public constructor(message = "This workspace file is invalid.") {
    super(message);
    this.name = "WorkspaceExportError";
  }
}

const assertWorkspace = (workspace: WorkspaceDocument): WorkspaceDocument => {
  const errors = validateWorkspaceInvariants(workspace);
  if (errors.length > 0) throw new WorkspaceExportError(errors[0]);
  return workspace;
};

export const createWorkspaceExport = (workspace: WorkspaceDocument, clock: Clock): WorkspaceExport => {
  assertWorkspace(workspace);
  const exported = {
    format: EXPORT_FORMAT,
    exportedAt: clock.now().toISOString(),
    workspace,
  } satisfies WorkspaceExport;
  if (utf8ByteLength(JSON.stringify(exported)) > LIMITS.maxImportBytes) {
    throw new WorkspaceExportError("This workspace is too large to export.");
  }
  return exported;
};

export const parseWorkspaceExport = (raw: unknown): WorkspaceExport => {
  try {
    const candidate = parseExport(raw) as WorkspaceExport;
    assertWorkspace(candidate.workspace);
    if (utf8ByteLength(JSON.stringify(candidate)) > LIMITS.maxImportBytes) {
      throw new WorkspaceExportError("This workspace file is too large.");
    }
    return candidate;
  } catch (error) {
    if (error instanceof WorkspaceExportError) throw error;
    throw new WorkspaceExportError();
  }
};
