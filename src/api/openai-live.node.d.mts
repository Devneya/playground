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
