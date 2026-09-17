import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import type { GeneratedTextData, TextNodeData } from "../../domain/types";
import { LAYOUT } from "../../domain/resultPlacement";
import { useWorkspace } from "../workspace/useWorkspace";
import { panToRevealCard } from "./camera";
import { CardIcon } from "./CardIcon";
import { CardRail, ContextDisclosure, contextThread } from "./contextLabel";

type TextFlowNode = Node<TextNodeData, "text">;

const displayGenerationTitle = (title: string) => {
  const defaultTitle = /^Generation\s+(\d+)$/.exec(title);
  return defaultTitle ? `Prompt ${defaultTitle[1]}` : title;
};

const highlightCard = (nodeId: string) => {
  document.querySelectorAll(".spatial-card.source-highlight").forEach((card) => card.classList.remove("source-highlight"));
  const card = document.querySelector(`.react-flow__node[data-id="${nodeId}"] .spatial-card`);
  if (!card) return;
  card.classList.add("source-highlight");
  const clear = (event: PointerEvent) => {
    if (event.target instanceof globalThis.Node && card.contains(event.target)) return;
    card.classList.remove("source-highlight");
    document.removeEventListener("pointerdown", clear);
  };
  document.addEventListener("pointerdown", clear);
};

export const TextNode = ({ id, data: flowData }: NodeProps<TextFlowNode>) => {
  const { activeFlow, dispatch } = useWorkspace();
  const { getViewport, setViewport } = useReactFlow();
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
  const contextEntries = generated
    ? (batch?.context ?? batch?.inputs.map((input) => ({ role: "user" as const, content: input.text, nodeId: input.nodeId })))
    : noteSource
      ? [
        ...(noteSource.instruction.trim() ? [{ role: "user" as const, content: noteSource.instruction, nodeId: noteSource.nodeId }] : []),
        { role: "assistant" as const, content: noteSource.text, nodeId: noteSource.nodeId, modelId: noteSource.modelId },
      ]
      : [];
  const thread = contextThread(generated ? batch?.instruction : undefined, contextEntries);
  const contextCount = thread.length;
  const sourcePrompt = batch ? activeFlow.nodes.find((node) => node.id === batch.generationNodeId) : undefined;
  const followingCount = activeFlow.edges.filter((edge) => edge.kind === "input" && edge.source === id).length;
  const noteTitle = data.title.replace(/^Text\s+/, "Note ");

  const sparkChat = () => dispatch({ type: "generation/continue", flowId: activeFlow.id, sourceNodeId: id });
  const flashSource = () => {
    const sourceId = noteSource?.nodeId;
    if (!sourceId) return;
    const sourceNode = activeFlow.nodes.find((node) => node.id === sourceId);
    const rect = document.querySelector(".canvas-shell .react-flow")?.getBoundingClientRect();
    if (sourceNode && rect) {
      const viewport = panToRevealCard(getViewport(), { position: sourceNode.position, height: sourceNode.measuredHeight ?? LAYOUT.nodeHeight }, { width: rect.width, height: rect.height });
      if (viewport) setViewport(viewport, { duration: 280 });
    }
    highlightCard(sourceId);
  };
  return <article className={`flow-node spatial-card text-node ${generated ? "generated-node other-card" : "manual-node"}`}>
    <Handle type="target" position={Position.Left} id="text-input" isConnectable={false} />
    <Handle type="target" position={Position.Top} id="flow-top" isConnectable={false} className="flow-handle" />
    <Handle type="source" position={Position.Right} id="text-output" className="user-handle" />
    <Handle type="source" position={Position.Bottom} id="flow-bottom" isConnectable={false} className="flow-handle" />
    <header className="node-header">
      <span className="drag-hint" aria-hidden="true"><CardIcon name="grip" size={13} /></span>
      {!generated && <span className="note-mark" aria-hidden="true"><CardIcon name="note" size={15} /></span>}
      <strong title={generated ? modelLabel : noteTitle}>{generated ? modelLabel : noteTitle}</strong>
      <span className="node-header-spacer" />
      {noteSource && <button type="button" className="small-button nodrag nopan" disabled={!sourceAvailable} title={sourceAvailable ? "Go to original response" : "Original response was removed; context keeps the copy"} onClick={flashSource}>Show original</button>}
      {generated && <button type="button" className="icon-button note-action nodrag nopan" aria-label="Save as note" title="Save a separate editable note" disabled={!data.text.trim()} onClick={() => dispatch({ type: "node/extract-note", flowId: activeFlow.id, sourceNodeId: id })}><CardIcon name="note" size={17} /><span>Note</span></button>}
      <button type="button" className="icon-button nodrag nopan" aria-label={`Delete ${generated ? data.title : noteTitle}`} title={`Delete ${generated ? data.title : noteTitle}`} onClick={() => dispatch({ type: "node/delete", flowId: activeFlow.id, nodeId: id })}><CardIcon name="close" size={14} /></button>
    </header>
    <div className="node-body nodrag nopan">
      {generated
        ? <div className="node-content generated-content" role="group" aria-label={`${modelLabel} response`}>{data.text || (execution?.status === "failed" ? "Failed: The completion request failed." : "Waiting for model output…")}</div>
        : <textarea className="node-textarea manual-textarea nodrag nopan nowheel" aria-label={`${noteTitle} text`} value={data.text} onChange={(event) => dispatch({ type: "node/edit-text", flowId: activeFlow.id, nodeId: id, text: event.target.value })} placeholder="Write a note to include in a prompt…" />}
    </div>
    <CardRail
      context={<ContextDisclosure
        count={contextCount}
        meta={generated ? <div className="context-detail-meta"><span>Source prompt</span><strong>{sourcePrompt ? displayGenerationTitle(sourcePrompt.data.title) : batch?.generationNodeId ?? "Prompt"}</strong><span>Following</span><strong>{followingCount}</strong></div> : undefined}
        entries={thread}
      />}
      action={generated
        ? (executionSucceeded ? <button type="button" className="small-button branch-button nodrag nopan" title="Fork from this answer with its context" onClick={sparkChat}><CardIcon name="branch" size={14} /><span>Fork</span></button> : undefined)
        : <button type="button" className="small-button branch-button nodrag nopan" title="Start a chat using this note as context" onClick={sparkChat}><CardIcon name="message" size={14} /><span>Chat</span></button>}
    />
  </article>;
};
