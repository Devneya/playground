import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useMemo, useState } from "react";
import { canAddInputConnection, getOrderedInputEdges } from "../../domain/graph";
import { randomIdFactory } from "../../domain/ids";
import { isTextNode, type GenerationData, type InputEdge } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";

type GenerationFlowNode = Node<GenerationData, "generation">;

export const GenerationNode = ({ id, data }: NodeProps<GenerationFlowNode>) => {
  const { activeFlow, activeRunIds, models, modelsStatus, modelsError, reloadModels, dispatch, runGeneration, cancelRun, virtualKey } = useWorkspace();
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [localRunId, setLocalRunId] = useState<string | null>(null);
  const inputs = getOrderedInputEdges(activeFlow, id);
  const addableInputs = activeFlow.nodes
    .filter(isTextNode)
    .filter((node) => !inputs.some((edge) => edge.source === node.id) && canAddInputConnection(activeFlow, node.id, id).allowed);
  const addInput = () => {
    const source = addableInputs.find((node) => node.id === (selectedInputId || addableInputs[0]?.id));
    if (!source) return;
    const edge: InputEdge = { id: randomIdFactory(), kind: "input", source: source.id, target: id, order: inputs.length };
    dispatch({ type: "input/add", flowId: activeFlow.id, edge });
    setSelectedInputId("");
  };
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
      <span className="node-kind generation-kind">Generation</span>
      <strong title={data.title}>{data.title}</strong>
    </header>
    <label className="node-field">Instruction<textarea className="node-textarea instruction-textarea" aria-label={`${data.title} instruction`} value={data.instruction} onChange={(event) => dispatch({ type: "node/edit-instruction", flowId: activeFlow.id, nodeId: id, instruction: event.target.value })} placeholder="Optional instruction for the model…" /></label>
    <div className="input-order" aria-label="Generation inputs">
      <div className="field-label">Inputs <span className="muted">({inputs.length})</span></div>
      {addableInputs.length > 0 && <div className="input-adder">
        <select aria-label={`${data.title} input source`} value={selectedInputId || addableInputs[0]?.id || ""} onChange={(event) => setSelectedInputId(event.target.value)}>
          {addableInputs.map((node) => <option key={node.id} value={node.id}>{node.data.title}</option>)}
        </select>
        <button type="button" className="small-button" onClick={addInput}>Add input</button>
      </div>}
      {inputs.length === 0 ? <span className="muted">Connect Text nodes here or use Add input.</span> : inputs.map((edge, index) => <div className="input-row" key={edge.id}>
        <select aria-label={`Reconnect input ${index + 1}`} value={edge.source} onChange={(event) => dispatch({ type: "input/reconnect", flowId: activeFlow.id, edgeId: edge.id, source: event.target.value, target: id })}>
          {activeFlow.nodes.filter(isTextNode).map((node) => <option key={node.id} value={node.id}>{node.data.title}</option>)}
        </select>
        <span>
          <button type="button" className="icon-button" aria-label={`${data.title} input ${index + 1} move up`} disabled={index === 0} onClick={() => dispatch({ type: "input/move", flowId: activeFlow.id, edgeId: edge.id, direction: "up" })}>↑</button>
          <button type="button" className="icon-button" aria-label={`${data.title} input ${index + 1} move down`} disabled={index === inputs.length - 1} onClick={() => dispatch({ type: "input/move", flowId: activeFlow.id, edgeId: edge.id, direction: "down" })}>↓</button>
          <button type="button" className="icon-button" aria-label={`Remove input ${index + 1}`} onClick={() => dispatch({ type: "input/remove", flowId: activeFlow.id, edgeId: edge.id })}>×</button>
        </span>
      </div>)}
    </div>
    <div className="model-picker">
      <div className="field-label">Models <span className="muted">({data.modelIds.length}/4)</span></div>
      {modelsStatus === "loading" && <span className="muted">Loading live catalog…</span>}
      {modelsStatus === "error" && <span className="form-error">{modelsError} <button type="button" className="small-button" onClick={reloadModels}>Retry</button></span>}
      {modelsStatus === "ready" && models.map((model) => <label className="model-option" key={model.id}><input type="checkbox" aria-label={`${data.title} model ${model.id}`} checked={selected.has(model.id)} onChange={() => toggleModel(model.id)} disabled={!selected.has(model.id) && data.modelIds.length >= 4} /> <span>{model.id}</span></label>)}
      {data.modelIds.filter((modelId) => !models.some((model) => model.id === modelId)).map((modelId) => <span className="model-option stale-model" key={modelId}><span>✓ {modelId}</span><button type="button" className="icon-button" onClick={() => toggleModel(modelId)} aria-label={`Remove ${modelId}`}>×</button></span>)}
      {modelsStatus === "ready" && models.length === 0 && <span className="muted">No models are currently available.</span>}
    </div>
    {(runError || !virtualKey) && <p className="form-error node-error">{runError || "Account key is loading; sign in to run."}</p>}
    <button type="button" className="primary-button run-button" onClick={runningBatchId ? () => cancelRun(runningBatchId) : run} disabled={!runningBatchId && (!virtualKey || data.modelIds.length === 0)}>{runningBatchId ? "Cancel run" : "Run generation"}</button>
  </article>;
};
