import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useState } from "react";
import type { ContentData } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";

type ContentFlowNode = Node<ContentData, "content">;

export const ContentNode = ({ id, data }: NodeProps<ContentFlowNode>) => {
  const { activeFlow, dispatch } = useWorkspace();
  const generated = data.origin === "generated";
  const [expanded, setExpanded] = useState(false);
  const useAsPrompt = () => {
    const source = activeFlow.nodes.find((node) => node.id === id);
    const position = source?.position ?? { x: 0, y: 0 };
    dispatch({
      type: "node/make-editable",
      flowId: activeFlow.id,
      node: {
        id: crypto.randomUUID(),
        position: { x: position.x + 40, y: position.y + 40 },
        data: { kind: "prompt", title: `${data.title} copy`, prompt: data.text, modelIds: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  };
  return <article className={`flow-node content-node ${generated ? "generated-node" : "manual-node"}`}>
    <Handle type="target" position={Position.Left} id="content-input" />
    <Handle type="source" position={Position.Right} id="content-output" />
    <header className="node-header">
      <strong title={data.title}>{data.title}</strong>
      {generated && <span className="origin-chip">result</span>}
      <span className="node-header-spacer" />
      <button type="button" className="icon-button" aria-label={`Delete ${data.title}`} onClick={() => dispatch({ type: "node/delete", flowId: activeFlow.id, nodeId: id })}>×</button>
    </header>
    {generated ? <div className={`node-content generated-content ${expanded ? "expanded" : ""}`} onClick={() => setExpanded((value) => !value)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setExpanded((value) => !value); }}>
      {data.text || "Waiting for model output…"}
    </div> : <div className="node-content">{data.text}</div>}
    <div className="node-gent-action"><button type="button" className="small-button" onClick={useAsPrompt}>Use as prompt</button></div>
  </article>;
};

