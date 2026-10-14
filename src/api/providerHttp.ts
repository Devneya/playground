import type { ApiKeyConnection } from "./credentials";
import { providerBaseURL, providerHeaders, providerLabel } from "./apiKeyProviders";
import { ApiError } from "./errors";

/** Caller owns the single operation deadline; keys never enter URLs or error bodies. */
export const fetchProviderJson = async (connection: ApiKeyConnection, path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> => {
  const base = new URL(providerBaseURL(connection));
  const url = new URL(`${base.href.replace(/\/+$/, "")}/${path}`);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname.replace(/\/+$/, "")}/`) || url.username || url.password || url.hash) throw new ApiError("invalid_response", "Invalid provider request destination.");
  if (signal.aborted) throw new ApiError("aborted", "Request cancelled.");
  try {
    const response = await globalThis.fetch(url, { ...init, headers: { ...providerHeaders(connection), ...(init.headers as Record<string, string> | undefined) }, mode: "cors", credentials: "omit", redirect: "error", signal });
    if (!response.ok) {
      const label = providerLabel(connection.provider);
      const message = response.status === 401 || response.status === 403 ? `${label} rejected the API key or access.` : response.status === 429 ? `${label} rate limit or quota reached.` : `${label} rejected the request (${response.status}).`;
      throw new ApiError("http", message, response.status);
    }
    try { return await response.json(); } catch { throw new ApiError("invalid_response", "The provider returned invalid JSON."); }
  } catch (error) {
    if (signal.aborted) throw new ApiError("aborted", "Request cancelled.");
    if (error instanceof ApiError) throw error;
    throw new ApiError("network", "Provider request failed. Check the network and browser CORS support.");
  }
};
