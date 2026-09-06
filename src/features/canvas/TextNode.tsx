import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useState } from "react";
import type { TextNodeData } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";

type TextFlowNode = Node<TextNodeData, "text">;

export const TextNode = ({ id, data }: NodeProps<TextFlowNode>) => {
  const { activeFlow, dispatch } = useWorkspace();
  const generated = data.origin === "generated";
  const [expanded, setExpanded] = useState(false);
  const makeEditable = () => {
    const source = activeFlow.nodes.find((node) => node.id === id);
    const position = source?.position ?? { x: 0, y: 0 };
    const now = new Date().toISOString();
    dispatch({
      type: "node/make-editable",
      flowId: activeFlow.id,
      node: {
        id: crypto.randomUUID(),
        position: { x: position.x + 40, y: position.y + 40 },
        data: { kind: "text", origin: "manual", title: `${data.title} copy`, text: data.text },
        createdAt: now,
        updatedAt: now,
      },
    });
  };
  return <article className={`flow-node text-node ${generated ? "generated-node" : "manual-node"}`}>
    <Handle type="target" position={Position.Left} id="text-input" isConnectable={false} />
    <Handle type="source" position={Position.Right} id="text-output" />
    <header className="node-header">
      <span className="node-kind text-kind">Text</span>
      <strong title={data.title}>{data.title}</strong>
      {generated && <span className="origin-chip">result</span>}
      <span className="node-header-spacer" />
      <button type="button" className="icon-button" aria-label={`Delete ${data.title}`} onClick={() => dispatch({ type: "node/delete", flowId: activeFlow.id, nodeId: id })}>×</button>
    </header>
    {generated ? <div className={`node-content generated-content ${expanded ? "expanded" : ""}`} onClick={() => setExpanded((value) => !value)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setExpanded((value) => !value); }}>
      {data.text || "Waiting for model output…"}
    </div> : <textarea className="node-textarea manual-textarea" aria-label={`${data.title} text`} value={data.text} onChange={(event) => dispatch({ type: "node/edit-text", flowId: activeFlow.id, nodeId: id, text: event.target.value })} placeholder="Write text to pass into a Generation node…" />}
    {generated && <div className="node-gent-action"><button type="button" className="small-button" onClick={makeEditable}>Make editable</button></div>}
  </article>;
};
