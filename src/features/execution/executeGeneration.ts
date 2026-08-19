import { createChatCompletion } from "../../api/completions";
import type { BifrostVirtualKey } from "../../api/credentials";
import { normalizeApiError } from "../../api/errors";
import { buildCompletionMessagesV1 } from "../../domain/completion";
import { getInputSnapshots, getNode } from "../../domain/graph";
import { LIMITS, utf8ByteLength } from "../../domain/limits";
import { placeNewResultNodes } from "../../domain/resultPlacement";
import type { Clock, ExecutionBatch, ExecutionError, FlowDocument, IdFactory, PlaygroundEdge, PlaygroundNode, Usage } from "../../domain/types";
import { isGenerationNode } from "../../domain/types";
import type { WorkspaceAction } from "../../domain/workspaceReducer";

type RunOptions = {
  flow: FlowDocument;
  generationNodeId: string;
  virtualKey: BifrostVirtualKey;
  idFactory: IdFactory;
  clock: Clock;
  dispatch(action: WorkspaceAction): void;
  signal?: AbortSignal;
};

export type GenerationRun = {
  batchId: string;
  cancel(): void;
  completed: Promise<void>;
};

const cancelledError = (): ExecutionError => ({ kind: "cancelled", message: "The run was cancelled." });

const executionError = (error: unknown): ExecutionError => {
  const normalized = normalizeApiError(error);
  if (normalized.kind === "aborted") return cancelledError();
  if (normalized.kind === "http") return {
    kind: "http",
    message: normalized.message,
    ...(normalized.status === undefined ? {} : { status: normalized.status }),
    ...(normalized.code === undefined ? {} : { code: normalized.code }),
  };
  if (normalized.kind === "invalid_response") return { kind: "invalid_response", message: normalized.message, ...(normalized.code === undefined ? {} : { code: normalized.code }) };
  return { kind: "network", message: normalized.message };
};

const duration = (started: number) => Math.max(0, Math.round(performance.now() - started));

export const startGenerationRun = (options: RunOptions): GenerationRun => {
  const { flow, generationNodeId, virtualKey, idFactory, clock, dispatch } = options;
  const generation = getNode(flow, generationNodeId);
  if (!isGenerationNode(generation)) throw new Error("Choose a Generation node to run.");
  const modelIds = [...generation.data.modelIds];
  if (modelIds.length === 0) throw new Error("Choose at least one model before running.");
  if (modelIds.length > LIMITS.maxModelsPerBatch) throw new Error(`Choose no more than ${LIMITS.maxModelsPerBatch} models.`);
  const inputs = getInputSnapshots(flow, generation.id);
  const instruction = generation.data.instruction;
  const messages = buildCompletionMessagesV1(inputs, instruction);
  if (utf8ByteLength(messages[0]?.content ?? "") > LIMITS.maxPromptBytes) throw new Error("The generated prompt is too large.");

  const batchId = idFactory();
  const startedAt = clock.now().toISOString();
  const positions = placeNewResultNodes(flow, generation.id, modelIds.length);
  const executions = modelIds.map((modelId, index) => ({
    id: idFactory(),
    modelId,
    status: "pending" as const,
    startedAt,
    outputNodeId: idFactory(),
    position: positions[index],
  }));
  const outputNodes: PlaygroundNode[] = executions.map((execution) => ({
    id: execution.outputNodeId,
    position: execution.position ?? { x: generation.position.x + 360, y: generation.position.y },
    data: { kind: "text", origin: "generated", title: execution.modelId, text: "", batchId, executionId: execution.id },
    createdAt: startedAt,
    updatedAt: startedAt,
  }));
  const resultEdges: PlaygroundEdge[] = executions.map((execution) => ({ id: idFactory(), kind: "result", source: generation.id, target: execution.outputNodeId }));
  const batch: ExecutionBatch = {
    id: batchId,
    generationNodeId: generation.id,
    startedAt,
    promptFormatVersion: 1,
    instruction,
    inputs,
    executions: executions.map(({ id, modelId, status, startedAt: executionStartedAt, outputNodeId }) => ({ id, modelId, status, startedAt: executionStartedAt, outputNodeId })),
  };
  const controller = new AbortController();
  const externalAbort = options.signal;
  const abortExternal = () => controller.abort();
  externalAbort?.addEventListener("abort", abortExternal, { once: true });
  dispatch({ type: "batch/started", flowId: flow.id, batch, outputNodes, resultEdges });

  const completed = Promise.allSettled(executions.map(async (execution) => {
    const started = performance.now();
    try {
      const result = await createChatCompletion(virtualKey, { model: execution.modelId, messages, stream: false }, controller.signal);
      const usage = result.usage as Usage | undefined;
      dispatch({ type: "execution/succeeded", flowId: flow.id, batchId, executionId: execution.id, text: result.content, durationMs: duration(started), ...(usage ? { usage } : {}) });
    } catch (error) {
      const failure = executionError(error);
      dispatch(failure.kind === "cancelled"
        ? { type: "execution/cancelled", flowId: flow.id, batchId, executionId: execution.id, error: failure, durationMs: duration(started) }
        : { type: "execution/failed", flowId: flow.id, batchId, executionId: execution.id, error: failure, durationMs: duration(started) });
    }
  })).then(() => {
    externalAbort?.removeEventListener("abort", abortExternal);
    dispatch({ type: "batch/completed", flowId: flow.id, batchId, completedAt: clock.now().toISOString() });
  });

  return { batchId, cancel: () => controller.abort(), completed };
};
