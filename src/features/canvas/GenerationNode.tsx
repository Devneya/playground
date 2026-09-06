import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useMemo, useState } from "react";
import { getOrderedInputEdges } from "../../domain/graph";
import type { GenerationData } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";
import { ModelPicker } from "./ModelPicker";

type GenerationFlowNode = Node<GenerationData, "generation">;

export const GenerationNode = ({ id, data }: NodeProps<GenerationFlowNode>) => {
  const { activeFlow, activeRunIds, models, modelsStatus, modelsError, reloadModels, reloadKey, dispatch, runGeneration, cancelRun, virtualKey, keyStatus, keyError } = useWorkspace();
  const [runError, setRunError] = useState<string | null>(null);
  const [localRunId, setLocalRunId] = useState<string | null>(null);
  const inputs = getOrderedInputEdges(activeFlow, id);
  const runningBatch = useMemo(() => activeFlow.batches.find((batch) => batch.generationNodeId === id && batch.executions.some((execution) => execution.status === "pending")), [activeFlow.batches, id]);
  const runningBatchId = runningBatch?.id ?? activeRunIds[id] ?? localRunId;
  const selected = new Set(data.modelIds);
  const toggleModel = (modelId: string) => {
    const next = selected.has(modelId) ? data.modelIds.filter((item) => item !== modelId) : [...data.modelIds, modelId];
    if (next.length > 4) return;
    dispatch({ type: "node/set-models", flowId: activeFlow.id, nodeId: id, modelIds: next });
  };
  const run = () => {
    setRunError(null);
    try {
      const started = runGeneration(id);
      setLocalRunId(started.batchId);
      void started.completed.finally(() => setLocalRunId((current) => current === started.batchId ? null : current));
    } catch (error) { setRunError(error instanceof Error ? error.message : "Unable to start the run."); }
  };
  return <article className="flow-node generation-node">
    <Handle type="target" position={Position.Left} id="generation-input" />
    <Handle type="source" position={Position.Right} id="generation-output" isConnectable={false} />
    <header className="node-header">
      <strong title={data.title}>{data.title}</strong>
      <span className="node-header-spacer" />
      <button type="button" className="icon-button" aria-label={`Delete ${data.title}`} onClick={() => dispatch({ type: "node/delete", flowId: activeFlow.id, nodeId: id })}>×</button>
    </header>
    <ModelPicker title={data.title} modelIds={data.modelIds} models={models} status={modelsStatus} error={modelsError} onReload={reloadModels} onToggle={toggleModel} />
    <label className="node-field"><textarea className="node-textarea instruction-textarea" aria-label={`${data.title} instruction`} value={data.instruction} onChange={(event) => dispatch({ type: "node/edit-instruction", flowId: activeFlow.id, nodeId: id, instruction: event.target.value })} placeholder="Optional instruction for the model…" /></label>
    <div className="input-order" aria-label="Generation inputs">
      <div className="field-label visually-hidden">Inputs <span className="muted">({inputs.length})</span></div>
      {inputs.length === 0 ? <span className="muted">Drag a Text node onto this card.</span> : inputs.map((edge, index) => {
        const source = activeFlow.nodes.find((node) => node.id === edge.source);
        return <div className="input-row" key={edge.id}><span>{source?.data.title ?? "Text"}</span><button type="button" className="icon-button" aria-label={`Remove input ${index + 1}`} onClick={() => dispatch({ type: "input/remove", flowId: activeFlow.id, edgeId: edge.id })}>×</button></div>;
      })}
    </div>
    <div className="model-picker">
      {data.modelIds.filter((modelId) => !models.some((model) => model.id === modelId)).map((modelId) => <span className="model-option stale-model" key={modelId}><span>✓ {modelId}</span><button type="button" className="icon-button" onClick={() => toggleModel(modelId)} aria-label={`Remove ${modelId}`}>×</button></span>)}
    </div>
    {(runError || !virtualKey) && <p className="form-error node-error">{runError || keyError || (keyStatus === "loading" ? "Account key is loading; sign in to run." : "Account key is not ready yet.")} {keyStatus === "error" && <button type="button" className="small-button" onClick={reloadKey}>Retry account key</button>}</p>}
    <div className="node-run-row"><button type="button" className={runningBatchId ? "send-button running" : "send-button"} aria-label={runningBatchId ? "Cancel run" : "Run generation"} title={runningBatchId ? "Cancel run" : "Run generation"} onClick={runningBatchId ? () => cancelRun(runningBatchId) : run} disabled={!runningBatchId && (!virtualKey || data.modelIds.length === 0)}>{runningBatchId ? "■" : "➤"}</button></div>
  </article>;
};
