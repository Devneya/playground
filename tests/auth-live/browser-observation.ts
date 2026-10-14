/** HTTP/2 pseudo-headers from Chromium are invalid names for Node's Headers. */
export const authObservationHeaders = (headers: Record<string, string>) => new Headers(
  Object.fromEntries(Object.entries(headers).filter(([name]) => ["apikey", "authorization"].includes(name.toLowerCase()))),
);

/** Keep only fixed grant labels; never record a URL's credential parameters. */
export const authObservationGrantType = (url: URL) => {
  const grant = url.searchParams.get("grant_type");
  return grant === "password" || grant === "pkce" || grant === "refresh_token" ? grant : null;
};
