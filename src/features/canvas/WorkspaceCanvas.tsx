import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type OnConnect, type OnMoveEnd, type OnReconnect, type Viewport } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { randomIdFactory } from "../../domain/ids";
import { canAddInputConnection } from "../../domain/graph";
import type { InputEdge, NodeData, PlaygroundEdge, PlaygroundNode } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";
import { TextNode } from "./TextNode";
import { GenerationNode } from "./GenerationNode";
import { ManagedEdge } from "./ManagedEdge";

const nodeTypes = { text: TextNode, generation: GenerationNode };

const edgeTypes = { managed: ManagedEdge };

const toFlowNode = (node: PlaygroundNode): Node<NodeData> => ({ id: node.id, type: node.data.kind, position: node.position, data: node.data });

const toFlowEdge = (edge: PlaygroundEdge): Edge => ({ id: edge.id, source: edge.source, target: edge.target, type: "managed", animated: false, selectable: edge.kind === "input", className: edge.kind === "result" ? "result-edge" : "input-edge", markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edge.kind === "result" ? "#a4a9e8" : "#7d899d" }, data: { kind: edge.kind } });

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
    const check = canAddInputConnection(activeFlow, connection.source, connection.target, oldEdge.id);
    if (!check.allowed) {
      setNotice(check.reason);
      return;
    }
    dispatch({ type: "input/reconnect", flowId: activeFlow.id, edgeId: oldEdge.id, source: connection.source, target: connection.target });
    setNotice(null);
  };
  const onNodeDragStop = (_event: MouseEvent, node: Node) => dispatch({ type: "node/move", flowId: activeFlow.id, nodeId: node.id, position: node.position });
  const onMoveEnd: OnMoveEnd = (event, viewport) => {
    // Programmatic viewport changes (the fitView/setViewport applied when a
    // flow is restored or switched) arrive with a null event; only persist a
    // user-initiated pan/zoom so we never overwrite the stored camera.
    if (event === null) return;
    const current = activeFlow.viewport;
    if (current.x === viewport.x && current.y === viewport.y && current.zoom === viewport.zoom) return;
    dispatch({ type: "viewport/update", flowId: activeFlow.id, viewport });
  };

  return <section className="canvas-shell" aria-label="Flow canvas">
    <ReactFlow<Node<NodeData>, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onReconnect={onReconnect} onNodeDragStop={onNodeDragStop} onMoveEnd={onMoveEnd} fitView fitViewOptions={{ maxZoom: 0.5, padding: 0.3 }} defaultViewport={activeFlow.viewport} nodesFocusable={false} edgesFocusable={false} minZoom={0.2} maxZoom={2} deleteKeyCode={["Backspace", "Delete"]} onlyRenderVisibleElements={false}>
      <Background variant={BackgroundVariant.Lines} gap={30} color="#e2e2e2" />
      <Controls position="bottom-left" />
      <ViewportFitter flowId={activeFlow.id} hasNodes={nodes.length > 0} storedViewport={activeFlow.viewport} />
    </ReactFlow>
    {notice && <div className="canvas-notice" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></div>}
  </section>;
};



// Applies the initial camera once a flow's nodes are available. React Flow's
// `fitView` prop only runs on mount, so when nodes are loaded asynchronously
// (after mount) the initial fit is missed; this effect re-applies it. When a
// flow already carries a customized, persisted viewport it is restored exactly
// via setViewport instead of refitted, so switching flows keeps each saved
// camera. Programmatic setViewport/fitView calls arrive with a null onMoveEnd
// event, so they never overwrite the stored viewport.
const ViewportFitter = ({ flowId, hasNodes, storedViewport }: { flowId: string; hasNodes: boolean; storedViewport: Viewport }) => {
  const { fitView, setViewport } = useReactFlow();
  const fittedFlow = useRef<string | null>(null);
  useEffect(() => {
    if (!hasNodes || fittedFlow.current === flowId) return;
    const hasStoredViewport = !(storedViewport.x === 0 && storedViewport.y === 0 && storedViewport.zoom === 1);
    if (hasStoredViewport) {
      // A previously persisted, non-default camera exists: restore it exactly
      // instead of refitting, so switching flows (which does not remount the
      // canvas) preserves each flow's saved view.
      setViewport(storedViewport, { duration: 0 });
    } else {
      fitView({ maxZoom: 0.5, padding: 0.3 });
    }
    fittedFlow.current = flowId;
  }, [flowId, hasNodes, storedViewport, fitView, setViewport]);
  return null;
};
