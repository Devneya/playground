import { Handle, Position, useConnection, type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { getConversationPath } from "../../domain/conversation";
import { canAddInputConnection, getOrderedInputEdges } from "../../domain/graph";
import type { ExecutionBatch, FlowDocument, GenerationData } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";
import { CardIcon } from "./CardIcon";
import { ModelPicker } from "./ModelPicker";
import "./spatial-cards.css";

type GenerationFlowNode = Node<GenerationData, "generation">;

const latestBatchFor = (batches: ExecutionBatch[], generationNodeId: string) => batches
  .filter((batch) => batch.generationNodeId === generationNodeId)
  .reduce<ExecutionBatch | undefined>((latest, batch) => !latest || batch.startedAt >= latest.startedAt ? batch : latest, undefined);

const displayGenerationTitle = (title: string) => {
  const defaultTitle = /^Generation\s+(\d+)$/.exec(title);
  return defaultTitle ? `Prompt ${defaultTitle[1]}` : title;
};

export const GenerationNode = ({ id, data: flowData }: NodeProps<GenerationFlowNode>) => {
  const {
    activeFlow,
    activeRunIds,
    models,
    modelsStatus,
    modelsError,
    reloadModels,
    reloadKey,
    dispatch,
    runGeneration,
    cancelRun,
    virtualKey,
    keyStatus,
    keyError,
  } = useWorkspace();
  // ReactFlow's internal node projection can lag a controlled keystroke.
  // Read the authoritative workspace so rapid typing and Enter never use it.
  const currentNode = activeFlow.nodes.find((node) => node.id === id);
  const data = currentNode?.data.kind === "generation" ? currentNode.data : flowData;
  const [runError, setRunError] = useState<string | null>(null);
  const [localRunId, setLocalRunId] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const connection = useConnection();
  const instructionReady = data.instruction.trim().length > 0;
  const inputs = getOrderedInputEdges(activeFlow, id);
  const sourceId = connection.fromNode?.id;
  const dropValid = connection.inProgress && connection.toNode?.id === id && (sourceId ? canAddInputConnection(activeFlow, sourceId, id).allowed : false);
  const latestBatch = useMemo(() => latestBatchFor(activeFlow.batches, id), [activeFlow.batches, id]);
  const draftContext = useMemo(() => data.context ?? getConversationPath(activeFlow, id), [activeFlow, data.context, id]);
  const runningBatch = useMemo(() => activeFlow.batches.find((batch) => batch.generationNodeId === id && batch.executions.some((execution) => execution.status === "pending")), [activeFlow.batches, id]);
  const runningBatchId = runningBatch?.id ?? activeRunIds[id] ?? localRunId;
  const showDraft = !latestBatch;
  const selected = new Set(data.modelIds);
  const displayTitle = displayGenerationTitle(data.title);

  const resizeInstruction = useCallback(() => {
    const textarea = instructionRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 180)}px`;
  }, []);

  useLayoutEffect(() => {
    resizeInstruction();
  }, [data.instruction, resizeInstruction, showDraft]);

  const toggleModel = (modelId: string) => {
    const next = selected.has(modelId) ? data.modelIds.filter((item) => item !== modelId) : [...data.modelIds, modelId];
    if (next.length > 4) return;
    dispatch({ type: "node/set-models", flowId: activeFlow.id, nodeId: id, modelIds: next });
  };

  const run = useCallback(() => {
    setRunError(null);
    try {
      const started = runGeneration(id);
      setLocalRunId(started.batchId);
      void started.completed.finally(() => setLocalRunId((current) => current === started.batchId ? null : current));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Unable to start the run.");
    }
  }, [id, runGeneration]);

  const handleInstructionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key !== "Enter" || event.shiftKey) return;
    if (event.ctrlKey || event.metaKey) event.preventDefault();
    else if (virtualKey && data.modelIds.length > 0 && instructionReady && !runningBatchId) event.preventDefault();
    if ((event.ctrlKey || event.metaKey || !event.shiftKey) && virtualKey && data.modelIds.length > 0 && instructionReady && !runningBatchId) run();
  };

  const editableInputs = inputs.map((edge, index) => {
    const source = activeFlow.nodes.find((node) => node.id === edge.source);
    return <div className="input-row" key={edge.id}><span>{source?.data.title ?? "Text"}</span><button type="button" className="icon-button nodrag nopan" aria-label={`Remove input ${index + 1}`} onClick={() => dispatch({ type: "input/remove", flowId: activeFlow.id, edgeId: edge.id })}><CardIcon name="close" size={13} /></button></div>;
  });

  return <article className={`flow-node spatial-card generation-node ${showDraft ? "draft-generation-node" : "sent-generation-node"} ${dropValid ? "drop-target" : ""}`}>
    <Handle type="target" position={Position.Left} id="generation-input" className="user-handle" />
    <Handle type="target" position={Position.Top} id="flow-top" isConnectable={false} className="flow-handle" />
    <Handle type="source" position={Position.Right} id="generation-output" isConnectable={false} />
    <Handle type="source" position={Position.Bottom} id="flow-bottom" isConnectable={false} className="flow-handle" />
    <header className="node-header generation-node-header">
      <span className="drag-hint" aria-hidden="true"><CardIcon name="grip" size={13} /></span>
      <strong className="visually-hidden" title={displayTitle}>{displayTitle}</strong>
      <div className="generation-header-context nodrag nopan">
        <GenerationContextDetails
          flow={activeFlow}
          batch={showDraft ? undefined : latestBatch}
          inputCount={inputs.length}
          context={showDraft ? draftContext : data.context}
          instruction={showDraft ? data.instruction : undefined}
          sourceNodeId={data.branchedFrom?.nodeId}
          followFromNodeId={id}
          editableInputs={showDraft ? editableInputs : undefined}
        />
      </div>
      {showDraft && <div className="generation-header-model nodrag nopan nowheel"><ModelPicker title={displayTitle} modelIds={data.modelIds} models={models} status={modelsStatus} error={modelsError} onReload={reloadModels} onToggle={toggleModel} /></div>}
      <button type="button" className="icon-button nodrag nopan" aria-label={`Delete ${displayTitle}`} title={`Delete ${displayTitle}`} onClick={() => dispatch({ type: "node/delete", flowId: activeFlow.id, nodeId: id })}><CardIcon name="close" size={14} /></button>
    </header>

    <div className="node-body nodrag nopan">
      {showDraft ? <>
        <div className="prompt-compose">
          <label className="node-field prompt-field">
            <span className="visually-hidden">Instruction</span>
            <textarea
              ref={instructionRef}
              rows={1}
              className="node-textarea instruction-textarea nodrag nopan nowheel"
              aria-label={`${displayTitle} instruction`}
              value={data.instruction}
              onChange={(event) => dispatch({ type: "node/edit-instruction", flowId: activeFlow.id, nodeId: id, instruction: event.target.value })}
              onKeyDown={handleInstructionKeyDown}
              placeholder="What should happen next?"
            />
          </label>
          <button type="button" className={runningBatchId ? "send-button running" : "send-button"} aria-label={runningBatchId ? "Cancel run" : "Send prompt"} title={runningBatchId ? "Cancel run" : "Send prompt"} onClick={runningBatchId ? () => cancelRun(runningBatchId) : run} disabled={!runningBatchId && (!virtualKey || data.modelIds.length === 0 || !instructionReady)}><CardIcon name={runningBatchId ? "close" : "send"} size={15} /></button>
        </div>
        <div className="stale-model-list" role="group" aria-label="Unavailable selected models">
          {data.modelIds.filter((modelId) => !models.some((model) => model.id === modelId)).map((modelId) => <span className="model-option stale-model" key={modelId}><span>{modelId}</span><button type="button" className="icon-button nodrag nopan" onClick={() => toggleModel(modelId)} aria-label={`Remove ${modelId}`}><CardIcon name="close" size={13} /></button></span>)}
        </div>
        {(runError || !virtualKey) && <p className="form-error node-error" role={runError || keyStatus === "error" ? "alert" : undefined}>{runError || keyError || (keyStatus === "loading" ? "Account key is loading; sign in to run." : "Account key is not ready yet.")} {keyStatus === "error" && <button type="button" className="small-button nodrag nopan" onClick={reloadKey}>Retry account key</button>}</p>}
      </> : <>
        <div className="completed-prompt" role="group" aria-label={`${displayTitle} prompt`}>
          <p>{latestBatch?.instruction || "Context-only reply"}</p>
        </div>
        <footer className="completed-footer">
          {runningBatchId ? <button type="button" className="send-button running" aria-label="Cancel run" title="Cancel run" onClick={() => cancelRun(runningBatchId)}><CardIcon name="close" size={15} /></button> : <button type="button" className="small-button branch-button duplicate-prompt-button" title="Branch: copy the captured original request to the right" onClick={() => dispatch({ type: "generation/duplicate", flowId: activeFlow.id, sourceNodeId: id })}><CardIcon name="branch" size={14} /><span>Branch</span></button>}
        </footer>
      </>}
    </div>
  </article>;
};

const GenerationContextDetails = ({ flow, batch, inputCount, context, instruction, sourceNodeId, followFromNodeId, editableInputs }: { flow: FlowDocument; batch: ExecutionBatch | undefined; inputCount: number; context?: GenerationData["context"] | undefined; instruction?: string | undefined; sourceNodeId?: string | undefined; followFromNodeId?: string | undefined; editableInputs?: ReactNode[] | undefined }) => {
  const entries = batch?.context ?? context ?? batch?.inputs.map((input) => ({ role: "user" as const, content: input.text, nodeId: input.nodeId }));
  const source = flow.nodes.find((node) => node.id === (batch?.generationNodeId ?? sourceNodeId));
  const contextCount = entries?.length ?? inputCount;
  const followingCount = followFromNodeId ? flow.edges.filter((edge) => edge.source === followFromNodeId).length : 0;
  return <details className="context-disclosure">
    <summary><CardIcon name="history" size={13} /><span>Context <span className="muted">({contextCount})</span></span></summary>
    <div className="context-detail-meta"><span>Source prompt</span><strong>{source ? displayGenerationTitle(source.data.title) : batch?.generationNodeId ?? sourceNodeId ?? "Prompt"}</strong><span>Following</span><strong>{followingCount}</strong></div>
    {(batch || instruction) && <div className="context-entry"><span className="context-entry-role">You</span><p>{batch?.instruction ?? instruction}</p></div>}
    {entries?.map((entry, index) => <div className="context-entry" key={`${entry.nodeId}-${index}`}><span className="context-entry-role">{entry.role === "assistant" ? "Assistant" : "You"}{"modelId" in entry && entry.modelId ? ` · ${entry.modelId}` : ""}</span><p>{entry.content}</p></div>)}
    {editableInputs}
  </details>;
};
