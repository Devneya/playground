import { Handle, Position, useConnection, type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { getConversationPath } from "../../domain/conversation";
import { canAddInputConnection, getOrderedInputEdges } from "../../domain/graph";
import type { ExecutionBatch, FlowDocument, GenerationData } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";
import { CardIcon } from "./CardIcon";
import { CardRail, ContextDisclosure, contextThread } from "./contextLabel";
import { ModelPicker } from "./ModelPicker";
import { usePromptDraft } from "./usePromptDraft";
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
    dispatch,
    runGeneration,
    virtualKey,
    keyStatus,
    keyError,
    reloadKey,
  } = useWorkspace();
  // Read the authoritative workspace before applying local typing drafts.
  const currentNode = activeFlow.nodes.find((node) => node.id === id);
  const data = currentNode?.data.kind === "generation" ? currentNode.data : flowData;
  const commitInstruction = useCallback((instruction: string) => dispatch({ type: "node/edit-instruction", flowId: activeFlow.id, nodeId: id, instruction }), [activeFlow.id, dispatch, id]);
  const { text: draftInstruction, change: changeInstruction, flush: flushInstruction } = usePromptDraft(data.instruction, commitInstruction);
  const [runError, setRunError] = useState<string | null>(null);
  const [localRunId, setLocalRunId] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const connection = useConnection();
  const instructionReady = draftInstruction.trim().length > 0;
  const inputs = getOrderedInputEdges(activeFlow, id);
  const sourceId = connection.fromNode?.id;
  const dropValid = connection.inProgress && connection.toNode?.id === id && (sourceId ? canAddInputConnection(activeFlow, sourceId, id).allowed : false);
  const latestBatch = useMemo(() => latestBatchFor(activeFlow.batches, id), [activeFlow.batches, id]);
  const draftContext = useMemo(() => data.context ?? getConversationPath(activeFlow, id), [activeFlow, data.context, id]);
  const runningBatch = useMemo(() => activeFlow.batches.find((batch) => batch.generationNodeId === id && batch.executions.some((execution) => execution.status === "pending")), [activeFlow.batches, id]);
  const runningBatchId = runningBatch?.id ?? activeRunIds[id] ?? localRunId;
  const showDraft = !latestBatch;
  const displayTitle = displayGenerationTitle(data.title);

  const resizeInstruction = useCallback(() => {
    if (globalThis.CSS?.supports("field-sizing", "content")) return;
    const textarea = instructionRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 53), 180)}px`;
  }, []);

  useLayoutEffect(() => {
    resizeInstruction();
  }, [draftInstruction, resizeInstruction, showDraft]);

  const selectModel = (modelId: string) => {
    dispatch({ type: "node/set-models", flowId: activeFlow.id, nodeId: id, modelIds: [modelId] });
  };

  const run = useCallback(() => {
    setRunError(null);
    try {
      const started = runGeneration(id, flushInstruction());
      setLocalRunId(started.batchId);
      void started.completed.finally(() => setLocalRunId((current) => current === started.batchId ? null : current));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Unable to start the run.");
    }
  }, [flushInstruction, id, runGeneration]);

  const handleInstructionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDraft) return;
    if (event.nativeEvent.isComposing || event.key !== "Enter" || event.shiftKey) return;
    if (event.ctrlKey || event.metaKey) event.preventDefault();
    else if (virtualKey && data.modelIds.length > 0 && instructionReady && !runningBatchId) event.preventDefault();
    if ((event.ctrlKey || event.metaKey || !event.shiftKey) && virtualKey && data.modelIds.length > 0 && instructionReady && !runningBatchId) run();
  };

  const editableInputs = inputs.map((edge, index) => {
    const source = activeFlow.nodes.find((node) => node.id === edge.source);
    return <div className="input-row" key={edge.id}><span>{source?.data.title ?? "Text"}</span><button type="button" className="icon-button nodrag nopan" aria-label={`Remove input ${index + 1}`} onClick={() => dispatch({ type: "input/remove", flowId: activeFlow.id, edgeId: edge.id })}><CardIcon name="close" size={13} /></button></div>;
  });

  return <article className={`flow-node spatial-card generation-node you-card ${showDraft ? "draft-generation-node" : "sent-generation-node"} ${dropValid ? "drop-target" : ""}`}>
    <Handle type="target" position={Position.Left} id="generation-input" className="user-handle" />
    <Handle type="target" position={Position.Top} id="flow-top" isConnectable={false} className="flow-handle" />
    <Handle type="source" position={Position.Right} id="generation-output" isConnectable={false} />
    <Handle type="target" position={Position.Right} id="generation-right-input" className="user-handle generation-right-input" style={{ top: "50%" }} />
    <Handle type="source" position={Position.Bottom} id="flow-bottom" isConnectable={false} className="flow-handle" />
    <header className="node-header generation-node-header">
      <span className="drag-hint" aria-hidden="true"><CardIcon name="grip" size={13} /></span>
      <strong className="visually-hidden" title={displayTitle}>{displayTitle}</strong>
      <div className="generation-header-model nowheel nodrag nopan"><ModelPicker title={displayTitle} modelIds={data.modelIds} modelEfforts={data.modelEfforts} models={models} status={modelsStatus} error={modelsError} onReload={reloadModels} onSelect={selectModel} readOnly={!showDraft} onEffort={(modelId, effort) => dispatch({ type: "node/set-effort", flowId: activeFlow.id, nodeId: id, modelId, effort })} /></div>
      <div className="generation-header-trailing nodrag nopan">
        <button type="button" className="icon-button" aria-label={`Delete ${displayTitle}`} title={`Delete ${displayTitle}`} onClick={() => dispatch({ type: "node/delete", flowId: activeFlow.id, nodeId: id })}><CardIcon name="close" size={14} /></button>
      </div>
    </header>

    <div className="node-body nodrag nopan">
      <>
        <div className="prompt-compose" role="group" aria-label={`${displayTitle} prompt`}>
          <label className="node-field prompt-field">
            <span className="visually-hidden">Instruction</span>
            <textarea
              ref={instructionRef}
              rows={1}
              className="node-textarea instruction-textarea nodrag nopan nowheel"
              aria-label={`${displayTitle} instruction`}
              readOnly={!showDraft}
              value={showDraft ? draftInstruction : latestBatch?.instruction ?? data.instruction}
              onChange={(event) => changeInstruction(event.target.value)}
              onBlur={() => flushInstruction()}
              onKeyDown={handleInstructionKeyDown}
              placeholder={`Ask ${data.modelIds[0] ?? "a model"}`}
            />
          </label>
          <button type="button" className="send-button" aria-label="Send prompt" title="Send prompt" onClick={run} disabled={!showDraft || !virtualKey || data.modelIds.length === 0 || !instructionReady || !!runningBatchId}><CardIcon name="send" size={15} /></button>
        </div>
        <div className="stale-model-list" role="group" aria-label="Unavailable selected models">
          {data.modelIds.filter((modelId) => !models.some((model) => model.id === modelId)).map((modelId) => <span className="model-option stale-model" key={modelId}><span>{modelId}</span><button type="button" className="icon-button nodrag nopan" disabled={!showDraft} onClick={() => dispatch({ type: "node/set-models", flowId: activeFlow.id, nodeId: id, modelIds: data.modelIds.filter((item) => item !== modelId).slice(0, 1) })} aria-label={`Remove ${modelId}`}><CardIcon name="close" size={13} /></button></span>)}
        </div>
        {(runError || !virtualKey) && <p className="form-error node-error" role={runError || keyStatus === "error" ? "alert" : undefined}>{runError || keyError || (keyStatus === "loading" ? "Account key is loading; sign in to run." : "Account key is not ready yet.")} {keyStatus === "error" && <button type="button" className="small-button nodrag nopan" onClick={reloadKey}>Retry account key</button>}</p>}
      </>
    </div>
    <CardRail
      context={<GenerationContextDetails
        flow={activeFlow}
        batch={showDraft ? undefined : latestBatch}
        inputCount={inputs.length}
        context={showDraft ? draftContext : data.context}
        instruction={showDraft ? draftInstruction : undefined}
        sourceNodeId={data.branchedFrom?.nodeId}
        followFromNodeId={id}
        editableInputs={showDraft ? editableInputs : undefined}
      />}
      action={!showDraft ? <button type="button" className="small-button branch-button duplicate-prompt-button" title="Fork: copy this prompt to the right" onClick={() => dispatch({ type: "generation/duplicate", flowId: activeFlow.id, sourceNodeId: id })}><CardIcon name="branch" size={14} /><span>Fork</span></button> : undefined}
    />
  </article>;
};

const GenerationContextDetails = ({ flow, batch, inputCount, context, instruction, sourceNodeId, followFromNodeId, editableInputs }: { flow: FlowDocument; batch: ExecutionBatch | undefined; inputCount: number; context?: GenerationData["context"] | undefined; instruction?: string | undefined; sourceNodeId?: string | undefined; followFromNodeId?: string | undefined; editableInputs?: ReactNode[] | undefined }) => {
  const { dispatch } = useWorkspace();
  const entries = batch?.context ?? context ?? batch?.inputs.map((input) => ({ role: "user" as const, content: input.text, nodeId: input.nodeId }));
  const source = flow.nodes.find((node) => node.id === (batch?.generationNodeId ?? sourceNodeId));
  const thread = contextThread(batch?.instruction ?? instruction, entries);
  const contextCount = thread.length || inputCount;
  const followingCount = followFromNodeId ? flow.edges.filter((edge) => edge.source === followFromNodeId).length : 0;
  const editable = !batch && !!followFromNodeId;
  const offset = instruction?.trim() ? 1 : 0;
  return <ContextDisclosure count={contextCount} meta={<><div className="context-detail-meta"><span>Source prompt</span><strong>{source ? displayGenerationTitle(source.data.title) : batch?.generationNodeId ?? sourceNodeId ?? "Prompt"}</strong><span>Following</span><strong>{followingCount}</strong></div>{batch && <p className="context-readonly">Sent context · Fork this prompt to edit its copy.</p>}</>} entries={thread}
    onRemove={editable ? index => dispatch({ type: "generation/remove-context", flowId: flow.id, nodeId: followFromNodeId!, index: index - offset }) : undefined}
    onClear={editable && (entries?.length ?? 0) > 0 ? () => dispatch({ type: "generation/clear-context", flowId: flow.id, nodeId: followFromNodeId! }) : undefined}
  >{editableInputs}</ContextDisclosure>;
};
