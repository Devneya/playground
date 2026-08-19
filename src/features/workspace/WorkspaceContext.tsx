import { createContext, useCallback, useEffect, useMemo, useReducer, useRef, useState, type PropsWithChildren } from "react";
import { useAuth } from "../../auth/useAuth";
import { getVirtualKey } from "../../api/account";
import { toGoTrueAccessToken, type BifrostVirtualKey } from "../../api/credentials";
import { normalizeApiError } from "../../api/errors";
import { listModels } from "../../api/models";
import { createBlankFlow, createStarterWorkspace, uniqueFlowName } from "../../domain/workspaceFactory";
import { createWorkspaceExport, parseWorkspaceExport } from "../../domain/exportFormat";
import { randomIdFactory, systemClock } from "../../domain/ids";
import { normalizeInterruptedBatches, reduceWorkspace, type WorkspaceAction } from "../../domain/workspaceReducer";
import { duplicateFlowWithFreshIds } from "../../domain/duplicateFlow";
import type { FlowDocument, Model, PlaygroundNode, WorkspaceDocument } from "../../domain/types";
import { IndexedDbWorkspaceRepository } from "../../persistence/IndexedDbWorkspaceRepository";
import { startGenerationRun, type GenerationRun } from "../execution/executeGeneration";
import { emptyHistory, pushHistory, redoHistory, undoHistory, type HistoryState } from "../../domain/workspaceHistory";

const repository = new IndexedDbWorkspaceRepository();

type AsyncStatus = "idle" | "loading" | "ready" | "error";

export type WorkspaceContextValue = {
  workspace: WorkspaceDocument;
  activeFlow: FlowDocument;
  loading: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  error: string | null;
  models: Model[];
  modelsStatus: AsyncStatus;
  modelsError: string | null;
  reloadModels(): void;
  virtualKey: BifrostVirtualKey | null;
  keyStatus: AsyncStatus;
  keyError: string | null;
  dispatch(action: WorkspaceAction): void;
  createFlow(): void;
  duplicateFlow(flowId: string): void;
  deleteFlow(flowId: string): void;
  activateFlow(flowId: string): void;
  renameFlow(flowId: string, name: string): void;
  addNode(node: PlaygroundNode): void;
  exportWorkspace(): void;
  importWorkspace(file: File): Promise<void>;
  clearLocalWorkspace(): Promise<void>;
  runGeneration(generationNodeId: string): GenerationRun;
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  cancelRun(batchId: string): void;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider = ({ children }: PropsWithChildren) => {
  const { user, session } = useAuth();
  const reducerContext = useMemo(() => ({ idFactory: randomIdFactory, clock: systemClock }), []);
  const [workspace, reduceWorkspaceDispatch] = useReducer(
    (document: WorkspaceDocument, action: WorkspaceAction) => reduceWorkspace(document, action, reducerContext),
    undefined,
    () => createStarterWorkspace(reducerContext.idFactory, reducerContext.clock),
  );
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [history, setHistory] = useState<HistoryState>(emptyHistory);
  const dispatch = useCallback((action: WorkspaceAction) => {
    const isHistoryAction = !action.type.startsWith("batch/")
      && !action.type.startsWith("execution/")
      && action.type !== "workspace/reset"
      && action.type !== "workspace/imported"
      && action.type !== "viewport/update";
    if (isHistoryAction) {
      setHistory((current) => pushHistory(current, workspaceRef.current));
    } else if (action.type === "workspace/reset" || action.type === "workspace/imported") {
      setHistory(emptyHistory());
    }
    reduceWorkspaceDispatch(action);
  }, [reduceWorkspaceDispatch]);
  const [loadStatus, setLoadStatus] = useState<AsyncStatus>("loading");
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelsStatus, setModelsStatus] = useState<AsyncStatus>("idle");
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [virtualKey, setVirtualKey] = useState<BifrostVirtualKey | null>(null);
  const [keyStatus, setKeyStatus] = useState<AsyncStatus>("idle");
  const [keyError, setKeyError] = useState<string | null>(null);
  const loadedUserRef = useRef<string | null>(null);
  const saveVersionRef = useRef(0);
  const activeRunsRef = useRef(new Map<string, GenerationRun>());

  useEffect(() => {
    let alive = true;
    loadedUserRef.current = null;
    setLoadStatus("loading");
    setError(null);
    if (!user) {
      setLoadStatus("ready");
      return () => { alive = false; };
    }
    void repository.load(user.id).then((saved) => {
      if (!alive) return;
      const next = saved ? normalizeInterruptedBatches(saved, systemClock) : createStarterWorkspace(reducerContext.idFactory, reducerContext.clock);
      dispatch({ type: "workspace/reset", workspace: next });
      loadedUserRef.current = user.id;
      setLoadStatus("ready");
      setLastSavedAt(saved ? new Date().toISOString() : null);
    }).catch((loadError: unknown) => {
      if (!alive) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load the local workspace.");
      dispatch({ type: "workspace/reset", workspace: createStarterWorkspace(reducerContext.idFactory, reducerContext.clock) });
      loadedUserRef.current = user.id;
      setLoadStatus("error");
    });
    return () => { alive = false; };
  }, [dispatch, reducerContext, user]);

  useEffect(() => {
    if (!user || loadedUserRef.current !== user.id || loadStatus !== "ready") return;
    const version = ++saveVersionRef.current;
    setSaving(true);
    const timer = window.setTimeout(() => {
      void repository.save(user.id, workspace).then(() => {
        if (version !== saveVersionRef.current) return;
        setSaving(false);
        setLastSavedAt(new Date().toISOString());
      }).catch((saveError: unknown) => {
        if (version !== saveVersionRef.current) return;
        setSaving(false);
        setError(saveError instanceof Error ? saveError.message : "Unable to save the local workspace.");
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [loadStatus, user, workspace]);
  const reloadModels = useCallback(() => {
    const controller = new AbortController();
    setModelsStatus("loading");
    setModelsError(null);
    void listModels(controller.signal).then((catalog) => {
      setModels(catalog);
      setModelsStatus("ready");
    }).catch((modelsError: unknown) => {
      if (controller.signal.aborted) return;
      setModelsStatus("error");
      setModelsError(normalizeApiError(modelsError).message);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => reloadModels(), [reloadModels]);

  useEffect(() => {
    if (!session) {
      setVirtualKey(null);
      setKeyStatus("idle");
      return;
    }
    const controller = new AbortController();
    setKeyStatus("loading");
    setKeyError(null);
    void getVirtualKey(toGoTrueAccessToken(session.access_token), controller.signal).then((key) => {
      setVirtualKey(key);
      setKeyStatus("ready");
    }).catch((keyFetchError: unknown) => {
      if (controller.signal.aborted) return;
      setKeyStatus("error");
      setKeyError(normalizeApiError(keyFetchError).message);
    });
    return () => controller.abort();
  }, [session]);


  const createFlow = useCallback(() => {
    dispatch({ type: "flow/create", flow: createBlankFlow(workspace, reducerContext.idFactory, reducerContext.clock) });
  }, [dispatch, reducerContext, workspace]);

  const duplicateFlow = useCallback((flowId: string) => {
    const source = workspace.flows.find((flow) => flow.id === flowId);
    if (!source) return;
    dispatch({ type: "flow/duplicate", flowId, duplicate: duplicateFlowWithFreshIds(source, reducerContext.idFactory, reducerContext.clock, uniqueFlowName(workspace.flows.map((flow) => flow.name), source.name)) });
  }, [dispatch, reducerContext, workspace]);

  const deleteFlow = useCallback((flowId: string) => dispatch({ type: "flow/delete", flowId }), [dispatch]);
  const activateFlow = useCallback((flowId: string) => dispatch({ type: "flow/activate", flowId }), [dispatch]);
  const renameFlow = useCallback((flowId: string, name: string) => dispatch({ type: "flow/rename", flowId, name }), [dispatch]);

  const exportWorkspace = useCallback(() => {
    const payload = createWorkspaceExport(workspace, systemClock);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${workspace.flows.find((flow) => flow.id === workspace.activeFlowId)?.name || "devneya-flow"}.devneya.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [workspace]);

  const importWorkspace = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) throw new Error("This workspace file is too large.");
    const imported = parseWorkspaceExport(JSON.parse(await file.text()));
    dispatch({ type: "workspace/imported", workspace: imported.workspace });
  }, [dispatch]);

  const clearLocalWorkspace = useCallback(async () => {
    if (!user) return;
    await repository.delete(user.id);
    dispatch({ type: "workspace/reset", workspace: createStarterWorkspace(reducerContext.idFactory, reducerContext.clock) });
    setLastSavedAt(null);
  }, [dispatch, reducerContext, user]);

  const runGeneration = useCallback((generationNodeId: string) => {
    if (!virtualKey) throw new Error(keyError || "Your account key is not ready yet.");
    const run = startGenerationRun({
      flow: workspace.flows.find((flow) => flow.id === workspace.activeFlowId) ?? workspace.flows[0]!,
      generationNodeId,
      virtualKey,
      idFactory: reducerContext.idFactory,
      clock: reducerContext.clock,
      dispatch,
    });
    activeRunsRef.current.set(run.batchId, run);
    void run.completed.finally(() => activeRunsRef.current.delete(run.batchId));
    return run;
  }, [dispatch, keyError, reducerContext, virtualKey, workspace]);

  const cancelRun = useCallback((batchId: string) => activeRunsRef.current.get(batchId)?.cancel(), []);

  const activeFlow = workspace.flows.find((flow) => flow.id === workspace.activeFlowId) ?? workspace.flows[0]!;
  const undo = useCallback(() => {
    const result = undoHistory(history, workspace);
    if (!result) return;
    setHistory(result.history);
    reduceWorkspaceDispatch({ type: "workspace/reset", workspace: result.workspace });
  }, [history, reduceWorkspaceDispatch, workspace]);

  const redo = useCallback(() => {
    const result = redoHistory(history, workspace);
    if (!result) return;
    setHistory(result.history);
    reduceWorkspaceDispatch({ type: "workspace/reset", workspace: result.workspace });
  }, [history, reduceWorkspaceDispatch, workspace]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    workspace,
    activeFlow,
    loading: loadStatus === "loading",
    saving,
    lastSavedAt,
    error,
    models,
    modelsStatus,
    modelsError,
    reloadModels,
    virtualKey,
    keyStatus,
    keyError,
    dispatch,
    createFlow,
    duplicateFlow,
    deleteFlow,
    activateFlow,
    renameFlow,
    addNode: (node) => dispatch({ type: "node/add", flowId: workspace.activeFlowId, node }),
    exportWorkspace,
    importWorkspace,
    clearLocalWorkspace,
    runGeneration,
    cancelRun,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
  }), [activeFlow, cancelRun, clearLocalWorkspace, createFlow, deleteFlow, dispatch, duplicateFlow, error, exportWorkspace, history, importWorkspace, keyError, keyStatus, lastSavedAt, loadStatus, models, modelsError, modelsStatus, redo, reloadModels, renameFlow, runGeneration, saving, activateFlow, undo, virtualKey, workspace]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};
