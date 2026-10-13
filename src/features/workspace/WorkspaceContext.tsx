import { emptySurface } from "../../domain/surface";
import { startSurfaceRun } from "../execution/executeSurface";
import { createContext, useCallback, useEffect, useMemo, useReducer, useRef, useState, type PropsWithChildren } from "react";
import type { CompletionCredential } from "../../api/credentials";
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
import { BROWSER_WORKSPACE_ID } from "../../persistence/browserWorkspaceIdentity";
import { startGenerationRun, type GenerationRun } from "../execution/executeGeneration";
import { emptyHistory, isHistoryAction, pushHistory, redoHistory, undoHistory, type HistoryState } from "../../domain/workspaceHistory";
import { useConnectionSettings } from "../connection/useConnectionSettings";

type AsyncStatus = "idle" | "loading" | "ready" | "error";

export type WorkspaceContextValue = {
  workspace: WorkspaceDocument;
  activeFlow: FlowDocument;
  loading: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  error: string | null;
  storageWarning: string | null;
  models: Model[];
  modelsStatus: "idle" | "loading" | "ready" | "error";
  modelsError: string | null;
  reloadModels(): void;
  reloadKey(): void;
  virtualKey: CompletionCredential | null;
  keyStatus: "idle" | "loading" | "ready" | "error";
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
  runGeneration(generationNodeId: string, instruction?: string): GenerationRun;
  runSurface(instruction: string, selectedIds: string[], model: string): GenerationRun;
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  cancelRun(batchId: string): void;
  prepareConnectionChange(): Promise<void>;
  activeRunIds: Readonly<Record<string, string>>;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider = ({ children, repository: injectedRepository }: PropsWithChildren<{ repository?: WorkspaceRepository }>) => {
  const connection = useConnectionSettings();
  const { provider: connectionProvider, credential, models, modelsStatus, modelsError, keyStatus, keyError, reloadModels, reloadKey } = connection;
  const virtualKey = credential;
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
  const lastTypingAtRef = useRef(0);
  const dispatch = useCallback((action: WorkspaceAction) => {
    if (isHistoryAction(action)) {
      const typing = action.type === "node/edit-instruction" || action.type === "node/edit-text";
      const actionKey = typing ? `${action.type}:${action.flowId}:${action.nodeId}` : action.type === "surface/change" && action.gesture ? `surface-gesture:${action.flowId}:${action.gesture}` : JSON.stringify(action);
      if (typing && Date.now() - lastTypingAtRef.current > 1000) lastHistoryActionRef.current = null;
      const previousWorkspace = workspaceRef.current;
      if (lastHistoryActionRef.current !== actionKey) setHistory((current) => pushHistory(current, previousWorkspace));
      lastHistoryActionRef.current = actionKey;
      if (typing) lastTypingAtRef.current = Date.now();
    } else if (action.type === "workspace/reset" || action.type === "workspace/imported") {
      lastHistoryActionRef.current = null;
      setHistory(emptyHistory());
    } else if (action.type === "batch/started" || action.type === "execution/succeeded" || action.type === "batch/completed") {
      lastHistoryActionRef.current = null;
    }
    reduceWorkspaceDispatch(action);
  }, [reduceWorkspaceDispatch]);
  const [loadStatus, setLoadStatus] = useState<AsyncStatus>("loading");
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedWorkspaceRef = useRef(false);
  const activeRunsRef = useRef(new Map<string, GenerationRun>());
  const [activeRunIds, setActiveRunIds] = useState<Record<string, string>>({});
  const lifecycleEpochRef = useRef(0);
  const saveQueueRef = useRef(new WorkspaceSaveQueue());
  const saveGenerationRef = useRef(0);

  useEffect(() => {
    // Draft fields flush synchronously during pagehide. Drain the resulting
    // save after all those handlers, without waiting for the idle timeout.
    const leaving = () => queueMicrotask(() => { void saveQueueRef.current.flush(); });
    window.addEventListener("beforeunload", leaving);
    window.addEventListener("pagehide", leaving);
    return () => { window.removeEventListener("beforeunload", leaving); window.removeEventListener("pagehide", leaving); };
  }, []);

  useEffect(() => {
    lifecycleEpochRef.current += 1;
    const runs = activeRunsRef.current;
    const saveQueue = saveQueueRef.current;
    return () => {
      lifecycleEpochRef.current += 1;
      saveGenerationRef.current += 1;
      runs.forEach((run) => run.cancel());
      runs.clear();
      setActiveRunIds({});
      void saveQueue.invalidate();
    };
  }, []);

  const previousConnectionRef = useRef(connection.connection);
  useEffect(() => {
    if (previousConnectionRef.current === connection.connection) return;
    previousConnectionRef.current = connection.connection;
    const runs = [...activeRunsRef.current.values()];
    runs.forEach((run) => run.cancel());
    void (async () => {
      await Promise.allSettled(runs.map((run) => run.completed));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (previousConnectionRef.current !== connection.connection) return;
      await saveQueueRef.current.flush();
      lifecycleEpochRef.current += 1;
      saveGenerationRef.current += 1;
    })();
  }, [connection.connection]);

  useEffect(() => {
    let alive = true;
    loadedWorkspaceRef.current = false;
    setLoadStatus("loading");
    setError(null);
    const epoch = lifecycleEpochRef.current;
    void repository.load(BROWSER_WORKSPACE_ID).then((saved) => {
      if (!alive || epoch !== lifecycleEpochRef.current) return;
      const next = saved ? normalizeInterruptedBatches(saved, systemClock) : createStarterWorkspace(reducerContext.idFactory, reducerContext.clock);
      dispatch({ type: "workspace/reset", workspace: next });
      loadedWorkspaceRef.current = true;
      setLoadStatus("ready");
      setLastSavedAt(saved ? new Date().toISOString() : null);
    }).catch((loadError: unknown) => {
      if (!alive || epoch !== lifecycleEpochRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load the local workspace.");
      dispatch({ type: "workspace/reset", workspace: createStarterWorkspace(reducerContext.idFactory, reducerContext.clock) });
      loadedWorkspaceRef.current = true;
      setLoadStatus("error");
    });
    return () => { alive = false; };
  }, [dispatch, reducerContext, repository]);

  useEffect(() => {
    if (!loadedWorkspaceRef.current || loadStatus !== "ready") return;
    const epoch = lifecycleEpochRef.current;
    const generation = ++saveGenerationRef.current;
    saveQueueRef.current.schedule({
      userId: BROWSER_WORKSPACE_ID,
      workspace,
      save: (userId, document) => repository.save(userId, document),
      isCurrent: (_queueVersion, userId) => generation === saveGenerationRef.current && userId === BROWSER_WORKSPACE_ID && epoch === lifecycleEpochRef.current,
      onScheduled: () => setSaving(true),
      onStart: () => setSaving(true),
      onSettled: (_queueVersion, userId, saveError) => {
        if (generation !== saveGenerationRef.current || userId !== BROWSER_WORKSPACE_ID || epoch !== lifecycleEpochRef.current) return;
        setSaving(false);
        if (saveError) setError(saveError instanceof Error ? saveError.message : "Unable to save the local workspace.");
        else setLastSavedAt(new Date().toISOString());
      },
    });
  }, [loadStatus, workspace, repository]);

  useEffect(() => {
    // The OpenAI catalog contains more than Chat Completions models. Let the
    // person choose instead of guessing a compatible model or probing inference.
    const defaultModel = connectionProvider === "openai" ? undefined : (connectionProvider === "local-codex" ? models.find((model) => model.id === "gpt-6.1-sol") : undefined)?.id ?? models[0]?.id;
    if (loadStatus !== "ready" || modelsStatus !== "ready" || !defaultModel) return;
    if (workspace.flows.some((flow) => flow.nodes.some((node) => node.data.kind === "generation" && !node.data.modelIds.length && !flow.batches.some((batch) => batch.generationNodeId === node.id)))) {
      dispatch({ type: "workspace/default-model", modelId: defaultModel });
    }
  }, [connectionProvider, dispatch, loadStatus, models, modelsStatus, workspace]);


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
    const runs = [...activeRunsRef.current.values()];
    runs.forEach((run) => run.cancel());
    await Promise.allSettled(runs.map((run) => run.completed));
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    saveGenerationRef.current += 1;
    const pendingWrite = saveQueueRef.current.invalidate();
    await pendingWrite;
    const blank = createStarterWorkspace(reducerContext.idFactory, reducerContext.clock);
    await repository.save(BROWSER_WORKSPACE_ID, blank);
    lifecycleEpochRef.current += 1;
    setActiveRunIds({});
    dispatch({ type: "workspace/reset", workspace: blank });
    setSaving(false);
    setLastSavedAt(new Date().toISOString());
  }, [dispatch, reducerContext, repository]);

  const runGeneration = useCallback((generationNodeId: string, instruction?: string) => {
    if (!virtualKey) throw new Error(keyError || "Your account key is not ready yet.");
    if (modelsStatus !== "ready") throw new Error(modelsError || "The model catalog is not ready yet.");
    const currentWorkspace = workspaceRef.current;
    let flow = currentWorkspace.flows.find(flow => flow.id === currentWorkspace.activeFlowId) ?? currentWorkspace.flows[0]!;
    const prompt = flow.nodes.find(node => node.id === generationNodeId);
    if (prompt?.data.kind === "generation") {
      if (prompt.data.modelIds.some((modelId) => !models.some((model) => model.id === modelId))) throw new Error("This prompt has a model that is no longer available. Choose a model from the current catalog.");
      if (!prompt.data.modelIds.length) throw new Error("Choose a model from the current catalog before running.");
    }
    if (instruction !== undefined && prompt?.data.kind === "generation" && prompt.data.instruction !== instruction) {
      // A send may arrive before a queued draft commit has rendered.
      dispatch({ type: "node/edit-instruction", flowId: flow.id, nodeId: generationNodeId, instruction });
      flow = { ...flow, nodes: flow.nodes.map(node => node.id === generationNodeId && node.data.kind === "generation" ? { ...node, data: { ...node.data, instruction } } : node) };
    }
    if (prompt?.data.kind === "generation") {
      const availableEfforts = Object.fromEntries(Object.entries(prompt.data.modelEfforts ?? {}).filter(([modelId, effort]) => models.find((model) => model.id === modelId)?.supportedReasoningEfforts?.includes(effort)));
      flow = { ...flow, nodes: flow.nodes.map((node) => node.id === generationNodeId && node.data.kind === "generation" ? { ...node, data: { ...node.data, modelEfforts: availableEfforts } } : node) };
    }
    const runEpoch = lifecycleEpochRef.current;
    const run = startGenerationRun({
      flow,
      generationNodeId: generationNodeId,
      virtualKey,
      ...(connectionProvider ? { provider: connectionProvider } : {}),
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
  }, [connectionProvider, dispatch, keyError, models, modelsError, modelsStatus, reducerContext, virtualKey]);

  const runSurface = useCallback((instruction: string, selectedIds: string[], model: string) => {
    if (!virtualKey) throw new Error(keyError || "Your account key is not ready yet.");
    if (modelsStatus !== "ready") throw new Error(modelsError || "The model catalog is not ready yet.");
    if (!models.some((item) => item.id === model)) throw new Error("Choose an available model.");
    const flow = workspaceRef.current.flows.find((item) => item.id === workspaceRef.current.activeFlowId)!;
    if (activeRunsRef.current.has(`surface-${flow.id}`)) throw new Error("A change is already in progress. Stop it before starting another.");
    const runEpoch = lifecycleEpochRef.current;
    const run = startSurfaceRun({ id: `surface-${flow.id}`, flowId: flow.id, surface: flow.surface ?? emptySurface(), instruction, selectedIds, model, credential: virtualKey, dispatch, canDispatch: () => runEpoch === lifecycleEpochRef.current });
    activeRunsRef.current.set(run.batchId, run);
    setActiveRunIds((current) => ({ ...current, [flow.id]: run.batchId }));
    const clean = () => {
      if (activeRunsRef.current.get(run.batchId) === run) activeRunsRef.current.delete(run.batchId);
      if (runEpoch === lifecycleEpochRef.current) setActiveRunIds((current) => Object.fromEntries(Object.entries(current).filter(([id, batch]) => id !== flow.id || batch !== run.batchId)));
    };
    void run.completed.then(clean, clean);
    return run;
  }, [dispatch, keyError, models, modelsError, modelsStatus, virtualKey]);

  const cancelRun = useCallback((batchId: string) => activeRunsRef.current.get(batchId)?.cancel(), []);

  const prepareConnectionChange = useCallback(async () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    const runs = [...activeRunsRef.current.values()];
    runs.forEach(run => run.cancel());
    await Promise.allSettled(runs.map((run) => run.completed));
    // Let blur-flushed drafts and cancellation results reach the save queue.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await saveQueueRef.current.flush();
  }, []);

  const activeFlow = workspace.flows.find((flow) => flow.id === workspace.activeFlowId) ?? workspace.flows[0]!;
  const undo = useCallback(() => {
    activeRunsRef.current.forEach((run, id) => { if (id.startsWith("surface-")) run.cancel(); });
    const result = undoHistory(history, workspace);
    if (!result) return;
    lastHistoryActionRef.current = null;
    setHistory(result.history);
    reduceWorkspaceDispatch({ type: "workspace/reset", workspace: result.workspace });
  }, [history, reduceWorkspaceDispatch, workspace]);

  const redo = useCallback(() => {
    activeRunsRef.current.forEach((run, id) => { if (id.startsWith("surface-")) run.cancel(); });
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
    runSurface,
    cancelRun,
    prepareConnectionChange,
    activeRunIds,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
  }), [activeFlow, activeRunIds, cancelRun, prepareConnectionChange, clearLocalWorkspace, createFlow, deleteFlow, dispatch, duplicateFlow, error, exportWorkspace, history, importWorkspace, keyError, keyStatus, lastSavedAt, loadStatus, models, modelsError, modelsStatus, redo, reloadKey, reloadModels, renameFlow, runGeneration, runSurface, saving, storageWarning, activateFlow, undo, virtualKey, workspace]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};
