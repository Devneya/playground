import { Background, Controls, MiniMap, ReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type OnConnect, type OnReconnect } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState, type MouseEvent } from "react";
import { randomIdFactory } from "../../domain/ids";
import { canAddInputConnection } from "../../domain/graph";
import type { InputEdge, NodeData, PlaygroundEdge, PlaygroundNode } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";
import { GenerationNode } from "./GenerationNode";
import { TextNode } from "./TextNode";

const nodeTypes = { text: TextNode, generation: GenerationNode };

const toFlowNode = (node: PlaygroundNode): Node<NodeData> => ({ id: node.id, type: node.data.kind, position: node.position, data: node.data });

const toFlowEdge = (edge: PlaygroundEdge): Edge => ({ id: edge.id, source: edge.source, target: edge.target, type: edge.kind === "result" ? "smoothstep" : "default", animated: edge.kind === "result", selectable: edge.kind === "input", className: edge.kind === "result" ? "result-edge" : "input-edge", data: { kind: edge.kind } });

export const WorkspaceCanvas = () => {
  const { activeFlow, dispatch } = useWorkspace();
  const [notice, setNotice] = useState<string | null>(null);
  const nodes = useMemo(() => activeFlow.nodes.map(toFlowNode), [activeFlow.nodes]);
  const edges = useMemo(() => activeFlow.edges.map(toFlowEdge), [activeFlow.edges]);

  const onNodesChange = (changes: NodeChange[]) => {
    changes.forEach((change) => {
      if (change.type === "position" && change.position) dispatch({ type: "node/move", flowId: activeFlow.id, nodeId: change.id, position: change.position });
      if (change.type === "remove") dispatch({ type: "node/delete", flowId: activeFlow.id, nodeId: change.id });
    });
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    changes.forEach((change) => {
      if (change.type === "remove") dispatch({ type: "input/remove", flowId: activeFlow.id, edgeId: change.id });
    });
  };
  const onConnect: OnConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const check = canAddInputConnection(activeFlow, connection.source, connection.target);
    if (!check.allowed) { setNotice(check.reason); return; }
    const edge: InputEdge = { id: randomIdFactory(), kind: "input", source: connection.source, target: connection.target, order: activeFlow.edges.filter((item) => item.kind === "input" && item.target === connection.target).length };
    dispatch({ type: "input/add", flowId: activeFlow.id, edge });
    setNotice(null);
  };
  const onReconnect: OnReconnect = (oldEdge, connection) => {
    if (!connection.source || !connection.target) return;
    dispatch({ type: "input/reconnect", flowId: activeFlow.id, edgeId: oldEdge.id, source: connection.source, target: connection.target });
  };
  const onNodeDragStop = (_event: MouseEvent, node: Node) => dispatch({ type: "node/move", flowId: activeFlow.id, nodeId: node.id, position: node.position });

  return <section className="canvas-shell" aria-label="Flow canvas">
    <ReactFlow<Node<NodeData>, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onReconnect={onReconnect} onNodeDragStop={onNodeDragStop} fitView minZoom={0.2} maxZoom={2} deleteKeyCode={["Backspace", "Delete"]} onlyRenderVisibleElements={false}>
      <Background gap={24} size={1} color="#d9e0ea" />
      <Controls />
      <MiniMap pannable zoomable nodeColor={(node) => node.type === "generation" ? "#7c3aed" : "#0f766e"} />
    </ReactFlow>
    {notice && <div className="canvas-notice" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></div>}
  </section>;
};
