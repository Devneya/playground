import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import type { GeneratedTextData, TextNodeData } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";
import { CardIcon } from "./CardIcon";

type TextFlowNode = Node<TextNodeData, "text">;

const displayGenerationTitle = (title: string) => {
  const defaultTitle = /^Generation\s+(\d+)$/.exec(title);
  return defaultTitle ? `Prompt ${defaultTitle[1]}` : title;
};

export const TextNode = ({ id, data: flowData }: NodeProps<TextFlowNode>) => {
  const { activeFlow, dispatch } = useWorkspace();
  const { fitView } = useReactFlow();
  const currentNode = activeFlow.nodes.find((node) => node.id === id);
  const data = currentNode?.data.kind === "text" ? currentNode.data : flowData;
  const generated = data.origin === "generated";
  const noteSource = data.origin === "manual" ? data.source : undefined;
  const sourceAvailable = noteSource && activeFlow.nodes.some((node) => node.id === noteSource.nodeId);
  const generatedData = generated ? data as GeneratedTextData : undefined;
  const batch = generatedData ? activeFlow.batches.find((candidate) => candidate.id === generatedData.batchId) : undefined;
  const execution = generatedData ? batch?.executions.find((candidate) => candidate.id === generatedData.executionId) : undefined;
  const executionSucceeded = execution?.status === "success";
  const modelLabel = execution?.modelId ?? data.title;
  const contextEntries = batch?.context ?? batch?.inputs.map((input) => ({ role: "user" as const, content: input.text, nodeId: input.nodeId }));
  const sourcePrompt = batch ? activeFlow.nodes.find((node) => node.id === batch.generationNodeId) : undefined;
  const contextCount = contextEntries?.length ?? 0;
  const followingCount = activeFlow.edges.filter((edge) => edge.kind === "input" && edge.source === id).length;

  const continueGeneration = () => dispatch({ type: "generation/continue", flowId: activeFlow.id, sourceNodeId: id });
  return <article className={`flow-node spatial-card text-node ${generated ? "generated-node" : "manual-node"}`}>
    <Handle type="target" position={Position.Left} id="text-input" isConnectable={false} />
    <Handle type="target" position={Position.Top} id="flow-top" isConnectable={false} className="flow-handle" />
    <Handle type="source" position={Position.Right} id="text-output" className="user-handle" />
    <Handle type="source" position={Position.Bottom} id="flow-bottom" isConnectable={false} className="flow-handle" />
    <header className="node-header">
      <span className="drag-hint" aria-hidden="true"><CardIcon name="grip" size={13} /></span>
      <strong title={modelLabel}>{generated ? modelLabel : data.title}</strong>
      <span className="node-header-spacer" />
      {noteSource && <button type="button" className="small-button nodrag nopan" disabled={!sourceAvailable} title={sourceAvailable ? "Go to original response" : "Original response was removed; source record is kept below"} onClick={() => void fitView({ nodes: [{ id: noteSource.nodeId }], maxZoom: 1, duration: 200 })}>Source ↗</button>}
      {generated && <button type="button" className="icon-button note-action nodrag nopan" aria-label="Save as note" title="Save a separate editable note" disabled={!data.text.trim()} onClick={() => dispatch({ type: "node/extract-note", flowId: activeFlow.id, sourceNodeId: id })}><CardIcon name="note" size={17} /><span>Note</span></button>}
      <button type="button" className="icon-button nodrag nopan" aria-label={`Delete ${data.title}`} title={`Delete ${data.title}`} onClick={() => dispatch({ type: "node/delete", flowId: activeFlow.id, nodeId: id })}><CardIcon name="close" size={14} /></button>
    </header>
    <div className="node-body nodrag nopan">
      {generated ? <>
        <div className="node-content generated-content" role="group" aria-label={`${modelLabel} response`}>{data.text || (execution?.status === "failed" ? "Failed: The completion request failed." : "Waiting for model output…")}</div>
        <div className="node-gent-action">
          <details className="context-disclosure">
            <summary><CardIcon name="history" size={13} /><span>Context <span className="muted">({contextCount})</span></span></summary>
            <div className="context-detail-meta"><span>Source prompt</span><strong>{sourcePrompt ? displayGenerationTitle(sourcePrompt.data.title) : batch?.generationNodeId ?? "Prompt"}</strong><span>Following</span><strong>{followingCount}</strong></div>
            {batch && <div className="context-entry"><span className="context-entry-role">You</span><p>{batch.instruction}</p></div>}
            {contextEntries?.map((entry, index) => <div className="context-entry" key={`${entry.nodeId}-${index}`}><span className="context-entry-role">{entry.role === "assistant" ? "Assistant" : "You"}{"modelId" in entry && entry.modelId ? ` · ${entry.modelId}` : ""}</span><p>{entry.content}</p></div>)}
          </details>
          {executionSucceeded && <button type="button" className="small-button branch-button nodrag nopan" title="Branch from this response with its context, including the answer" onClick={continueGeneration}><CardIcon name="branch" size={14} /><span>Branch</span></button>}
        </div>
      </> : <>
        <textarea className="node-textarea manual-textarea nodrag nopan nowheel" aria-label={`${data.title} text`} value={data.text} onChange={(event) => dispatch({ type: "node/edit-text", flowId: activeFlow.id, nodeId: id, text: event.target.value })} placeholder="Write a note to include in a prompt…" />
        {noteSource && <details className="context-disclosure note-source">
          <summary><CardIcon name="history" size={13} /><span>Source · {noteSource.modelId}</span></summary>
          <div className="context-entry"><span className="context-entry-role">Original prompt</span><p>{noteSource.instruction || "Context-only reply"}</p></div>
          <div className="context-entry"><span className="context-entry-role">Original response</span><p>{noteSource.text}</p></div>
        </details>}
      </>}
    </div>
  </article>;
};
