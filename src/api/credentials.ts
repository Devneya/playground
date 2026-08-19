export type GoTrueAccessToken = string & { readonly __brand: "GoTrueAccessToken" };
export type BifrostVirtualKey = string & { readonly __brand: "BifrostVirtualKey" };

export const toGoTrueAccessToken = (value: unknown): GoTrueAccessToken => {
  if (typeof value !== "string" || value.length < 1) throw new Error("Missing GoTrue access token.");
  return value as GoTrueAccessToken;
};

export const toBifrostVirtualKey = (value: unknown): BifrostVirtualKey => {
  if (typeof value !== "string" || !value.startsWith("sk-bf-") || value.length <= 6) throw new Error("Invalid Bifrost virtual key.");
  return value as BifrostVirtualKey;
};
