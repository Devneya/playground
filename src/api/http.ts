import { ApiError, errorFromResponse, normalizeApiError } from "./errors";

export const composeSignals = (signals: Array<AbortSignal | undefined>, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  active.forEach((signal) => signal.aborted ? controller.abort() : signal.addEventListener("abort", onAbort, { once: true }));
  const cleanup = () => { clearTimeout(timer); active.forEach((signal) => signal.removeEventListener("abort", onAbort)); };
  return { signal: controller.signal, cleanup };
};

const throwForAbort = (composed: ReturnType<typeof composeSignals>, callerSignal?: AbortSignal): never => {
  if (callerSignal?.aborted) throw new ApiError("aborted", "Request cancelled.");
  throw new ApiError("timeout", "Request timed out.");
};

export const fetchJson = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<unknown> => {
  const composed = composeSignals([signal], timeoutMs);
  try {
    const response = await globalThis.fetch(input, { ...init, signal: composed.signal });
    if (!response.ok) throw await errorFromResponse(response);
    return await response.json();
  } catch (error) {
    const normalized = normalizeApiError(error);
    if (composed.signal.aborted && normalized.kind !== "http") throwForAbort(composed, signal);
    throw normalized;
  } finally { composed.cleanup(); }
};

export const fetchEmpty = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<void> => {
  const composed = composeSignals([signal], timeoutMs);
  try {
    const response = await globalThis.fetch(input, { ...init, signal: composed.signal });
    if (!response.ok) throw await errorFromResponse(response);
  } catch (error) {
    const normalized = normalizeApiError(error);
    if (composed.signal.aborted && normalized.kind !== "http") throwForAbort(composed, signal);
    throw normalized;
  } finally { composed.cleanup(); }
};
