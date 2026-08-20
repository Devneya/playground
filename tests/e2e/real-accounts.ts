import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

const mailApi = "https://api.mail.tm";
const apiOrigin = "https://api.devneya.com";
const mailTimeoutMs = 120_000;
const activationTimeoutMs = 180_000;

type MailAccount = {
  id: string;
  address: string;
  password: string;
  token: string;
};

export type RealTestAccount = MailAccount & {
  accessToken?: string;
  subscriptionActive: boolean;
};

const jsonRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), mailTimeoutMs);
  try {
    const response = await fetch(`${mailApi}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`Disposable-mail request failed (${response.status}).`);
    const body = await response.text();
    return (body ? JSON.parse(body) : undefined) as T;
  } finally {
    clearTimeout(timeout);
  }
};

const randomPassword = () => `Dvn!${randomBytes(18).toString("base64url")}9a`;

const activeMailDomain = async () => {
  const deadline = Date.now() + mailTimeoutMs;
  let lastError = "no active domain returned";
  while (Date.now() < deadline) {
    try {
      const domains = await jsonRequest<Array<{ domain?: string; isActive?: boolean }> | { "hydra:member"?: Array<{ domain?: string; isActive?: boolean }> }>("/domains?page=1");
      const members = Array.isArray(domains) ? domains : domains["hydra:member"] ?? [];
      const domain = members.find((candidate) => candidate.isActive !== false && candidate.domain)?.domain;
      if (domain) return domain;
      lastError = "no active domain returned";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown domain request error";
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Disposable-mail service returned no active domain within " + (mailTimeoutMs / 1000) + "s (" + lastError + ").");
};

export const createDisposableMailbox = async (): Promise<RealTestAccount> => {
  const domain = await activeMailDomain();
  const address = `devneya-release-${randomBytes(10).toString("hex")}@${domain}`;
  const password = randomPassword();
  const created = await jsonRequest<{ id?: string }>("/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  if (!created.id) throw new Error("Disposable-mail service returned no account id.");
  const session = await jsonRequest<{ token?: string }>("/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  if (!session.token) throw new Error("Disposable-mail service returned no mailbox token.");
  return { id: created.id, address, password, token: session.token, subscriptionActive: false };
};

export const deleteDisposableMailbox = async (account: RealTestAccount) => {
  await jsonRequest<unknown>(`/accounts/${encodeURIComponent(account.id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${account.token}` },
  }).catch((error: unknown) => {
    throw new Error(`Disposable-mail cleanup failed: ${error instanceof Error ? error.message : "unknown error"}`);
  });
};

type MailMessage = { id?: string; to?: Array<{ address?: string }>; text?: string; html?: string[] };

const decodeHtml = (value: string) => value
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

const confirmationUrlFrom = (message: MailMessage, expectedAddress: string, expectedOrigin: string) => {
  if (message.to && !message.to.some((recipient) => recipient.address === expectedAddress)) return null;
  const body = decodeHtml([message.text ?? "", ...(message.html ?? [])].join("\n"));
  const match = body.match(/https:\/\/api\.devneya\.com\/auth\/verify\?[^\s"'<>]+/);
  if (!match) return null;
  const url = new URL(match[0]);
  if (url.protocol !== "https:" || url.hostname !== "api.devneya.com" || url.pathname !== "/auth/verify") throw new Error("Signup email contained an invalid Devneya confirmation URL.");
  if (url.searchParams.get("type") !== "signup") throw new Error("Signup email confirmation URL had the wrong token type.");
  const redirect = url.searchParams.get("redirect_to");
  if (!redirect || new URL(redirect).origin !== new URL(expectedOrigin).origin) throw new Error("Signup email confirmation URL had the wrong redirect origin.");
  return url.toString();
};

export const waitForSignupConfirmation = async (account: RealTestAccount, expectedOrigin: string) => {
  const deadline = Date.now() + mailTimeoutMs;
  let lastMessageCount = 0;
  while (Date.now() < deadline) {
    const messages = await jsonRequest<MailMessage[] | { "hydra:member"?: MailMessage[] }>("/messages?page=1", { headers: { Authorization: `Bearer ${account.token}` } });
    const members = Array.isArray(messages) ? messages : messages["hydra:member"] ?? [];
    lastMessageCount = members.length;
    for (const summary of members) {
      if (!summary.id) continue;
      const message = await jsonRequest<MailMessage>(`/messages/${encodeURIComponent(summary.id)}`, { headers: { Authorization: `Bearer ${account.token}` } });
      const link = confirmationUrlFrom(message, account.address, expectedOrigin);
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for the signup confirmation email (${lastMessageCount} mailbox messages observed).`);
};

export const sessionAccessToken = async (page: Page) => page.evaluate(() => {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    const value = localStorage.getItem(key);
    if (!value) continue;
    try {
      const parsed = JSON.parse(value) as { access_token?: unknown };
      if (typeof parsed.access_token === "string" && parsed.access_token.length > 20) return parsed.access_token;
    } catch { /* unrelated local storage */ }
  }
  return null;
}).then((token) => {
  if (!token) throw new Error("The real browser session did not expose a GoTrue access token for the public account lifecycle.");
  return token;
});

const publicAccountRequest = async <T>(path: string, token: string, init: RequestInit = {}) => {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => null) as T;
  if (!response.ok) throw new Error(`Public account request ${path} failed (${response.status}).`);
  return body;
};

const locatorInFrames = async (page: Page, selectors: string[]) => {
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
  }
  return null;
};

const fillCheckoutField = async (page: Page, selectors: string[], value: string, required = true) => {
  const locator = await locatorInFrames(page, selectors);
  if (!locator) {
    if (required) throw new Error(`Dodo checkout field was not found: ${selectors[0]}`);
    return;
  }
  await locator.fill(value);
};

const clickCheckoutSubmit = async (page: Page) => {
  for (const frame of page.frames()) {
    const button = frame.getByRole("button", { name: /pay|subscribe|complete|confirm|start/i }).last();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
  }
  throw new Error("Dodo checkout submit button was not found.");
};

const expectTestCheckout = async (page: Page) => {
  const url = new URL(page.url());
  if (url.hostname !== "test.dodopayments.com" && !/test|sandbox/i.test(url.hostname + page.url())) throw new Error("Dodo checkout did not identify itself as test/sandbox mode; refusing payment submission.");
  await page.locator("input,button").first().waitFor({ state: "visible", timeout: 30_000 });
};

export const activateWithTestCheckout = async (page: Page, account: RealTestAccount, screenshot: (name: string, page: Page) => Promise<void>) => {
  if (!account.accessToken) throw new Error("Cannot activate an account before UI login.");
  const subscription = await publicAccountRequest<{ status?: string; checkout_url?: string }>("/account/subscribe", account.accessToken, { method: "POST" });
  if (subscription.status === "active") {
    account.subscriptionActive = true;
    return;
  }
  if (subscription.status !== "checkout" || !subscription.checkout_url) throw new Error("Public subscription API did not return an active status or checkout URL.");
  const checkoutUrl = new URL(subscription.checkout_url);
  if (checkoutUrl.protocol !== "https:" || !checkoutUrl.hostname.endsWith("dodopayments.com") || /(^|\.)live\./i.test(checkoutUrl.hostname)) throw new Error("Refusing to open a non-test Dodo checkout host.");
  const checkout = await page.context().newPage();
  try {
    await checkout.goto(checkoutUrl.toString(), { waitUntil: "domcontentloaded" });
    await expectTestCheckout(checkout);
    await fillCheckoutField(checkout, ["input[autocomplete='cc-number']", "input[name*='cardNumber' i]", "input[placeholder*='card number' i]"], "4242424242424242");
    await fillCheckoutField(checkout, ["input[autocomplete='cc-exp']", "input[name*='exp' i]", "input[placeholder*='MM' i]"], "06/32");
    await fillCheckoutField(checkout, ["input[autocomplete='cc-csc']", "input[name*='cvc' i]", "input[name*='cvv' i]", "input[placeholder*='CVC' i]"], "123");
    await fillCheckoutField(checkout, ["input[autocomplete='cc-name']", "input[name*='name' i]", "input[placeholder*='name' i]"], "Devneya Release Test");
    await fillCheckoutField(checkout, ["input[type='email']", "input[autocomplete='email']"], account.address, false);
    await fillCheckoutField(checkout, ["input[autocomplete='postal-code']", "input[name*='postal' i]", "input[placeholder*='postal' i]"], "94105", false);
    await clickCheckoutSubmit(checkout);
    await expect.poll(async () => (await publicAccountRequest<{ subscription_status?: string }>("/account/usage", account.accessToken!)).subscription_status, { timeout: activationTimeoutMs }).toBe("active");
    account.subscriptionActive = true;
    await screenshot(`dodo-test-checkout-${account.address.split("@")[0]}`, checkout);
  } finally {
    await checkout.close();
  }
};

export const cancelAndDeleteAccount = async (account: RealTestAccount) => {
  if (!account.accessToken) return;
  if (account.subscriptionActive) await publicAccountRequest("/account/subscribe/cancel", account.accessToken, { method: "POST" });
  await publicAccountRequest("/account", account.accessToken, { method: "DELETE" });
  const revoked = await fetch(`${apiOrigin}/account/usage`, { headers: { Authorization: `Bearer ${account.accessToken}` } });
  if (revoked.ok) throw new Error("Deleted test account token still accessed the public account API.");
  await deleteDisposableMailbox(account);
};
