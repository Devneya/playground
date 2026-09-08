import { lazy, Suspense, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { AuthProvider } from "../auth/AuthProvider";
import type { ComponentType, PropsWithChildren } from "react";
import { AuthScreen } from "../auth/AuthScreen";
import { PasswordRecoveryScreen } from "../auth/PasswordRecoveryScreen";
import { useAuth } from "../auth/useAuth";
const WorkspaceCanvas = lazy(() => import("../features/canvas/WorkspaceCanvas").then(({ WorkspaceCanvas: component }) => ({ default: component })));
import { useWorkspace } from "../features/workspace/useWorkspace";
import { WorkspaceProvider } from "../features/workspace/WorkspaceContext";
import { randomIdFactory, systemClock } from "../domain/ids";
import { LAYOUT } from "../domain/resultPlacement";
import { CardIcon } from "../features/canvas/CardIcon";
import "./styles.css";

const LOCAL_NOTICE = "Stored only in this browser—not backed up or synchronized. Clearing browser data may remove this workspace. Export it to keep a portable copy.";

const AuthGate = () => {
  const { initializing, user, recovery } = useAuth();
  if (initializing) return <main className="loading-screen"><div className="loading-mark">Loading Devneya Playground…</div></main>;
  if (recovery) return <PasswordRecoveryScreen />;
  if (!user) return <AuthScreen />;
  return <WorkspaceProvider key={user.id}><WorkspaceScreen /></WorkspaceProvider>;
};

const WorkspaceScreen = () => {
  const { user, signOut } = useAuth();
  const { workspace, activeFlow, loading, saving, lastSavedAt, error, storageWarning, modelsStatus, keyStatus, keyError, createFlow, duplicateFlow, deleteFlow, activateFlow, renameFlow, addNode, exportWorkspace, importWorkspace, clearLocalWorkspace, canUndo, canRedo, undo, redo } = useWorkspace();
  const importRef = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition, getViewport, setViewport } = useReactFlow();
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [controlsContainer, setControlsContainer] = useState<HTMLDivElement | null>(null);

  // New nodes appear where the user is looking: flow coordinates of the
  // current viewport center, then walked down row by row until the full
  // card rectangle is clear of existing nodes — a free center point is not
  // enough when the canvas is dense. The camera then glides so the node
  // sits slightly above center, like a chat input.
  const placeInViewport = () => {
    const rect = document.querySelector(".canvas-shell .react-flow")?.getBoundingClientRect();
    const screen = {
      x: (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) * 0.42,
    };
    const position = screenToFlowPosition(screen);
    const { zoom } = getViewport();
    position.x -= LAYOUT.nodeWidth / 2;
    position.y -= 95;
    const overlapsAny = (candidate: { x: number; y: number }) =>
      activeFlow.nodes.some((node) =>
        candidate.x < node.position.x + LAYOUT.nodeWidth &&
        candidate.x + LAYOUT.nodeWidth > node.position.x &&
        candidate.y < node.position.y + LAYOUT.nodeHeight &&
        candidate.y + LAYOUT.nodeHeight > node.position.y);
    while (overlapsAny(position)) position.y += LAYOUT.nodeHeight + 80;
    return { position, viewport: { x: screen.x - (rect?.left ?? 0) - (position.x + LAYOUT.nodeWidth / 2) * zoom, y: screen.y - (rect?.top ?? 0) - (position.y + 95) * zoom, zoom } };
  };
  const addNewText = () => {
    const now = systemClock.now().toISOString();
    const index = activeFlow.nodes.length + 1;
    const { position, viewport } = placeInViewport();
    addNode({ id: randomIdFactory(), position, createdAt: now, updatedAt: now, data: { kind: "text", origin: "manual", title: `Text ${index}`, text: "" } });
    setViewport(viewport, { duration: 300 });
  };
  const addNewGeneration = () => {
    const now = systemClock.now().toISOString();
    const index = activeFlow.nodes.length + 1;
    const { position, viewport } = placeInViewport();
    addNode({ id: randomIdFactory(), position, createdAt: now, updatedAt: now, data: { kind: "generation", title: `Generation ${index}`, instruction: "", modelIds: [] } });
    setViewport(viewport, { duration: 300 });
  };

  const beginRename = (flowId: string, name: string) => { setRenameId(flowId); setRenameValue(name); };
  const commitRename = () => {
    if (!renameId) return;
    const next = renameValue.trim();
    if (next) renameFlow(renameId, next);
    setRenameId(null);
  };
  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try { await importWorkspace(file); } catch (importFailure) { setImportError(importFailure instanceof Error ? importFailure.message : "Unable to import this workspace."); }
    if (importRef.current) importRef.current.value = "";
  };

  const [canvasesOpen, setCanvasesOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  return <main className="app-shell canvas-first spatial-chat">
    {loading ? <div className="canvas-loading">Loading this browser's workspace…</div> : <>
      <div className="canvas-topbar"><span className="brand-dot" /><h1 className="flow-title">{activeFlow.name}</h1><span className={`save-status ${saving ? "saving" : ""}`}>{saving ? "Saving locally…" : lastSavedAt ? "Saved locally" : "Not saved yet"}</span>{modelsStatus === "ready" ? <span className="catalog-dot live" role="img" title="Live model catalog" aria-label="Catalog ready" /> : <span className="catalog-status">{modelsStatus === "loading" ? "Loading models…" : "Model catalog unavailable"}</span>}</div>
      <div className="canvas-account">
        <button type="button" className="avatar-button" aria-label="Account" aria-expanded={accountOpen} onClick={() => { setAccountOpen((value) => !value); setCanvasesOpen(false); }}>{(user?.email ?? "?").slice(0, 1).toUpperCase()}</button>
        {accountOpen && <>
          <button type="button" className="popover-backdrop" aria-label="Close account" onClick={() => setAccountOpen(false)} />
          <div className="account-popover" role="dialog" aria-label="Account">
            <div className="account-email" title={user?.email}>{user?.email}</div>
            <p className="account-notice">{LOCAL_NOTICE}</p>
            <button type="button" className="text-button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </>}
      </div>
      <div className="canvas-toolbar-floating" role="toolbar" aria-label="Canvas">
        <button type="button" aria-label="+ Text" onClick={addNewText}><CardIcon name="note" size={17} /><span className="tool-caption">Note</span></button>
        <button type="button" aria-label="+ Prompt" onClick={addNewGeneration}><CardIcon name="message" size={17} /><span className="tool-caption">New chat</span></button>
        <button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo last change"><CardIcon name="undo" size={17} /><span className="tool-caption">Undo</span></button>
        <button type="button" onClick={redo} disabled={!canRedo} aria-label="Redo last change"><CardIcon name="redo" size={17} /><span className="tool-caption">Redo</span></button>
        <button type="button" aria-label="Canvases" aria-expanded={canvasesOpen} onClick={() => { setCanvasesOpen((value) => !value); setAccountOpen(false); }}><CardIcon name="library" size={17} /><span className="tool-caption">Library</span></button>
        <button type="button" aria-label="Export workspace" onClick={exportWorkspace}><CardIcon name="download" size={17} /><span className="tool-caption">Export</span></button>
        <button type="button" aria-label="Import workspace" onClick={() => importRef.current?.click()}><CardIcon name="upload" size={17} /><span className="tool-caption">Import</span></button>
        <input ref={importRef} className="visually-hidden" type="file" aria-label="Workspace JSON file" accept="application/json,.json" onChange={(event) => void handleImport(event.target.files?.[0])} />
        <button type="button" className="danger-link" aria-label="Clear local workspace" onClick={() => { if (window.confirm("Clear this browser's saved workspace? Export first if you need a copy.")) void clearLocalWorkspace(); }}><CardIcon name="trash" size={17} /><span className="tool-caption">Clear</span></button>
        <div ref={setControlsContainer} className="canvas-navigation" aria-label="Canvas navigation" role="group" />
      </div>
      {canvasesOpen && <>
        <button type="button" className="popover-backdrop" aria-label="Close canvases" onClick={() => setCanvasesOpen(false)} />
        <div className="flows-popover" role="dialog" aria-label="Canvases">
          <div className="flows-popover-head"><span>Flows</span><button type="button" className="primary-button compact-button" onClick={createFlow}>New flow</button></div>
          {importError && <p className="form-error">{importError}</p>}
          <div className="flow-list">{workspace.flows.map((flow) => <div className={`flow-list-item ${flow.id === activeFlow.id ? "active" : ""}`} key={flow.id}>
            {renameId === flow.id ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={commitRename} onKeyDown={(event) => { if (event.key === "Enter") commitRename(); if (event.key === "Escape") setRenameId(null); }} /> : <button type="button" className="flow-select" onClick={() => activateFlow(flow.id)}><span>{flow.name}</span><small>{flow.nodes.length} nodes</small></button>}
            {renameId !== flow.id && <div className="flow-actions"><button type="button" className="icon-button" aria-label={`Rename ${flow.name}`} onClick={() => beginRename(flow.id, flow.name)}>✎</button><button type="button" className="icon-button" aria-label={`Duplicate ${flow.name}`} onClick={() => duplicateFlow(flow.id)}>⧉</button><button type="button" className="icon-button" aria-label={`Delete ${flow.name}`} onClick={() => deleteFlow(flow.id)}>×</button></div>}
          </div>)}</div>
        </div>
      </>}
      {(error || keyStatus === "error") && <div className="inline-alert overlay-alert" role="alert">{error || keyError}</div>}
      {storageWarning && <div className="inline-alert overlay-alert" role="status">{storageWarning}</div>}
      {importError && <div className="inline-alert overlay-alert" role="alert">{importError}</div>}
      <Suspense fallback={<div className="canvas-loading">Opening your conversation…</div>}>
        <WorkspaceCanvas controlsContainer={controlsContainer} />
      </Suspense>
    </>}
  </main>;
};

type AuthBoundaryComponent = ComponentType<PropsWithChildren>;

export const App = ({ authBoundary: AuthBoundary = AuthProvider }: { authBoundary?: AuthBoundaryComponent } = {}) => <AuthBoundary><ReactFlowProvider><AuthGate /></ReactFlowProvider></AuthBoundary>;
