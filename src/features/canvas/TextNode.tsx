import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import type { GeneratedTextData, TextNodeData } from "../../domain/types";
import { LAYOUT } from "../../domain/resultPlacement";
import { useWorkspace } from "../workspace/useWorkspace";
import { panToRevealCard } from "./camera";
import { CardIcon } from "./CardIcon";
import { CardRail, ContextDisclosure, contextThread } from "./contextLabel";
import { MarkdownText } from "./MarkdownText";
import { GenerationStatus } from "./GenerationStatus";
import { StoredImages } from "./StoredImages";
import { isSafeSvg } from "../../domain/images";
import { UploadedFileContent } from "./UploadedFileContent";

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
  const { activeFlow, dispatch, cancelRun } = useWorkspace();
  const { getViewport, setViewport } = useReactFlow();
  const currentNode = activeFlow.nodes.find((node) => node.id === id);
  const data = currentNode?.data.kind === "text" ? currentNode.data : flowData;
  const generated = data.origin === "generated";
  const legacyDrawing = useMemo(() => data.origin === "manual" && /\.svg$/i.test(data.title) && isSafeSvg(data.text.trim()) ? [{ name: data.title, mimeType: "image/svg+xml" as const, source: data.text.trim() }] : undefined, [data.origin, data.title, data.text]);
  const uploaded = data.origin === "manual" && (!!data.upload || !!data.files?.length || !!legacyDrawing);
  const fileType = uploaded ? (data.title.split(".").at(-1)?.toUpperCase().slice(0, 7) ?? "FILE") : undefined;
  const noteSource = data.origin === "manual" ? data.source : undefined;
  const sourceAvailable = noteSource && activeFlow.nodes.some((node) => node.id === noteSource.nodeId);
  const generatedData = generated ? data as GeneratedTextData : undefined;
  const batch = generatedData ? activeFlow.batches.find((candidate) => candidate.id === generatedData.batchId) : undefined;
  const execution = generatedData ? batch?.executions.find((candidate) => candidate.id === generatedData.executionId) : undefined;
  const executionSucceeded = execution?.status === "success";
  const visibleText = execution?.status === "pending" ? data.text.replace(/```svg[\s\S]*$/i, "").trim() : data.text;
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
  const sparkLeft = () => {
    if (!currentNode) return;
    dispatch({ type: "generation/continue", flowId: activeFlow.id, sourceNodeId: id, position: { x: currentNode.position.x - LAYOUT.nodeWidth - 28, y: currentNode.position.y }, sourceHandle: "text-left-output", targetHandle: "generation-right-input" });
  };
  const canConnect = !generated || executionSucceeded;
  const launchPrompt = {
    role: "button",
    tabIndex: canConnect ? 0 : -1,
    "aria-disabled": !canConnect,
    onClick: () => canConnect && sparkChat(),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (canConnect && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        sparkChat();
      }
    },
  };
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
  return <article className={`flow-node spatial-card text-node ${generated ? "generated-node other-card" : uploaded ? "file-node" : "manual-node"}`}>
    <Handle type="target" position={Position.Left} id="text-input" isConnectable={false} style={{ opacity: 0, pointerEvents: "none" }} />
    <Handle {...launchPrompt} onClick={() => canConnect && sparkLeft()} onKeyDown={event => { if (canConnect && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); sparkLeft(); } }} type="source" position={Position.Left} id="text-left-output" isConnectable={canConnect} className="user-handle prompt-launch-handle" aria-label="New prompt from left dot" title="Click for a prompt on the left, or drag to connect" />
    <Handle {...launchPrompt} type="target" position={Position.Top} id="flow-top" isConnectable={false} className="flow-handle prompt-launch-handle" aria-label="New prompt from top dot" title="Click to create a connected prompt" />
    <Handle {...launchPrompt} type="source" position={Position.Right} id="text-output" className="user-handle" aria-label="Create connected prompt" title="Click for a new prompt, or drag to connect" isConnectable={canConnect} />
    <Handle {...launchPrompt} type="source" position={Position.Bottom} id="flow-bottom" className="flow-handle" aria-label="Continue with a prompt" title="Click for a new prompt, or drag to connect" isConnectable={canConnect} />
    <header className="node-header">
      <span className="drag-hint" aria-hidden="true"><CardIcon name="grip" size={13} /></span>
      {!generated && <span className={uploaded ? "file-mark" : "note-mark"} aria-hidden="true"><CardIcon name={uploaded ? "file" : "note"} size={15} /></span>}
      <strong title={generated ? modelLabel : noteTitle}>{generated ? modelLabel : noteTitle}</strong>
      {fileType && <span className="file-type">{fileType}</span>}
      <span className="node-header-spacer" />
      {noteSource && <button type="button" className="small-button nodrag nopan" disabled={!sourceAvailable} title={sourceAvailable ? "Go to original response" : "Original response was removed; context keeps the copy"} onClick={flashSource}>Show original</button>}
      {generated && executionSucceeded && <button type="button" className="icon-button note-action nodrag nopan" aria-label="Save as note" title="Save a separate editable note" onClick={() => dispatch({ type: "node/extract-note", flowId: activeFlow.id, sourceNodeId: id })}><CardIcon name="note" size={15} /><span>Save as note</span></button>}
      <button type="button" className="icon-button nodrag nopan" aria-label={`Delete ${generated ? data.title : noteTitle}`} title={`Delete ${generated ? data.title : noteTitle}`} onClick={() => dispatch({ type: "node/delete", flowId: activeFlow.id, nodeId: id })}><CardIcon name="close" size={14} /></button>
    </header>
    <div className="node-body nodrag nopan">
      {generated
        ? <>
          {execution?.status === "pending" && batch && <GenerationStatus modelName={modelLabel} startedAt={batch.startedAt} instruction={batch.instruction} characters={execution.progress?.characters ?? data.text.length} message={execution.progress?.message} onStop={() => cancelRun(batch.id)} />}
          {visibleText && <div className="node-content generated-content" role="group" aria-label={`${modelLabel} response`}><MarkdownText text={visibleText} /></div>}
        </>
        : uploaded ? <UploadedFileContent title={noteTitle} text={data.text} images={data.images ?? legacyDrawing} files={data.files} onEdit={text => dispatch({ type: "node/edit-text", flowId: activeFlow.id, nodeId: id, text })} />
          : <textarea className="node-textarea manual-textarea nodrag nopan nowheel" aria-label={`${noteTitle} text`} value={data.text} onChange={(event) => dispatch({ type: "node/edit-text", flowId: activeFlow.id, nodeId: id, text: event.target.value })} placeholder="Write a note to include in a prompt…" />}
      {!uploaded && data.images?.length ? <StoredImages images={data.images} /> : null}
    </div>
    <CardRail
      context={<ContextDisclosure
        count={contextCount}
        meta={generated ? <div className="context-detail-meta"><span>Source prompt</span><strong>{sourcePrompt ? displayGenerationTitle(sourcePrompt.data.title) : batch?.generationNodeId ?? "Prompt"}</strong><span>Following</span><strong>{followingCount}</strong></div> : undefined}
        entries={thread}
      />}
      action={generated
        ? (executionSucceeded ? <button type="button" className="small-button branch-button nodrag nopan" title="Fork from this answer with its context" onClick={sparkChat}><CardIcon name="branch" size={14} /><span>Fork</span></button> : undefined)
        : <button type="button" className="small-button branch-button nodrag nopan" title={uploaded ? "Create a prompt using this file" : "Create a prompt using this note as context"} onClick={sparkChat}><CardIcon name="message" size={14} /><span>Prompt</span></button>}
    />
  </article>;
};
