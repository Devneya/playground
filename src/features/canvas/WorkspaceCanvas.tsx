import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type OnConnect, type OnMoveEnd, type OnReconnect, type Viewport } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { randomIdFactory } from "../../domain/ids";
import { canAddInputConnection } from "../../domain/graph";
import { LAYOUT } from "../../domain/resultPlacement";
import type { InputEdge, NodeData, PlaygroundEdge, PlaygroundNode } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";
import { TextNode } from "./TextNode";
import { GenerationNode } from "./GenerationNode";
import { ManagedEdge } from "./ManagedEdge";

const nodeTypes = { text: TextNode, generation: GenerationNode };

const edgeTypes = { managed: ManagedEdge };

const toFlowNode = (node: PlaygroundNode): Node<NodeData> => ({ id: node.id, type: node.data.kind, position: node.position, data: node.data, dragHandle: ".node-header", ...(node.measuredHeight ? { measured: { width: LAYOUT.nodeWidth, height: node.measuredHeight } } : {}) });

const toFlowEdge = (edge: PlaygroundEdge): Edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null, type: "managed", animated: false, selectable: edge.kind === "input", className: edge.kind === "result" ? "result-edge" : "input-edge", markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edge.kind === "result" ? "#a4a9e8" : "#7d899d" }, data: { kind: edge.kind } });

export const WorkspaceCanvas = ({ controlsContainer }: { controlsContainer?: HTMLElement | null } = {}) => {
  const { activeFlow, dispatch } = useWorkspace();
  const [notice, setNotice] = useState<string | null>(null);
  const nodes = useMemo(() => activeFlow.nodes.map(toFlowNode), [activeFlow.nodes]);
  const edges = useMemo(() => [
    ...activeFlow.edges.map(toFlowEdge),
    ...activeFlow.nodes.flatMap((node): Edge[] => {
      const source = node.data.kind === "generation" ? node.data.branchedFrom?.nodeId : undefined;
      return source && activeFlow.nodes.some((parent) => parent.id === source) ? [{ id: `branch-${node.id}`, source, target: node.id, sourceHandle: "generation-output", targetHandle: "generation-input", type: "managed", selectable: false, reconnectable: false, style: { stroke: "#bda24b", strokeDasharray: "4 4" }, data: { kind: "branch" } }] : [];
    }),
  ], [activeFlow.edges, activeFlow.nodes]);

  const onNodesChange = (changes: NodeChange[]) => {
    const sizes = changes.flatMap((change) => change.type === "dimensions" && change.dimensions ? [{ id: change.id, height: change.dimensions.height }] : []);
    if (sizes.length) dispatch({ type: "node/measure", flowId: activeFlow.id, sizes });
    changes.forEach((change) => {
      // Measurement/initialization also emit positions. Only a user's drag
      // may detach a card from automatic chat placement.
      if (change.type === "position" && change.dragging === true && change.position) dispatch({ type: "node/move", flowId: activeFlow.id, nodeId: change.id, position: change.position });
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
    // Record the exact handles the user grabbed so React Flow re-resolves the
    // edge to the same handle on every render (user-drawn edges use the side
    // dots, never the isConnectable={false} flow handles).
    const edge: InputEdge = { id: randomIdFactory(), kind: "input", source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle ?? null, targetHandle: connection.targetHandle ?? null, order: activeFlow.edges.filter((item) => item.kind === "input" && item.target === connection.target).length };
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
    dispatch({ type: "input/reconnect", flowId: activeFlow.id, edgeId: oldEdge.id, source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle ?? null, targetHandle: connection.targetHandle ?? null });
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
    <ReactFlow<Node<NodeData>, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onReconnect={onReconnect} onNodeDragStop={onNodeDragStop} onMoveEnd={onMoveEnd} defaultViewport={activeFlow.viewport} fitViewOptions={{ maxZoom: 1 }} panOnScroll panOnScrollSpeed={1} zoomOnScroll={false} zoomOnDoubleClick={false} zoomActivationKeyCode="Control" nodesFocusable={false} edgesFocusable={false} minZoom={0.2} maxZoom={2} deleteKeyCode={["Backspace", "Delete"]} onlyRenderVisibleElements={false}>
      <Background variant={BackgroundVariant.Dots} gap={32} color="#e5e1d8" />
      {controlsContainer && createPortal(<Controls fitViewOptions={{ maxZoom: 1 }} />, controlsContainer)}
      <ViewportFitter flowId={activeFlow.id} hasNodes={nodes.length > 0} storedViewport={activeFlow.viewport} />
      <CameraFollow flowId={activeFlow.id} nodes={activeFlow.nodes} edges={activeFlow.edges} />
    </ReactFlow>
    {activeFlow.nodes.length === 0 && (
      <div className="canvas-empty" role="status">
        <p>Start a new chat. Reply below, branch to the right, or drag a card wherever you want.</p>
      </div>
    )}
    {notice && <div className="canvas-notice" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></div>}
  </section>;
};



// Applies the initial camera once a flow's nodes are available. The default
// camera (a flow whose stored viewport is still {0,0,1}) is a natural-size,
// zoom-1 view: the first node is horizontally centered and ~80px from the top,
// so a card reads at the same physical size on any monitor. React Flow's
// `fitView` prop only runs on mount, so when nodes load asynchronously the
// initial view is set here instead. A flow that already carries a customized,
// persisted viewport is restored exactly via setViewport, so switching flows
// (which does not remount the canvas) keeps each saved camera. Programmatic
// setViewport calls arrive with a null onMoveEnd event, so they never
// overwrite the stored viewport.
const ViewportFitter = ({ flowId, hasNodes, storedViewport }: { flowId: string; hasNodes: boolean; storedViewport: Viewport }) => {
  const { setViewport } = useReactFlow();
  const { activeFlow } = useWorkspace();
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
      // Natural-size default camera at zoom 1: center the flow's first node
      // horizontally and place it ~80px from the top, independent of monitor
      // size. Node width is measured from the rendered card, with a fixed
      // fallback matching the CSS card width when measurement is not ready.
      const firstNode = activeFlow.nodes[0];
      if (firstNode) {
        const wrapper = document.querySelector<HTMLElement>(".react-flow");
        const containerWidth = wrapper?.clientWidth ?? window.innerWidth;
        const nodeEl = document.querySelector<HTMLElement>(".react-flow__node");
        const nodeWidth = nodeEl?.offsetWidth || LAYOUT.nodeWidth;
        const zoom = Math.min(1, (containerWidth - 32) / nodeWidth);
        const x = containerWidth / 2 - (firstNode.position.x + nodeWidth / 2) * zoom;
        const y = 36 - firstNode.position.y * zoom;
        setViewport({ x, y, zoom }, { duration: 0 });
      }
    }
    fittedFlow.current = flowId;
  }, [flowId, hasNodes, storedViewport, activeFlow, setViewport]);
  return null;
};


// Chat-like follow: when the system appends nodes (a run's answers and their
// continuation prompts, or a fork), pan the camera down just enough to keep
// the newest card in view. Follow newly added results and connected prompts;
// toolbar additions handle their own camera movement.
export const CameraFollow = ({ flowId, nodes, edges }: { flowId: string; nodes: PlaygroundNode[]; edges: PlaygroundEdge[] }) => {
  const { getViewport, setViewport } = useReactFlow();
  const state = useRef({ flowId: "", ids: new Set<string>() });
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (state.current.flowId !== flowId) pending.current = null;
    const added = state.current.flowId === flowId ? nodes.filter((node) => !state.current.ids.has(node.id) && (
      node.placement?.direction === "right" || node.placement?.direction === "above" ||
      (node.data.kind === "text" && node.data.origin === "generated") ||
      (node.data.kind === "generation" && edges.some((edge) => edge.kind === "input" && edge.target === node.id))
    )) : [];
    state.current = { flowId, ids: new Set(nodes.map((node) => node.id)) };
    if (added.length) pending.current = added.reduce((latest, node) => (node.position.y > latest.position.y || (node.position.y === latest.position.y && node.position.x > latest.position.x) ? node : latest)).id;
    const newest = nodes.find((node) => node.id === pending.current);
    if (!newest?.measuredHeight) return;
    pending.current = null;
    const wrapper = document.querySelector<HTMLElement>(".canvas-shell .react-flow");
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const viewport = getViewport();
    const nodeRight = (newest.position.x + LAYOUT.nodeWidth) * viewport.zoom + viewport.x;
    const nodeBottom = (newest.position.y + newest.measuredHeight) * viewport.zoom + viewport.y;
    const visibleBottom = rect.height - 48;
    let panY = 0;
    if (nodeBottom > visibleBottom) panY = nodeBottom - visibleBottom;
    const visibleRight = rect.width - 24;
    let panX = 0;
    if (nodeRight > visibleRight) panX = nodeRight - visibleRight;
    // Earlier branches can be above or left of the current view. For a card
    // larger than the viewport, keep its heading and controls reachable.
    const nodeLeft = newest.position.x * viewport.zoom + viewport.x;
    const nodeTop = newest.position.y * viewport.zoom + viewport.y;
    panX = Math.min(panX, nodeLeft - 24);
    panY = Math.min(panY, nodeTop - 24);
    if (panX !== 0 || panY !== 0) setViewport({ x: viewport.x - panX, y: viewport.y - panY, zoom: viewport.zoom }, { duration: 400 });
    if (newest.data.kind === "generation" || (newest.data.kind === "text" && newest.data.origin === "manual")) {
      const element = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].find((node) => node.dataset.id === newest.id);
      element?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    }
  }, [flowId, nodes, edges, getViewport, setViewport]);
  return null;
};
