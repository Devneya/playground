import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import { emptySurface, evaluateFormula, type Surface, type SurfaceObject, type SurfaceOperation } from "../../domain/surface";
import { randomIdFactory } from "../../domain/ids";
import { useWorkspace } from "../workspace/useWorkspace";
import { ModelPicker } from "../canvas/ModelPicker";
import "./work-surface.css";
import { Scene } from "./Scene";
import { surfacePositions } from "../../domain/surfaceLayout";

const format = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
type ObjectData = { object: SurfaceObject; surface: Surface; change(operations: SurfaceOperation[], gesture?: string): void; edit(object: SurfaceObject): void; recent: boolean };
type WorkNode = Node<ObjectData, "work">;
const WorkObject = ({ data, selected }: NodeProps<WorkNode>) => {
  const object = data.object;
  const gesture = useRef<string | undefined>(undefined);
  const number = object.formula === undefined ? null : evaluateFormula(object.formula, data.surface);
  const series = object.series?.map((item) => ({ ...item, value: evaluateFormula(item.formula, data.surface) })) ?? [];
  const max = Math.max(1, ...series.map((item) => Math.abs(item.value ?? 0)));
  return <section className={`work-object work-${object.kind} tone-${object.color} ${selected ? "work-selected" : ""} ${data.recent ? "work-recent" : ""}`} style={{ width: object.width, minHeight: object.height }} aria-label={object.title} onDoubleClick={(event) => { if (!(event.target instanceof HTMLElement && event.target.closest("input,button"))) data.edit(object); }}>
    <Handle type="target" position={Position.Left} id="in" /><Handle type="source" position={Position.Right} id="out" />
    {object.kind !== "region" && selected && <button className="work-edit nodrag nopan" type="button" aria-label={`Edit ${object.title}`} onClick={() => data.edit(object)}>Edit</button>}
    {object.kind !== "scene" && <h2>{object.title}</h2>}
    {object.kind === "scene" && <Scene object={object} onState={(state) => data.change([{ op: "edit", id: object.id, changes: { state } }])} />}
    {object.kind === "control" && <div className="work-control-value nodrag nopan nowheel"><output>{format(object.value ?? null)} <small>{object.unit}</small></output><input type="range" aria-label={object.title} min={object.min} max={object.max} step={object.step} value={object.value} onFocus={() => { gesture.current = randomIdFactory(); }} onBlur={() => { gesture.current = undefined; }} onChange={(event) => data.change([{ op: "edit", id: object.id, changes: { value: Number(event.target.value) } }], gesture.current)} /></div>}
    {object.kind === "metric" && <output className={`work-metric-value ${number !== null && number < 0 ? "over-limit" : ""}`} aria-label={`${object.title} value`}>{format(number)} <small>{object.unit}</small></output>}
    {object.kind === "bars" && <div className="work-bars" role="img" aria-label={series.map((item) => `${item.label}: ${format(item.value)} ${object.unit ?? ""}`).join(", ")}>{series.map((item, i) => <div className={`work-bar-row tone-${item.color ?? object.color}`} key={i}><div><span>{item.label}</span><strong>{format(item.value)} {object.unit}</strong></div><div className="work-bar-track"><i style={{ width: `${Math.abs(item.value ?? 0) / max * 100}%` }} /></div></div>)}</div>}
    {object.kind !== "scene" && object.text && <p>{object.text}</p>}
  </section>;
};
const nodeTypes = { work: WorkObject };

export const WorkSurface = () => {
  const { activeFlow, dispatch, models, modelsStatus, modelsError, reloadModels, virtualKey, runSurface, cancelRun, activeRunIds, undo } = useWorkspace();
  const { fitView, setViewport, getViewport } = useReactFlow();
  const surface = activeFlow.surface ?? emptySurface();
  const [instruction, setInstruction] = useState("");
  const [chosenModel, setChosenModel] = useState("");
  const model = models.some((item) => item.id === chosenModel) ? chosenModel : models[0]?.id ?? "";
  const [selected, setSelected] = useState<string[]>([]);
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [editing, setEditing] = useState<SurfaceObject | null>(null);
  const [error, setError] = useState("");
  const [pendingRequest, setPendingRequest] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const command = useRef<HTMLTextAreaElement>(null);
  const runId = activeRunIds[activeFlow.id];
  const latest = surface.turns.at(-1);
  const change = (operations: SurfaceOperation[], gesture?: string) => dispatch({ type: "surface/change", flowId: activeFlow.id, base: surface, operations, ...(gesture ? { gesture } : {}) });
  const positions = useMemo(() => surfacePositions(surface.objects, measurements), [surface.objects, measurements]);
  const nodes: WorkNode[] = useMemo(() => surface.objects.map((object) => ({ id: object.id, type: "work", position: dragPositions[object.id] ?? positions[object.id]!, zIndex: object.kind === "region" ? -1 : 1, data: { object, surface, change, edit: setEditing, recent: latest?.changedIds.includes(object.id) ?? false }, selected: selected.includes(object.id), measured: measurements[object.id] ?? { width: object.width, height: object.height }, style: { width: object.width, minHeight: object.height } })), [surface, selected, latest, measurements, dragPositions, positions]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = surface.links.map((link) => ({ id: link.id, source: link.from, target: link.to, sourceHandle: "out", targetHandle: "in", ariaLabel: link.label, markerEnd: { type: MarkerType.ArrowClosed, color: "#70816f" }, style: { stroke: "#70816f", strokeWidth: 1.5 }, labelStyle: { fill: "#435044", fontSize: 13 }, labelBgStyle: { fill: "#f7f7f0" }, labelBgPadding: [6, 4] as [number, number] }));
  const send = (text = instruction) => {
    if (!text.trim() || runId) return;
    setError("");
    try {
      const run = runSurface(text, selected, model);
      setInstruction("");
      setPendingRequest(text);
      setCommandOpen(false);
      void run.completed.catch((failure: unknown) => {
        setCommandOpen(true);
        if (failure && typeof failure === "object" && "kind" in failure && failure.kind === "aborted") { setInstruction((current) => current || text); return; }
        setError(failure instanceof Error ? failure.message : "The change could not be completed.");
        setInstruction((current) => current || text);
      }).finally(() => setPendingRequest(""));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to start."); }
  };
  const removeSelected = () => {
    change(selected.map((id) => ({ op: "remove" as const, id })));
    setSelected([]);
  };
  return <section className="work-surface" aria-label="Shared workspace">
    <ReactFlow<WorkNode> key={activeFlow.id} nodes={nodes} edges={edges} nodeTypes={nodeTypes} defaultViewport={surface.viewport ?? { x: 20, y: 70, zoom: 1 }} minZoom={.35} maxZoom={2} panOnScroll zoomOnScroll={false} zoomOnDoubleClick={false} zoomActivationKeyCode="Control" selectionOnDrag selectionKeyCode="Shift" multiSelectionKeyCode="Shift" deleteKeyCode={null} nodesFocusable edgesFocusable
      onNodesChange={(changes) => {
        for (const item of changes) {
          if (item.type === "dimensions" && item.dimensions) setMeasurements((current) => ({ ...current, [item.id]: item.dimensions! }));
          if (item.type === "position" && item.position) {
            if (item.dragging === undefined) change([{ op: "edit", id: item.id, changes: item.position }]);
            else setDragPositions((current) => ({ ...current, [item.id]: item.position! }));
          }
        }
        const selection = changes.filter((item) => item.type === "select");
        if (selection.length) setSelected((current) => selection.reduce((ids, item) => item.type !== "select" ? ids : item.selected ? [...new Set([...ids, item.id])] : ids.filter((id) => id !== item.id), current));
      }}
      onNodeDoubleClick={(_event, node) => setEditing(node.data.object)}
      onNodeDragStop={(_event, node, dragged) => { change((dragged.length ? dragged : [node]).map((item) => ({ op: "edit", id: item.id, changes: { x: Math.round(item.position.x), y: Math.round(item.position.y) } }))); setDragPositions({}); }}
      onMoveEnd={(event, viewport) => { if (event) dispatch({ type: "surface/viewport", flowId: activeFlow.id, viewport }); }}
      onConnect={(connection) => { if (connection.source && connection.target && connection.source !== connection.target) change([{ op: "connect", link: { id: randomIdFactory(), from: connection.source, to: connection.target, label: "Related" } }]); }}
      onEdgeDoubleClick={(_event, edge) => change([{ op: "disconnect", id: edge.id }])}>
      <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="#cbd2c240" />
      <Controls showInteractive={false} showFitView={false} />
    </ReactFlow>
    <div className="work-view-tools"><button type="button" onClick={() => void fitView({ padding: .15, maxZoom: 1, duration: 250 })}>Overview</button><button type="button" onClick={() => { const view = getViewport(); void setViewport({ ...view, zoom: 1 }, { duration: 200 }); }}>Read at 100%</button><span>Drag to arrange · Double-click to edit</span></div>
    {selected.length > 0 && <div className="work-selection-tools" role="toolbar" aria-label="Selected objects"><span>{selected.length} selected</span>{selected.length === 1 && <button type="button" onClick={() => setEditing(surface.objects.find((object) => object.id === selected[0]) ?? null)}>Edit object</button>}{selected.length === 2 && <button type="button" onClick={() => change([{ op: "connect", link: { id: randomIdFactory(), from: selected[0]!, to: selected[1]!, label: "Related" } }])}>Connect</button>}<button type="button" onClick={() => { setCommandOpen(true); requestAnimationFrame(() => command.current?.focus()); }}>Work on selection</button><button type="button" onClick={removeSelected}>Remove</button><button type="button" onClick={() => setSelected([])}>Clear selection</button></div>}
    {selected.length === 1 && surface.links.some((link) => link.from === selected[0] || link.to === selected[0]) && <aside className="work-relations" aria-label="Selected relationships">{surface.links.filter((link) => link.from === selected[0] || link.to === selected[0]).map((link) => <p key={link.id}><strong>{surface.objects.find((object) => object.id === link.from)?.title}</strong><span>{link.label || "Related to"} →</span><strong>{surface.objects.find((object) => object.id === link.to)?.title}</strong><button type="button" aria-label={`Remove connection ${link.label}`} onClick={() => change([{ op: "disconnect", id: link.id }])}>×</button></p>)}</aside>}
    {!surface.objects.length && <div className="work-invitation"><span>YOU + A MODEL + SOMETHING TO WORK ON</span><h2>Think by changing things.</h2><p>Build a model. Move an idea. Test a possibility.<br />We can both work on what’s here.</p><div>{[
      ["Rebalance an evening", "I have four free hours this evening. Build a working model where I can rebalance rest, friends and learning and see what fits."],
      ["Untangle a question", "meaning of life?"],
      ["Explore a decision", "Help me explore whether to move to a new city. Make a workspace of assumptions, unknowns and options that we can rearrange and revise together, without invented scores."],
    ].map(([label, request]) => <button type="button" key={label} disabled={!model || !virtualKey || !!runId} onClick={() => send(request)}>{label} ↗</button>)}</div></div>}
    <aside className="work-requests" aria-label="Your requests">
      <h2>Your requests</h2>
      {surface.turns.length === 0 && !pendingRequest && <p className="work-requests-empty">Your words stay here. The workspace takes shape beside them.</p>}
      <ol>{surface.turns.map((turn, i) => <li key={turn.id}><span className="work-request-number">{String(i + 1).padStart(2, "0")}</span><p>{turn.instruction}</p><button type="button" aria-label={`Show work for request ${i + 1}`} onClick={() => { const ids = turn.changedIds.filter((id) => surface.objects.some((object) => object.id === id)); setSelected(ids); if (ids.length) void fitView({ nodes: ids.map((id) => ({ id })), padding: .2, maxZoom: 1, duration: 250 }); }}>Locate changes ↗</button></li>)}
      {pendingRequest && <li className="work-request-pending"><span className="work-request-number">{String(surface.turns.length + 1).padStart(2, "0")}</span><p>{pendingRequest}</p><span>In progress</span></li>}</ol>
    </aside>
    <div className={`work-command ${surface.objects.length && !commandOpen ? "work-command-compact" : ""}`}>
      {(surface.notice || error) && <div className="work-last-move work-error" role="alert">{error || surface.notice}</div>}
      {surface.objects.length > 0 && !surface.objects.some((object) => object.kind === "scene" || object.kind === "control") && <div className="work-suggestions"><button type="button" disabled={!!runId || !virtualKey || !model} onClick={() => send("Make the current work directly interactive: choose a form I can manipulate to explore the current question, preserve its meaning, and replace passive prose where appropriate. My latest direction was: " + (latest?.instruction ?? "Explore this workspace"))}>Make interactive ↗</button></div>}
      {surface.actions.length > 0 && <div className="work-suggestions">{surface.actions.map((action, i) => <button type="button" key={i} disabled={!!runId || !virtualKey || !model} onClick={() => send(action.instruction)}>{action.label} ↗</button>)}</div>}
      {(!surface.objects.length || commandOpen) && <form onSubmit={(event) => { event.preventDefault(); send(); }}><textarea ref={command} aria-label="Work together" value={instruction} maxLength={8000} rows={1} placeholder={selected.length ? "What shall we change about the selection?" : surface.objects.length ? "What should change?" : "Give this space a starting point…"} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><button type="submit" disabled={!!runId || !instruction.trim() || !model || !virtualKey}>Make a move ↗</button></form>}
      <div className="work-command-meta"><ModelPicker title="Workspace" modelIds={model ? [model] : []} models={models} status={modelsStatus} error={modelsError} onReload={reloadModels} onSelect={setChosenModel} />{runId ? <span className="work-pending" role="status"><i />Working… <button type="button" onClick={() => cancelRun(runId)}>Stop</button></span> : <span>Interact with the work · changes are saved</span>}{latest && <button type="button" onClick={undo}>Undo change</button>}{surface.objects.length > 0 && <button className="work-change-button" type="button" onClick={() => { setCommandOpen(!commandOpen); requestAnimationFrame(() => command.current?.focus()); }}>{commandOpen ? "Close directions" : "Change the work"}</button>}</div>
    </div>
    {editing && <div className="work-edit-backdrop"><form className="work-edit-dialog" role="dialog" aria-modal="true" aria-label="Edit workspace object" onSubmit={(event) => { event.preventDefault(); change([{ op: "edit", id: editing.id, changes: { title: editing.title, text: editing.text ?? "", ...(editing.kind === "control" ? { value: editing.value! } : {}) } }]); setEditing(null); }}><h2>Edit {editing.kind}</h2><label>Label<input autoFocus value={editing.title} maxLength={80} required onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label><label>Text<textarea rows={4} value={editing.text ?? ""} maxLength={3000} onChange={(event) => setEditing({ ...editing, text: event.target.value })} /></label>{editing.kind === "control" && <label>Value<input type="number" min={editing.min} max={editing.max} step={editing.step} value={editing.value} onChange={(event) => setEditing({ ...editing, value: Number(event.target.value) })} /></label>}<div><button type="button" onClick={() => setEditing(null)}>Cancel</button><button type="submit">Keep changes</button></div></form></div>}
  </section>;
};
