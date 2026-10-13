export const PRODUCTION_URL: string;
export const MODEL: string;
export const MODELS_URL: string;
export const COMPLETIONS_URL: string;
export const MISSING_KEY_MESSAGE: string;
export const REQUEST_RESERVE_USD: number;
export class LiveTestFailure extends Error { constructor(category: string); category: string; }
export function safeFailure(error: unknown): { category: string; message: string };
export function assertLocalEnvironment(env: NodeJS.ProcessEnv): void;
export function expectedRelease(env: NodeJS.ProcessEnv): string;
export function resolveLocalPlatformKey(options?: { env?: NodeJS.ProcessEnv; read?: (path: string, encoding: string) => Promise<string> }): Promise<{ key: string; source: string }>;
export function containsSecret(value: string, key: string): boolean;
export function inspectRequest(options: { url: string; method: string; headers: Record<string, string>; body?: string; key: string; catalogKey?: string | null; expectedMessages?: Array<{ role: string; content: string }> | null; resourceType?: string }): { kind: string; postData?: string };
export type ReleaseAllowanceState = { runs: number; forwarded: number; reservedUsd: number; estimatedUsd: number };
export function createReleaseAllowance(state?: ReleaseAllowanceState, save?: (state: ReleaseAllowanceState) => void): {
  state: ReleaseAllowanceState;
  begin(): void;
  forward(): number;
  recordUsage(usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): { promptTokens: number; completionTokens: number; totalTokens: number; estimatedUsd: number };
  readonly runForwarded: number;
};
export function requireSuccessfulStatus(status: number, code?: string): void;
export function installRedirectGuard(context: import("playwright").BrowserContext, page: import("playwright").Page, onFailure: (error: LiveTestFailure) => void): Promise<void>;
export function parseLiveArguments(args: string[]): "live" | "preflight" | "cors";
export type CorsTarget = { endpoint: "models" | "chat/completions"; url: string; method: "GET" | "POST" };
export type CorsEndpointResult = {
  endpoint: "models" | "chat/completions";
  method: "GET" | "POST";
  preflight: { observed: boolean; status: number | null; requestedMethod: "GET" | "POST" | null; requestedHeaders: string[]; matches: boolean };
  response: { status: number | null; readable: boolean };
  failure: string | null;
};
export type CorsResult = {
  navigationStatus: number | null; originMatched: boolean; endpoints: CorsEndpointResult[];
  cleanup: { contextClosed: boolean; browserClosed: boolean }; failure: string | null;
};
export function createCorsCollector(targets?: CorsTarget[]): {
  observe(name: string, event: Record<string, unknown>): void;
  readable(endpoint: string, result: { readable: boolean; status: number | null; timedOut?: boolean }): void;
  finish(): CorsEndpointResult[];
};
export function assertCorsResult(result: CorsResult): void;
export function collectBrowserCors(options: {
  chromium: import("playwright").BrowserType; origin: string; navigationUrl: string; targets?: CorsTarget[];
  timeoutMs?: number; env?: NodeJS.ProcessEnv;
}): Promise<CorsResult>;
export function checkProductionCors(): Promise<CorsResult>;
export function prepareLiveRun<T>(options: {
  env: NodeJS.ProcessEnv;
  selectCredential: () => Promise<{ key: string; source: string }>;
  verifyRelease: (sha: string) => Promise<void>;
  checkCors: (sha: string) => Promise<CorsResult>;
  openAllowance: () => Promise<T>;
}): Promise<{ credential: { key: string; source: string }; sha: string; cors: CorsResult; budget: T }>;
