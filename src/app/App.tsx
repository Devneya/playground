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
import type { PlaygroundNode } from "../domain/types";
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

  const addNewNode = (kind: "text" | "generation") => {
    const now = systemClock.now().toISOString();
    const index = activeFlow.nodes.length + 1;
    const x = Math.max(80, ...activeFlow.nodes.map((node) => node.position.x)) + 380;
    const node: PlaygroundNode = kind === "text" ? {
      id: randomIdFactory(), position: { x, y: 120 }, createdAt: now, updatedAt: now,
      data: { kind: "text", origin: "manual", title: `Text ${index}`, text: "" },
    } : {
      id: randomIdFactory(), position: { x, y: 120 }, createdAt: now, updatedAt: now,
      data: { kind: "generation", title: `Generation ${index}`, instruction: "", modelIds: [] },
    };
    addNode(node);
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

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-lockup"><span className="brand-dot" /> <span>Devneya <strong>Playground</strong></span></div>
      <div className="topbar-actions"><span className="user-label" title={user?.email}>{user?.email}</span><span className={`save-status ${saving ? "saving" : ""}`}>{saving ? "Saving locally…" : lastSavedAt ? "Saved locally" : "Not saved yet"}</span><button type="button" className="text-button" onClick={() => void signOut()}>Sign out</button></div>
    </header>
    <div className="workspace-layout">
      <aside className="sidebar">
        <div className="sidebar-heading"><div><p className="eyebrow">Workspace</p><h2>Flows</h2></div><button type="button" className="primary-button compact-button" onClick={createFlow}>New flow</button></div>
        <div className="flow-list">{workspace.flows.map((flow) => <div className={`flow-list-item ${flow.id === activeFlow.id ? "active" : ""}`} key={flow.id}>
          {renameId === flow.id ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={commitRename} onKeyDown={(event) => { if (event.key === "Enter") commitRename(); if (event.key === "Escape") setRenameId(null); }} /> : <button type="button" className="flow-select" onClick={() => activateFlow(flow.id)}><span>{flow.name}</span><small>{flow.nodes.length} nodes</small></button>}
          {renameId !== flow.id && <div className="flow-actions"><button type="button" className="icon-button" aria-label={`Rename ${flow.name}`} onClick={() => beginRename(flow.id, flow.name)}>✎</button><button type="button" className="icon-button" aria-label={`Duplicate ${flow.name}`} onClick={() => duplicateFlow(flow.id)}>⧉</button><button type="button" className="icon-button" aria-label={`Delete ${flow.name}`} onClick={() => deleteFlow(flow.id)}>×</button></div>}
        </div>)}</div>
        <div className="sidebar-tools"><button type="button" onClick={exportWorkspace}>Export workspace</button><button type="button" onClick={() => importRef.current?.click()}>Import workspace</button><input ref={importRef} className="visually-hidden" type="file" aria-label="Workspace JSON file" accept="application/json,.json" onChange={(event) => void handleImport(event.target.files?.[0])} />{importError && <p className="form-error">{importError}</p>}<button type="button" className="danger-link" onClick={() => { if (window.confirm("Clear this browser's saved workspace? Export first if you need a copy.")) void clearLocalWorkspace(); }}>Clear local workspace</button></div>
      </aside>
      <section className="workspace-main">
        <div className="canvas-toolbar"><div><p className="eyebrow">{activeFlow.name}</p><h1>Compose a flow</h1></div><div className="canvas-actions"><button type="button" onClick={() => addNewNode("text")}>+ Text</button><button type="button" onClick={() => addNewNode("generation")}>+ Generation</button><button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo last change">Undo</button><button type="button" onClick={redo} disabled={!canRedo} aria-label="Redo last change">Redo</button><span className="catalog-status">{modelsStatus === "ready" ? "Live model catalog" : modelsStatus === "loading" ? "Loading models…" : "Model catalog unavailable"}</span></div></div>
        <div className="workspace-notice">{LOCAL_NOTICE}</div>
        {(error || keyStatus === "error") && <div className="inline-alert" role="alert">{error || keyError}</div>}
        {storageWarning && <div className="inline-alert" role="status">{storageWarning}</div>}
        {loading ? <div className="canvas-loading">Loading this browser's workspace…</div> : <Suspense fallback={<div className="canvas-loading">Loading the flow editor…</div>}><WorkspaceCanvas /></Suspense>}
      </section>
    </div>
  </main>;
};

type AuthBoundaryComponent = ComponentType<PropsWithChildren>;

export const App = ({ authBoundary: AuthBoundary = AuthProvider }: { authBoundary?: AuthBoundaryComponent } = {}) => <AuthBoundary><AuthGate /></AuthBoundary>;
