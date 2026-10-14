export type AuthEmailType = "signup" | "recovery";

export type AuthEmailMessage = {
  to?: Array<{ address?: string }>;
  text?: string;
  html?: string[];
};

const decodeHtml = (value: string) => value
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

const messageUrls = (message: AuthEmailMessage) => {
  const body = decodeHtml([message.text ?? "", ...(message.html ?? [])].join("\n"));
  return body.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
};

const hasExpectedRecipient = (message: AuthEmailMessage, expectedAddress: string) => {
  const expected = expectedAddress.trim().toLowerCase();
  return Boolean(expected) && Boolean(message.to?.some(({ address }) => address?.trim().toLowerCase() === expected));
};

const isAuthVerificationUrl = (url: URL) => url.protocol === "https:"
  && url.origin === "https://api.devneya.com"
  && url.pathname === "/auth/verify"
  && !url.username
  && !url.password
  && !url.hash;

const hasExpectedRedirect = (url: URL, expectedOrigin: string) => {
  const redirectValues = url.searchParams.getAll("redirect_to");
  const [redirectValue] = redirectValues;
  if (redirectValues.length !== 1 || !redirectValue) return false;

  try {
    const redirect = new URL(redirectValue);
    const expected = new URL(expectedOrigin);
    return !redirect.username
      && !redirect.password
      && !expected.username
      && !expected.password
      && redirect.origin === expected.origin;
  } catch {
    return false;
  }
};

/** Finds the requested GoTrue verification link in a message addressed to this mailbox. */
export const authEmailLinkFrom = (
  message: AuthEmailMessage,
  expectedAddress: string,
  expectedOrigin: string,
  expectedType: AuthEmailType,
) => {
  if (!hasExpectedRecipient(message, expectedAddress)) return null;

  for (const candidate of messageUrls(message)) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (!isAuthVerificationUrl(url)) continue;

    const types = url.searchParams.getAll("type");
    if (types.length !== 1 || types[0] !== expectedType) continue;
    if (!hasExpectedRedirect(url, expectedOrigin)) continue;
    return url.toString();
  }

  return null;
};
