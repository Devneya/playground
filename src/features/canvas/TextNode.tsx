import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useState } from "react";
import { isGeneratedTextNode, type GeneratedTextData, type ManualTextData, type PlaygroundNode } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";

type TextNodeData = ManualTextData | GeneratedTextData;
type TextFlowNode = Node<TextNodeData, "text">;

export const TextNode = ({ id, data }: NodeProps<TextFlowNode>) => {
  const { activeFlow, dispatch } = useWorkspace();
  const generated = isGeneratedTextNode({ id, data } as PlaygroundNode);
  const [expanded, setExpanded] = useState(false);
  const makeEditable = () => {
    if (!generated) return;
    dispatch({
      type: "node/make-editable",
      flowId: activeFlow.id,
      node: {
        id: crypto.randomUUID(),
        position: { x: (activeFlow.nodes.find((node) => node.id === id)?.position.x ?? 0) + 40, y: (activeFlow.nodes.find((node) => node.id === id)?.position.y ?? 0) + 40 },
        data: { kind: "text", origin: "manual", title: `${data.title} copy`, text: data.text },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  };
  return <article className={`flow-node text-node ${generated ? "generated-node" : "manual-node"}`}>
    <Handle type="source" position={Position.Right} id="text-output" />
    <header className="node-header">
      <span className="node-kind">Text</span>
      <strong title={data.title}>{data.title}</strong>
      {generated && <span className="origin-chip">result</span>}
    </header>
    {generated ? <div className={`node-content generated-content ${expanded ? "expanded" : ""}`} onClick={() => setExpanded((value) => !value)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setExpanded((value) => !value); }}>
      {data.text || "Waiting for model output…"}
    </div> : <textarea className="node-textarea" aria-label={`${data.title} text`} value={data.text} onChange={(event) => dispatch({ type: "node/edit-text", flowId: activeFlow.id, nodeId: id, text: event.target.value })} placeholder="Write text to pass into a Generation node…" />}
    <footer className="node-footer">
      <span className="muted">{data.text.length.toLocaleString()} chars</span>
      {generated && <button type="button" className="small-button" onClick={makeEditable}>Make editable</button>}
    </footer>
  </article>;
};
