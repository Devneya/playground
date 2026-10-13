import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { CONNECTION_STORAGE_KEY, readBrowserConnection, saveBrowserConnection, type BrowserConnection } from "../../api/browserConnection";
import { getVirtualKey } from "../../api/account";
import { toOpenAIApiKey, type CompletionCredential, type GoTrueAccessToken } from "../../api/credentials";
import { normalizeApiError } from "../../api/errors";
import { listModels } from "../../api/models";
import { listOpenAIModels } from "../../api/openai";
import { config } from "../../config";
import type { Model } from "../../domain/types";
import { ConnectionContext, type AsyncStatus, type InferenceProvider } from "./useConnectionSettings";

type Props = PropsWithChildren<{
  initialProvider?: InferenceProvider;
}>;

const readInitialConnection = (initialProvider?: InferenceProvider): BrowserConnection | null => {
  if (initialProvider) {
    if (initialProvider === "local-codex" && !config.useLocalCodex) return null;
    if (initialProvider !== "openai") return { provider: initialProvider };
    const savedOpenAI = readBrowserConnection();
    return savedOpenAI?.provider === "openai" ? savedOpenAI : null;
  }
  if (config.useLocalCodex) return { provider: "local-codex" };
  const stored = readBrowserConnection();
  if (stored?.provider === "local-codex") return null;
  return stored ?? null;
};

export const ConnectionProvider = ({ children, initialProvider }: Props) => {
  const [connection, setConnection] = useState<BrowserConnection | null>(() => readInitialConnection(initialProvider));
  const [changing, setChanging] = useState(false);
  const [credential, setCredential] = useState<CompletionCredential | null>(null);
  const [keyStatus, setKeyStatus] = useState<AsyncStatus>("idle");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelsStatus, setModelsStatus] = useState<AsyncStatus>("idle");
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const devneyaTokenRef = useRef<GoTrueAccessToken | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);
  const keyAbortRef = useRef<AbortController | null>(null);
  const catalogVersionRef = useRef(0);
  const keyVersionRef = useRef(0);
  const validatedOpenAIRef = useRef<{ key: string; models: Model[] } | null>(null);

  const provider = connection?.provider ?? null;

  const reloadModels = useCallback(() => {
    catalogAbortRef.current?.abort();
    const current = connection;
    if (!current) {
      setModels([]);
      setModelsStatus("idle");
      setModelsError(null);
      return;
    }
    const controller = new AbortController();
    const version = ++catalogVersionRef.current;
    catalogAbortRef.current = controller;
    setModelsStatus("loading");
    setModelsError(null);
    const request = current.provider === "openai"
      ? listOpenAIModels(current.apiKey, controller.signal)
      : listModels(controller.signal, current.provider === "local-codex");
    void request.then((catalog) => {
      if (controller.signal.aborted || version !== catalogVersionRef.current) return;
      setModels(catalog);
      setModelsStatus("ready");
      if (current.provider === "openai") {
        setCredential({ kind: "openai", apiKey: current.apiKey });
        setKeyStatus("ready");
        setKeyError(null);
      }
    }).catch((failure: unknown) => {
      if (controller.signal.aborted || version !== catalogVersionRef.current) return;
      const message = normalizeApiError(failure).message;
      setModelsStatus("error");
      setModelsError(message);
      if (current.provider === "openai") {
        setCredential(null);
        setKeyStatus("error");
        setKeyError(message);
      }
    });
  }, [connection]);

  const reloadKey = useCallback(() => {
    keyAbortRef.current?.abort();
    if (connection?.provider === "openai") {
      setCredential({ kind: "openai", apiKey: connection.apiKey });
      setKeyStatus("ready");
      setKeyError(null);
      return;
    }
    if (connection?.provider === "local-codex") {
      setCredential({ kind: "local-codex" });
      setKeyStatus("ready");
      setKeyError(null);
      return;
    }
    if (connection?.provider !== "devneya" || !devneyaTokenRef.current) {
      setCredential(null);
      setKeyStatus("idle");
      setKeyError(null);
      return;
    }
    const token = devneyaTokenRef.current;
    const controller = new AbortController();
    const version = ++keyVersionRef.current;
    keyAbortRef.current = controller;
    setCredential(null);
    setKeyStatus("loading");
    setKeyError(null);
    void getVirtualKey(token, controller.signal).then((key) => {
      if (controller.signal.aborted || version !== keyVersionRef.current || devneyaTokenRef.current !== token) return;
      setCredential(key);
      setKeyStatus("ready");
    }).catch((failure: unknown) => {
      if (controller.signal.aborted || version !== keyVersionRef.current || devneyaTokenRef.current !== token) return;
      setCredential(null);
      setKeyStatus("error");
      setKeyError(normalizeApiError(failure).message);
    });
  }, [connection]);

  const setDevneyaSession = useCallback(async (token: GoTrueAccessToken, email: string | null) => {
    devneyaTokenRef.current = token;
    setAccountEmail(email);
    keyAbortRef.current?.abort();
    const controller = new AbortController();
    const version = ++keyVersionRef.current;
    keyAbortRef.current = controller;
    setCredential(null);
    setKeyStatus("loading");
    setKeyError(null);
    try {
      const key = await getVirtualKey(token, controller.signal);
      if (controller.signal.aborted || version !== keyVersionRef.current || devneyaTokenRef.current !== token) return;
      setCredential(key);
      setKeyStatus("ready");
    } catch (failure) {
      if (controller.signal.aborted || version !== keyVersionRef.current || devneyaTokenRef.current !== token) return;
      setCredential(null);
      setKeyStatus("error");
      setKeyError(normalizeApiError(failure).message);
    }
  }, []);

  const clearDevneyaSession = useCallback(() => {
    devneyaTokenRef.current = null;
    keyAbortRef.current?.abort();
    setAccountEmail(null);
    setCredential(null);
    setKeyStatus("idle");
    setKeyError(null);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== CONNECTION_STORAGE_KEY) return;
      const stored = readBrowserConnection();
      const next = stored?.provider === "local-codex" && !config.useLocalCodex ? null : stored ?? null;
      setConnection(next);
      setChanging(false);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const retainDevneyaSession = connection?.provider === "devneya" && devneyaTokenRef.current !== null;
    catalogAbortRef.current?.abort();
    catalogVersionRef.current += 1;
    setModels([]);
    setModelsError(null);
    if (!retainDevneyaSession) {
      keyAbortRef.current?.abort();
      keyVersionRef.current += 1;
      setKeyError(null);
      setCredential(null);
      setAccountEmail(null);
      devneyaTokenRef.current = null;
    }
    if (!connection) {
      setModelsStatus("idle");
      setKeyStatus("idle");
      return;
    }
    if (connection.provider === "openai") {
      const validated = validatedOpenAIRef.current;
      if (validated?.key === connection.apiKey) {
        validatedOpenAIRef.current = null;
        setModels(validated.models);
        setModelsStatus("ready");
        setCredential({ kind: "openai", apiKey: connection.apiKey });
        setKeyStatus("ready");
        return;
      }
      setKeyStatus("loading");
      reloadModels();
      return () => catalogAbortRef.current?.abort();
    }
    if (connection.provider === "local-codex") {
      if (!config.useLocalCodex) {
        setConnection(null);
        return;
      }
      setCredential({ kind: "local-codex" });
      setKeyStatus("ready");
      reloadModels();
      return () => catalogAbortRef.current?.abort();
    }
    if (!retainDevneyaSession) setKeyStatus("idle");
    setModelsStatus("loading");
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    const version = ++catalogVersionRef.current;
    void listModels(controller.signal).then((catalog) => {
      if (controller.signal.aborted || version !== catalogVersionRef.current) return;
      setModels(catalog);
      setModelsStatus("ready");
    }).catch((failure: unknown) => {
      if (controller.signal.aborted || version !== catalogVersionRef.current) return;
      setModelsStatus("error");
      setModelsError(normalizeApiError(failure).message);
    });
    return () => controller.abort();
  }, [connection, reloadModels]);

  const chooseDevneya = useCallback(() => {
    if (!config.gotrueAnonKey && !config.useMocks) throw new Error("Devneya sign-in is not configured for this deployment.");
    const next: BrowserConnection = { provider: "devneya" };
    saveBrowserConnection(next);
    setConnection(next);
    setChanging(false);
  }, []);

  const connectOpenAI = useCallback(async (key: string, signal: AbortSignal) => {
    const apiKey = toOpenAIApiKey(key);
    const catalog = await listOpenAIModels(apiKey, signal);
    if (signal.aborted) return;
    const next: BrowserConnection = { provider: "openai", apiKey };
    saveBrowserConnection(next);
    validatedOpenAIRef.current = { key: apiKey, models: catalog };
    setConnection(next);
    setChanging(false);
  }, []);

  const disconnect = useCallback(() => {
    saveBrowserConnection(null);
    validatedOpenAIRef.current = null;
    devneyaTokenRef.current = null;
    catalogAbortRef.current?.abort();
    keyAbortRef.current?.abort();
    setConnection(null);
    setChanging(false);
  }, []);

  const value = useMemo(() => ({
    connection,
    provider,
    credential,
    keyStatus,
    keyError,
    models,
    modelsStatus,
    modelsError,
    accountEmail,
    changing,
    chooseDevneya,
    connectOpenAI,
    setDevneyaSession,
    clearDevneyaSession,
    reloadModels,
    reloadKey,
    changeConnection: () => setChanging(true),
    cancelChange: () => setChanging(false),
    disconnect,
  }), [connection, provider, credential, keyStatus, keyError, models, modelsStatus, modelsError, accountEmail, changing, chooseDevneya, connectOpenAI, setDevneyaSession, clearDevneyaSession, reloadModels, reloadKey, disconnect]);

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
};
