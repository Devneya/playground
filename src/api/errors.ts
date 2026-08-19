export type ApiErrorKind = "network" | "timeout" | "http" | "invalid_response" | "aborted";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  constructor(kind: ApiErrorKind, message: string, status?: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    if (status !== undefined) this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export const errorFromResponse = async (response: Response): Promise<ApiError> => {
  let code: string | undefined;
  let message = response.statusText || `Request failed with status ${response.status}.`;
  try {
    const body: unknown = await response.clone().json();
    if (typeof body === "object" && body !== null) {
      const record = body as Record<string, unknown>;
      if (typeof record.error === "string") message = record.error;
      if (typeof record.code === "string") code = record.code;
    }
  } catch { /* keep the safe status message */ }
  return new ApiError("http", message, response.status, code);
};

export const normalizeApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;
  if (error instanceof DOMException && error.name === "AbortError") return new ApiError("aborted", "Request cancelled.");
  if (error instanceof TypeError) return new ApiError("network", "Network request failed.");
  return new ApiError("network", "Unexpected network error.");
};
