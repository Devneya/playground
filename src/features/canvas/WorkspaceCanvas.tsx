import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, useReactFlow, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type OnConnect, type OnConnectEnd, type OnMoveEnd, type OnReconnect, type Viewport } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { randomIdFactory } from "../../domain/ids";
import { canAddInputConnection } from "../../domain/graph";
import { LAYOUT } from "../../domain/resultPlacement";
import type { InputEdge, NodeData, PlaygroundEdge, PlaygroundNode } from "../../domain/types";
import { useWorkspace } from "../workspace/useWorkspace";
import { panToRevealCard } from "./camera";
import { TextNode } from "./TextNode";
import { GenerationNode } from "./GenerationNode";
import { ManagedEdge } from "./ManagedEdge";

const nodeTypes = { text: TextNode, generation: GenerationNode };

const edgeTypes = { managed: ManagedEdge };

const EDGE = {
  result: { color: "#5f64d0", dash: undefined as string | undefined },
  input: { color: "#7a838f", dash: undefined as string | undefined },
  branch: { color: "#88977e", dash: "5 4" as string | undefined },
} as const;

const toFlowNode = (node: PlaygroundNode): Node<NodeData> => ({ id: node.id, type: node.data.kind, position: node.position, data: node.data, dragHandle: ".node-header", ...(node.measuredHeight ? { measured: { width: LAYOUT.nodeWidth, height: node.measuredHeight } } : {}) });

const toFlowEdge = (edge: PlaygroundEdge): Edge => {
  const look = EDGE[edge.kind];
  return { id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null, type: "managed", animated: false, selectable: edge.kind === "input", className: `${edge.kind}-edge`, style: { stroke: look.color, strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: look.color }, data: { kind: edge.kind } };
};

export const WorkspaceCanvas = ({ controlsContainer }: { controlsContainer?: HTMLElement | null } = {}) => {
  const { activeFlow, dispatch } = useWorkspace();
  const { screenToFlowPosition } = useReactFlow();
  const [notice, setNotice] = useState<string | null>(null);
  const [interactionVersion, setInteractionVersion] = useState(0);
  const [compactFit, setCompactFit] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 600px)");
    const sync = () => setCompactFit(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const fitViewOptions = { maxZoom: 1, minZoom: compactFit ? 0.75 : 0.2, padding: 0.12 };
  const nodes = useMemo(() => activeFlow.nodes.map(toFlowNode), [activeFlow.nodes]);
  const edges = useMemo(() => [
    ...activeFlow.edges.map(toFlowEdge),
    ...activeFlow.nodes.flatMap(node => {
      const branch = node.data.kind === "generation" ? node.data.branchedFrom : undefined;
      return branch && activeFlow.nodes.some(source => source.id === branch.nodeId) ? [{
      id: `fork-${node.id}`, source: branch.nodeId, target: node.id,
      sourceHandle: "generation-output", targetHandle: "generation-input", type: "managed",
      className: "branch-edge", selectable: false, reconnectable: false,
      style: { stroke: EDGE.branch.color, strokeWidth: 1.5, strokeDasharray: EDGE.branch.dash },
      data: { kind: "branch" },
    }] : [];
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
  const onConnectEnd: OnConnectEnd = (event, connection) => {
    if (connection.isValid || connection.toNode || connection.fromHandle?.type !== "source" || !connection.fromNode) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".react-flow__node") || !target.closest(".react-flow__pane")) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    if (!point) return;
    const position = screenToFlowPosition({ x: point.clientX, y: point.clientY });
    dispatch({ type: "generation/continue", flowId: activeFlow.id, sourceNodeId: connection.fromNode.id, position, sourceHandle: connection.fromHandle.id ?? "text-output", ...(connection.fromHandle.id === "text-left-output" ? { targetHandle: "generation-right-input" } : {}) });
  };
  const onNodeDragStop = (_event: MouseEvent, node: Node) => dispatch({ type: "node/move", flowId: activeFlow.id, nodeId: node.id, position: node.position });
  const onMoveEnd: OnMoveEnd = (_event, viewport) => {
    // Toolbar zoom and automatic reveal also have null events. Save their
    // final camera, so reload restores the view the person actually saw.
    const current = activeFlow.viewport;
    if (current.x === viewport.x && current.y === viewport.y && current.zoom === viewport.zoom) return;
    dispatch({ type: "viewport/update", flowId: activeFlow.id, viewport });
  };

  return <section className="canvas-shell" aria-label="Flow canvas">
    <ReactFlow<Node<NodeData>, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onConnectEnd={onConnectEnd} connectOnClick={false} onReconnect={onReconnect} onNodeDragStop={onNodeDragStop} onMoveStart={event => { if (event) setInteractionVersion(version => version + 1); }} onMoveEnd={onMoveEnd} proOptions={{ hideAttribution: true }} defaultViewport={activeFlow.viewport} fitViewOptions={fitViewOptions} panOnScroll panOnScrollSpeed={1} zoomOnScroll={false} zoomOnDoubleClick={false} zoomActivationKeyCode="Control" nodesFocusable={false} edgesFocusable={false} minZoom={0.2} maxZoom={2} deleteKeyCode={["Backspace", "Delete"]} onlyRenderVisibleElements={false}>
      <Background variant={BackgroundVariant.Dots} gap={32} color="#e5e1d8" />
      {controlsContainer && createPortal(<Controls fitViewOptions={fitViewOptions} />, controlsContainer)}
      <ViewportFitter flowId={activeFlow.id} hasNodes={nodes.length > 0} storedViewport={activeFlow.viewport} />
      <CameraFollow flowId={activeFlow.id} nodes={activeFlow.nodes} edges={activeFlow.edges} interactionVersion={interactionVersion} />
    </ReactFlow>
    {activeFlow.nodes.length === 0 && (
      <div className="canvas-empty" role="status">
        <p>Add a new prompt. Click an answer’s dot to continue, or drag between boxes to connect.</p>
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
// setViewport calls are persisted too, matching the final visible camera.
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


// Reveal new cards and keep space below results as their content grows.
// Center toolbar additions; respect a person's subsequent canvas movement.
export const CameraFollow = ({ flowId, nodes, edges, interactionVersion = 0 }: { flowId: string; nodes: PlaygroundNode[]; edges: PlaygroundEdge[]; interactionVersion?: number }) => {
  const { getViewport, setViewport } = useReactFlow();
  const state = useRef({ flowId: "", ids: new Set<string>() });
  const pending = useRef<string | null>(null);
  const followed = useRef<{ id: string; x: number; y: number; height: number } | null>(null);
  const interaction = useRef(interactionVersion);
  useEffect(() => {
    if (state.current.flowId !== flowId || interaction.current !== interactionVersion) { pending.current = null; followed.current = null; }
    interaction.current = interactionVersion;
    const added = state.current.flowId === flowId ? nodes.filter(node => !state.current.ids.has(node.id)) : [];
    state.current = { flowId, ids: new Set(nodes.map((node) => node.id)) };
    // Bulk imports of notes keep their saved camera; individual additions
    // and generated result batches should reveal their newest card.
    if (added.length && !(added.length > 1 && added.every(node => node.data.kind === "text" && node.data.origin === "manual" && !node.data.source))) pending.current = added.reduce((latest, node) => (node.position.y > latest.position.y || (node.position.y === latest.position.y && node.position.x > latest.position.x) ? node : latest)).id;
    const newlyAdded = pending.current !== null;
    const newest = nodes.find(node => node.id === (pending.current ?? followed.current?.id));
    if (!newest?.measuredHeight) return;
    if (!newlyAdded && followed.current?.height === newest.measuredHeight && followed.current.x === newest.position.x && followed.current.y === newest.position.y) return;
    pending.current = null;
    followed.current = { id: newest.id, x: newest.position.x, y: newest.position.y, height: newest.measuredHeight };
    const wrapper = document.querySelector<HTMLElement>(".canvas-shell .react-flow");
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const viewport = getViewport();
    const toolbarAddition = newlyAdded && !newest.placement && (newest.data.kind === "generation" || newest.data.origin === "manual") && !edges.some(edge => edge.target === newest.id);
    const next = toolbarAddition ? { x: rect.width / 2 - (newest.position.x + LAYOUT.nodeWidth / 2) * viewport.zoom, y: rect.height * 0.4 - (newest.position.y + newest.measuredHeight / 2) * viewport.zoom, zoom: viewport.zoom } : panToRevealCard(viewport, { position: newest.position, height: newest.measuredHeight }, rect);
    if (next) setViewport(next, { duration: 400 });
    const element = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].find((node) => node.dataset.id === newest.id);
    const card = element?.querySelector<HTMLElement>(".spatial-card");
    if (newlyAdded) card?.classList.add("card-arriving");
    if (newlyAdded && card) setTimeout(() => card.classList.remove("card-arriving"), 1600);
    if (newlyAdded && (newest.data.kind === "generation" || (newest.data.kind === "text" && newest.data.origin === "manual"))) {
      element?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    }
  }, [flowId, nodes, edges, interactionVersion, getViewport, setViewport]);
  return null;
};
