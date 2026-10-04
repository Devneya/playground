import { lazy, Suspense, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
const AuthProvider = lazy(() => import("../auth/AuthProvider").then(({ AuthProvider }) => ({ default: AuthProvider })));
import type { ComponentType, PropsWithChildren } from "react";
import { AuthScreen } from "../auth/AuthScreen";
import { PasswordRecoveryScreen } from "../auth/PasswordRecoveryScreen";
import { useAuth } from "../auth/useAuth";
const WorkspaceCanvas = lazy(() => import("../features/canvas/WorkspaceCanvas").then(({ WorkspaceCanvas: component }) => ({ default: component })));
import { useWorkspace } from "../features/workspace/useWorkspace";
import { WorkspaceProvider } from "../features/workspace/WorkspaceContext";
import { nextGenerationIndex, nextManualTextIndex } from "../domain/graph";
import { randomIdFactory, systemClock } from "../domain/ids";
import { LAYOUT } from "../domain/resultPlacement";
import { findFreePosition } from "../domain/freePosition";
import { cardHeight, cardWidth } from "../domain/spatialLayout";
import { CardIcon } from "../features/canvas/CardIcon";
import { config } from "../config";
import { readCanvasFile } from "../features/canvas/readCanvasFile";
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
  const uploadRef = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [controlsContainer, setControlsContainer] = useState<HTMLDivElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // Find the closest empty card rectangle to the visible center. The canvas
  // reveals and focuses the new card once its actual size is measured.
  const placeInViewport = () => {
    const rect = document.querySelector(".canvas-shell .react-flow")?.getBoundingClientRect();
    const screen = {
      x: (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) * 0.42,
    };
    const position = screenToFlowPosition(screen);
    position.x -= LAYOUT.nodeWidth / 2;
    position.y -= 95;
    return findFreePosition(position, { width: LAYOUT.nodeWidth, height: LAYOUT.nodeHeight }, activeFlow.nodes.map(node => ({ ...node.position, width: cardWidth(node), height: cardHeight(node) })));
  };
  const addNewText = () => {
    const now = systemClock.now().toISOString();
    const position = placeInViewport();
    addNode({ id: randomIdFactory(), position, createdAt: now, updatedAt: now, data: { kind: "text", origin: "manual", title: `Note ${nextManualTextIndex(activeFlow)}`, text: "" } });
  };
  const addNewGeneration = () => {
    const now = systemClock.now().toISOString();
    const position = placeInViewport();
    addNode({ id: randomIdFactory(), position, createdAt: now, updatedAt: now, data: { kind: "generation", title: `Generation ${nextGenerationIndex(activeFlow)}`, instruction: "", modelIds: [] } });
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
  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      const data = await readCanvasFile(file);
      const position = placeInViewport();
      const now = systemClock.now().toISOString();
      addNode({ id: randomIdFactory(), position, createdAt: now, updatedAt: now, data });
    } catch (failure) { setImportError(failure instanceof Error ? failure.message : "Unable to open this file."); }
    if (uploadRef.current) uploadRef.current.value = "";
  };

  const [canvasesOpen, setCanvasesOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  return <main className="app-shell canvas-first spatial-chat">
    {loading ? <div className="canvas-loading">Loading this browser's workspace…</div> : <>
      <div className="canvas-topbar"><span className="brand-dot" /><span className="brand-wordmark">devneya<span> / </span></span><h1 className="flow-title">{activeFlow.name}</h1><span className={`save-status ${saving ? "saving" : ""}`}>{saving ? "Saving locally…" : lastSavedAt ? "Saved locally" : "Not saved yet"}</span>{modelsStatus === "ready" ? <span className="catalog-dot live" role="img" title="Live model catalog" aria-label="Catalog ready" /> : <span className="catalog-status">{modelsStatus === "loading" ? "Loading models…" : "Model catalog unavailable"}</span>}</div>
      <div className="canvas-account">
        <button type="button" className="avatar-button" aria-label="Account" aria-expanded={accountOpen} onClick={() => { setAccountOpen((value) => !value); setCanvasesOpen(false); }}>{(user?.email ?? "?").slice(0, 1).toUpperCase()}</button>
        {accountOpen && <>
          <button type="button" className="popover-backdrop" aria-label="Close account" onClick={() => setAccountOpen(false)} />
          <div className="account-popover" role="dialog" aria-label="Account">
            <div className="account-email" title={user?.email}>{user?.email}</div>
            <p className="account-notice">{LOCAL_NOTICE}</p>
            <nav className="account-links" aria-label="Account links">
              {config.useLocalCodex ? <p className="local-connection-note">Using your local Codex sign-in.<br />Fast requested · effort set per prompt<br />Credentials stay on this computer.</p> : <><a className="text-button" href={`${config.appOrigin}/account`} target="_blank" rel="noreferrer">Profile</a>
              <a className="text-button" href={`${config.appOrigin}/`} target="_blank" rel="noreferrer">Dashboard</a>
              <button type="button" className="text-button" onClick={() => void signOut()}>Sign out</button></>}
            </nav>
          </div>
        </>}
      </div>
      <div className="canvas-toolbar-floating" role="toolbar" aria-label="Canvas">
        <button type="button" aria-label="+ Prompt" onClick={addNewGeneration}><CardIcon name="message" size={17} /><span className="tool-caption">New prompt</span></button>
        <button type="button" aria-label="Upload file to canvas" onClick={() => uploadRef.current?.click()}><CardIcon name="upload" size={17} /><span className="tool-caption">Upload</span></button>
        <button type="button" aria-label="+ Text" onClick={addNewText}><CardIcon name="note" size={17} /><span className="tool-caption">Note</span></button>
        <input ref={uploadRef} className="visually-hidden" type="file" aria-label="Canvas file" accept="text/*,.txt,.md,.csv,.json,.js,.ts,.tsx,.py,.rs,.go,.c,.cpp,.h,.yaml,.yml,.toml,.log,.svg,image/svg+xml,image/png,image/jpeg,image/webp,application/pdf" onChange={event => void uploadFile(event.target.files?.[0])} />
        <button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo last change"><CardIcon name="undo" size={17} /><span className="tool-caption">Undo</span></button>
        <button type="button" onClick={redo} disabled={!canRedo} aria-label="Redo last change"><CardIcon name="redo" size={17} /><span className="tool-caption">Redo</span></button>
        <div className="toolbar-separator" role="separator" />
        <button type="button" aria-label="Flows" aria-expanded={canvasesOpen} onClick={() => { setCanvasesOpen((value) => !value); setAccountOpen(false); }}><CardIcon name="library" size={17} /><span className="tool-caption">Flows</span></button>
        <div className="export-menu-root">
          <button type="button" aria-label="Export options" aria-expanded={exportOpen} onClick={() => setExportOpen(value => !value)}><CardIcon name="download" size={17} /><span className="tool-caption">Export</span></button>
          {exportOpen && <div className="export-menu" role="dialog" aria-label="Export options">
            <button type="button" aria-label="Export workspace" onClick={() => { exportWorkspace(); setExportOpen(false); }}>Workspace JSON <small>All flows, editable boxes and files</small></button>
            <button type="button" onClick={() => {
              setExportOpen(false);
              const preview = window.open("", "_blank");
              if (!preview) { setImportError("Allow the print preview popup, then try again."); return; }
              void import("../features/canvas/printFlow").then(({ printFlow }) => printFlow(activeFlow, preview)).catch(failure => { preview.close(); setImportError(failure instanceof Error ? failure.message : "Unable to print this flow."); });
            }}>Print / Save PDF <small>Current flow, formatted for reading</small></button>
          </div>}
        </div>
        <button type="button" aria-label="Import workspace" onClick={() => importRef.current?.click()}><CardIcon name="upload" size={17} /><span className="tool-caption">Import</span></button>
        <input ref={importRef} className="visually-hidden" type="file" aria-label="Workspace JSON file" accept="application/json,.json" onChange={(event) => void handleImport(event.target.files?.[0])} />
        <button type="button" className="danger-link" aria-label="Clear local workspace" onClick={() => { if (window.confirm("Clear this browser's saved workspace? Export first if you need a copy.")) void clearLocalWorkspace(); }}><CardIcon name="trash" size={17} /><span className="tool-caption">Clear</span></button>
        <div ref={setControlsContainer} className="canvas-navigation" aria-label="Canvas navigation" role="group" />
      </div>
      {canvasesOpen && <>
        <button type="button" className="popover-backdrop" aria-label="Close flows" onClick={() => setCanvasesOpen(false)} />
        <div className="flows-popover" role="dialog" aria-label="Flows">
          <div className="flows-popover-head"><span>Flows</span><button type="button" className="primary-button compact-button" onClick={createFlow}>New flow</button></div>
          {importError && <p className="form-error">{importError}</p>}
          <div className="flow-list">{workspace.flows.map((flow) => <div className={`flow-list-item ${flow.id === activeFlow.id ? "active" : ""}`} key={flow.id}>
            {renameId === flow.id ? <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={commitRename} onKeyDown={(event) => { if (event.key === "Enter") commitRename(); if (event.key === "Escape") setRenameId(null); }} /> : <button type="button" className="flow-select" onClick={() => activateFlow(flow.id)}><span>{flow.name}</span><small>{flow.nodes.length} node{flow.nodes.length === 1 ? "" : "s"}</small></button>}
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

export const App = ({ authBoundary: AuthBoundary = AuthProvider }: { authBoundary?: AuthBoundaryComponent } = {}) => <Suspense fallback={<main className="loading-screen">Opening your workspace…</main>}><AuthBoundary><ReactFlowProvider><AuthGate /></ReactFlowProvider></AuthBoundary></Suspense>;
