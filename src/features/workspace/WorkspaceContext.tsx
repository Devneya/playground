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
import { InMemoryWorkspaceRepository } from "../../persistence/InMemoryWorkspaceRepository";
import { ResilientWorkspaceRepository } from "../../persistence/ResilientWorkspaceRepository";
import { WorkspaceSaveQueue } from "../../persistence/WorkspaceSaveQueue";
import type { WorkspaceRepository } from "../../persistence/WorkspaceRepository";
import { startGenerationRun, type GenerationRun } from "../execution/executeGeneration";
import { emptyHistory, pushHistory, redoHistory, undoHistory, type HistoryState } from "../../domain/workspaceHistory";

type AsyncStatus = "idle" | "loading" | "ready" | "error";
type WorkspaceProviderProps = PropsWithChildren<{ repository?: WorkspaceRepository }>;

export type WorkspaceContextValue = {
  workspace: WorkspaceDocument;
  activeFlow: FlowDocument;
  loading: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  error: string | null;
  storageWarning: string | null;
  models: Model[];
  modelsStatus: AsyncStatus;
  modelsError: string | null;
  reloadModels(): void;
  reloadKey(): void;
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
  activeRunIds: Readonly<Record<string, string>>;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider = ({ children, repository: injectedRepository }: WorkspaceProviderProps) => {
  const { user, session } = useAuth();
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const repository = useMemo<WorkspaceRepository>(() => injectedRepository ?? new ResilientWorkspaceRepository(new IndexedDbWorkspaceRepository(), {
    repository: new InMemoryWorkspaceRepository(),
    onFallback: () => setStorageWarning("Browser storage is unavailable. Changes will last only for this page session."),
  }), [injectedRepository]);
  const reducerContext = useMemo(() => ({ idFactory: randomIdFactory, clock: systemClock }), []);
  const [workspace, reduceWorkspaceDispatch] = useReducer(
    (document: WorkspaceDocument, action: WorkspaceAction) => reduceWorkspace(document, action, reducerContext),
    undefined,
    () => createStarterWorkspace(reducerContext.idFactory, reducerContext.clock),
  );
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [history, setHistory] = useState<HistoryState>(emptyHistory);
  const lastHistoryActionRef = useRef<string | null>(null);
  const dispatch = useCallback((action: WorkspaceAction) => {
    const isHistoryAction = !action.type.startsWith("batch/")
      && !action.type.startsWith("execution/")
      && action.type !== "workspace/reset"
      && action.type !== "workspace/imported"
      && action.type !== "viewport/update";
    if (isHistoryAction) {
      const actionKey = JSON.stringify(action);
      const previousWorkspace = workspaceRef.current;
      if (lastHistoryActionRef.current !== actionKey) setHistory((current) => pushHistory(current, previousWorkspace));
      lastHistoryActionRef.current = actionKey;
    } else if (action.type === "workspace/reset" || action.type === "workspace/imported") {
      lastHistoryActionRef.current = null;
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
  const activeRunsRef = useRef(new Map<string, GenerationRun>());
  const [activeRunIds, setActiveRunIds] = useState<Record<string, string>>({});
  const lifecycleEpochRef = useRef(0);
  const modelAbortRef = useRef<AbortController | null>(null);
  const keyAbortRef = useRef<AbortController | null>(null);
  const saveQueueRef = useRef(new WorkspaceSaveQueue());
  const saveGenerationRef = useRef(0);

  useEffect(() => {
    lifecycleEpochRef.current += 1;
    const runs = activeRunsRef.current;
    const saveQueue = saveQueueRef.current;
    return () => {
      lifecycleEpochRef.current += 1;
      saveGenerationRef.current += 1;
      modelAbortRef.current?.abort();
      keyAbortRef.current?.abort();
      runs.forEach((run) => run.cancel());
      runs.clear();
      setActiveRunIds({});
      void saveQueue.invalidate();
    };
  }, [user?.id, session?.access_token]);

  useEffect(() => {
    let alive = true;
    loadedUserRef.current = null;
    setLoadStatus("loading");
    setError(null);
    if (!user) {
      setLoadStatus("ready");
      return () => { alive = false; };
    }
    const epoch = lifecycleEpochRef.current;
    void repository.load(user.id).then((saved) => {
      if (!alive || epoch !== lifecycleEpochRef.current) return;
      const next = saved ? normalizeInterruptedBatches(saved, systemClock) : createStarterWorkspace(reducerContext.idFactory, reducerContext.clock);
      dispatch({ type: "workspace/reset", workspace: next });
      loadedUserRef.current = user.id;
      setLoadStatus("ready");
      setLastSavedAt(saved ? new Date().toISOString() : null);
    }).catch((loadError: unknown) => {
      if (!alive || epoch !== lifecycleEpochRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load the local workspace.");
      dispatch({ type: "workspace/reset", workspace: createStarterWorkspace(reducerContext.idFactory, reducerContext.clock) });
      loadedUserRef.current = user.id;
      setLoadStatus("error");
    });
    return () => { alive = false; };
  }, [dispatch, reducerContext, repository, user]);

  useEffect(() => {
    if (!user || loadedUserRef.current !== user.id || loadStatus !== "ready") return;
    const epoch = lifecycleEpochRef.current;
    const generation = ++saveGenerationRef.current;
    saveQueueRef.current.schedule({
      userId: user.id,
      workspace,
      save: (userId, document) => repository.save(userId, document),
      isCurrent: (_queueVersion, userId) => generation === saveGenerationRef.current && userId === user.id && epoch === lifecycleEpochRef.current,
      onStart: () => setSaving(true),
      onSettled: (_queueVersion, userId, saveError) => {
        if (generation !== saveGenerationRef.current || userId !== user.id || epoch !== lifecycleEpochRef.current) return;
        setSaving(false);
        if (saveError) setError(saveError instanceof Error ? saveError.message : "Unable to save the local workspace.");
        else setLastSavedAt(new Date().toISOString());
      },
    });
  }, [loadStatus, user, workspace, repository]);
  const reloadModels = useCallback(() => {
    modelAbortRef.current?.abort();
    const epoch = lifecycleEpochRef.current;
    const controller = new AbortController();
    modelAbortRef.current = controller;
    setModelsStatus("loading");
    setModelsError(null);
    void listModels(controller.signal).then((catalog) => {
      if (controller.signal.aborted || epoch !== lifecycleEpochRef.current) return;
      setModels(catalog);
      setModelsStatus("ready");
    }).catch((modelsError: unknown) => {
      if (controller.signal.aborted || epoch !== lifecycleEpochRef.current) return;
      setModelsStatus("error");
      setModelsError(normalizeApiError(modelsError).message);
    });
  }, []);

  useEffect(() => {
    setModels([]);
    reloadModels();
    return () => modelAbortRef.current?.abort();
  }, [reloadModels, session?.access_token, user?.id]);

  const reloadKey = useCallback(() => {
    keyAbortRef.current?.abort();
    setVirtualKey(null);
    setKeyError(null);
    if (!session) {
      setKeyStatus("idle");
      return;
    }
    const epoch = lifecycleEpochRef.current;
    const controller = new AbortController();
    keyAbortRef.current = controller;
    setKeyStatus("loading");
    void getVirtualKey(toGoTrueAccessToken(session.access_token), controller.signal).then((key) => {
      if (controller.signal.aborted || epoch !== lifecycleEpochRef.current) return;
      setVirtualKey(key);
      setKeyStatus("ready");
    }).catch((keyFetchError: unknown) => {
      if (controller.signal.aborted || epoch !== lifecycleEpochRef.current) return;
      setKeyStatus("error");
      setKeyError(normalizeApiError(keyFetchError).message);
    });
  }, [session]);

  useEffect(() => {
    reloadKey();
    return () => keyAbortRef.current?.abort();
  }, [reloadKey]);


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
    const userId = user.id;
    lifecycleEpochRef.current += 1;
    const clearEpoch = lifecycleEpochRef.current;
    saveGenerationRef.current += 1;
    activeRunsRef.current.forEach((run) => run.cancel());
    activeRunsRef.current.clear();
    setActiveRunIds({});
    const pendingWrite = saveQueueRef.current.invalidate();
    await pendingWrite;
    await repository.delete(userId);
    if (user?.id !== userId || clearEpoch !== lifecycleEpochRef.current) return;
    dispatch({ type: "workspace/reset", workspace: createStarterWorkspace(reducerContext.idFactory, reducerContext.clock) });
    setSaving(false);
    setLastSavedAt(null);
  }, [dispatch, reducerContext, repository, user]);

  const runGeneration = useCallback((generationNodeId: string) => {
    if (!virtualKey) throw new Error(keyError || "Your account key is not ready yet.");
    const runEpoch = lifecycleEpochRef.current;
    const run = startGenerationRun({
      flow: workspace.flows.find((flow) => flow.id === workspace.activeFlowId) ?? workspace.flows[0]!,
      generationNodeId,
      virtualKey,
      idFactory: reducerContext.idFactory,
      clock: reducerContext.clock,
      dispatch,
      canDispatch: () => runEpoch === lifecycleEpochRef.current,
    });
    activeRunsRef.current.set(run.batchId, run);
    setActiveRunIds((current) => ({ ...current, [generationNodeId]: run.batchId }));
    void run.completed.finally(() => {
      activeRunsRef.current.delete(run.batchId);
      if (runEpoch !== lifecycleEpochRef.current) return;
      setActiveRunIds((current) => current[generationNodeId] === run.batchId ? Object.fromEntries(Object.entries(current).filter(([nodeId]) => nodeId !== generationNodeId)) : current);
    });
    return run;
  }, [dispatch, keyError, reducerContext, virtualKey, workspace]);

  const cancelRun = useCallback((batchId: string) => activeRunsRef.current.get(batchId)?.cancel(), []);

  const activeFlow = workspace.flows.find((flow) => flow.id === workspace.activeFlowId) ?? workspace.flows[0]!;
  const undo = useCallback(() => {
    const result = undoHistory(history, workspace);
    if (!result) return;
    lastHistoryActionRef.current = null;
    setHistory(result.history);
    reduceWorkspaceDispatch({ type: "workspace/reset", workspace: result.workspace });
  }, [history, reduceWorkspaceDispatch, workspace]);

  const redo = useCallback(() => {
    const result = redoHistory(history, workspace);
    if (!result) return;
    lastHistoryActionRef.current = null;
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
    storageWarning,
    models,
    modelsStatus,
    modelsError,
    reloadModels,
    reloadKey,
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
    activeRunIds,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
  }), [activeFlow, activeRunIds, cancelRun, clearLocalWorkspace, createFlow, deleteFlow, dispatch, duplicateFlow, error, exportWorkspace, history, importWorkspace, keyError, keyStatus, lastSavedAt, loadStatus, models, modelsError, modelsStatus, redo, reloadKey, reloadModels, renameFlow, runGeneration, saving, storageWarning, activateFlow, undo, virtualKey, workspace]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};
