export const LIMITS = {
  maxFlows: 50,
  maxNodesPerFlow: 250,
  maxEdgesPerFlow: 500,
  maxTextBytes: 64 * 1024,
  maxGeneratedBytes: 256 * 1024,
  maxPromptBytes: 256 * 1024,
  maxInputsPerGeneration: 32,
  maxWorkspaceBytes: 10 * 1024 * 1024,
  maxImportBytes: 10 * 1024 * 1024,
  maxModelsPerBatch: 4,
  maxHistoryEntries: 50,
  maxHistoryBytes: 20 * 1024 * 1024,
  maxFlowNameCodePoints: 80,
  maxNodeTitleCodePoints: 80,
} as const;

export const utf8ByteLength = (value: string) => new TextEncoder().encode(value).byteLength;
export const codePointLength = (value: string) => Array.from(value).length;
