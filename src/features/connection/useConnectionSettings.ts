import { createContext, useContext } from "react";
import type { BrowserConnection } from "../../api/browserConnection";
import type { CompletionCredential, GoTrueAccessToken } from "../../api/credentials";
import type { InferenceProvider, Model } from "../../domain/types";

export type { InferenceProvider };
export type AsyncStatus = "idle" | "loading" | "ready" | "error";

export type ConnectionSettings = {
  connection: BrowserConnection | null;
  provider: InferenceProvider | null;
  credential: CompletionCredential | null;
  keyStatus: AsyncStatus;
  keyError: string | null;
  models: Model[];
  modelsStatus: AsyncStatus;
  modelsError: string | null;
  accountEmail: string | null;
  changing: boolean;
  chooseDevneya(): void;
  connectOpenAI(key: string, signal: AbortSignal): Promise<void>;
  setDevneyaSession(token: GoTrueAccessToken, email: string | null): Promise<void>;
  clearDevneyaSession(): void;
  reloadModels(): void;
  reloadKey(): void;
  changeConnection(): void;
  cancelChange(): void;
  disconnect(): void;
};

export const ConnectionContext = createContext<ConnectionSettings | null>(null);

export const useConnectionSettings = () => {
  const settings = useContext(ConnectionContext);
  if (!settings) throw new Error("Connection settings require ConnectionProvider.");
  return settings;
};
