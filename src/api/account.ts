import { config, apiUrl } from "../config";
import { fetchEmpty, fetchJson } from "./http";
import { toBifrostVirtualKey, type BifrostVirtualKey, type GoTrueAccessToken } from "./credentials";

export const getVirtualKey = async (jwt: GoTrueAccessToken, signal?: AbortSignal): Promise<BifrostVirtualKey> => {
  const body = await fetchJson(apiUrl("account/key"), { headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" } }, config.accountTimeoutMs, signal);
  if (typeof body !== "object" || body === null) throw new Error("Invalid account-key response.");
  return toBifrostVirtualKey((body as Record<string, unknown>).key);
};

export const revokeSession = async (jwt: GoTrueAccessToken, signal?: AbortSignal): Promise<void> => {
  await fetchEmpty(apiUrl("account/logout"), { method: "POST", headers: { Authorization: `Bearer ${jwt}` } }, config.accountTimeoutMs, signal);
};
