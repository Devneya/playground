import { lazy, Suspense, useRef, useState } from "react";
import { AuthProvider } from "../auth/AuthProvider";
import type { ComponentType, PropsWithChildren } from "react";
import { AuthScreen } from "../auth/AuthScreen";
import { PasswordRecoveryScreen } from "../auth/PasswordRecoveryScreen";
import { useAuth } from "../auth/useAuth";
const WorkspaceCanvas = lazy(() => import("../features/canvas/WorkspaceCanvas").then(({ WorkspaceCanvas: component }) => ({ default: component })));
import { useWorkspace } from "../features/workspace/useWorkspace";
import { WorkspaceProvider } from "../features/workspace/WorkspaceContext";
import { randomIdFactory, systemClock } from "../domain/ids";
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
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const addNewText = () => {
    const now = systemClock.now().toISOString();
    const index = activeFlow.nodes.length + 1;
    const x = Math.max(80, ...activeFlow.nodes.map((node) => node.position.x)) + 380;
    addNode({ id: randomIdFactory(), position: { x, y: 120 }, createdAt: now, updatedAt: now, data: { kind: "text", origin: "manual", title: `Text ${index}`, text: "" } });
  };
  const addNewGeneration = () => {
    const now = systemClock.now().toISOString();
    const index = activeFlow.nodes.length + 1;
    const x = Math.max(80, ...activeFlow.nodes.map((node) => node.position.x)) + 380;
    addNode({ id: randomIdFactory(), position: { x, y: 120 }, createdAt: now, updatedAt: now, data: { kind: "generation", title: `Generation ${index}`, instruction: "", modelIds: [] } });
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
  return <main className="app-shell canvas-first">
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
        <button type="button" aria-label="+ Text" onClick={addNewText}><span className="tool-glyph" aria-hidden="true">✦</span><span className="tool-caption">Text</span></button>
        <button type="button" aria-label="+ Generation" onClick={addNewGeneration}><span className="tool-glyph" aria-hidden="true">✷</span><span className="tool-caption">Generation</span></button>
        <button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo last change"><span className="tool-glyph" aria-hidden="true">↶</span><span className="tool-caption">Undo</span></button>
        <button type="button" onClick={redo} disabled={!canRedo} aria-label="Redo last change"><span className="tool-glyph" aria-hidden="true">↷</span><span className="tool-caption">Redo</span></button>
        <button type="button" aria-label="Canvases" aria-expanded={canvasesOpen} onClick={() => { setCanvasesOpen((value) => !value); setAccountOpen(false); }}><span className="tool-glyph" aria-hidden="true">▤</span><span className="tool-caption">Canvases</span></button>
        <button type="button" aria-label="Export workspace" onClick={exportWorkspace}><span className="tool-glyph" aria-hidden="true">⤓</span><span className="tool-caption">Export</span></button>
        <button type="button" aria-label="Import workspace" onClick={() => importRef.current?.click()}><span className="tool-glyph" aria-hidden="true">⤒</span><span className="tool-caption">Import</span></button>
        <input ref={importRef} className="visually-hidden" type="file" aria-label="Workspace JSON file" accept="application/json,.json" onChange={(event) => void handleImport(event.target.files?.[0])} />
        <button type="button" className="danger-link" aria-label="Clear local workspace" onClick={() => { if (window.confirm("Clear this browser's saved workspace? Export first if you need a copy.")) void clearLocalWorkspace(); }}><span className="tool-glyph" aria-hidden="true">🗑</span><span className="tool-caption">Clear</span></button>
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
      <Suspense fallback={<div className="canvas-loading">Loading the flow editor…</div>}><WorkspaceCanvas /></Suspense>
    </>}
  </main>;
};

type AuthBoundaryComponent = ComponentType<PropsWithChildren>;

export const App = ({ authBoundary: AuthBoundary = AuthProvider }: { authBoundary?: AuthBoundaryComponent } = {}) => <AuthBoundary><AuthGate /></AuthBoundary>;
