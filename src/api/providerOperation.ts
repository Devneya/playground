import { ApiError } from "./errors";

/** Combines a caller signal with one deadline for a whole multi-request operation. */
export const withProviderOperation = async <T>(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;
  const abortFromCaller = () => {
    callerAborted = true;
    controller.abort();
  };

  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const result = await operation(controller.signal);
    if (callerAborted || callerSignal?.aborted) throw new ApiError("aborted", "Request cancelled.");
    if (timedOut) throw new ApiError("timeout", "Request timed out.");
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.kind === "http") throw error;
    if (callerAborted || callerSignal?.aborted) throw new ApiError("aborted", "Request cancelled.");
    if (timedOut) throw new ApiError("timeout", "Request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
};
