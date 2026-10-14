import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { Session } from "@supabase/supabase-js";
import { AUTH_STORAGE_KEY, createGoTrueClient, rewriteGoTrueAuthUrl } from "../../src/auth/createGoTrueClient";
import { createDisposableMailbox, deleteDisposableMailbox, waitForAuthEmail, type RealTestAccount } from "../e2e/real-accounts";

const api = "https://api.devneya.com";
const origin = "https://playground.devneya.com";
const redirectUrl = `${origin}/`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type Client = ReturnType<typeof createGoTrueClient>;
type Observation = { endpoint: string; method: string; status: number; clientKeyMatches: boolean | null; bearerHash: string | null; anonymousBearer: boolean };
class SmokeFailure extends Error {
  constructor(public readonly category: string) { super(category); }
}
const ensure: (condition: unknown, category: string) => asserts condition = (condition, category) => {
  if (!condition) throw new SmokeFailure(category);
};

test("real GoTrue lifecycle with a random public client value", async () => {
  const phase = process.env.PLAYGROUND_AUTH_SMOKE_PHASE;
  const key = process.env.VITE_GOTRUE_ANON_KEY ?? "";
  const baseline = process.env.PLAYGROUND_BASELINE_CLIENT_KEY ?? "";
  const evidenceDir = process.env.PLAYGROUND_AUTH_EVIDENCE_DIR;
  const observations: Observation[] = [];
  const issuedTokens = new Set<string>();
  const clients: Client[] = [];
  const memory = new Map<string, string>();
  const storage = { getItem: (name: string) => memory.get(name) ?? null, setItem: (name: string, value: string) => { memory.set(name, value); }, removeItem: (name: string) => { memory.delete(name); } };
  const steps: string[] = [];
  const cleanup = { accountDeleted: false, tokenRejected: false, mailboxDeleted: false, storageCleared: false, contextClosed: false, browserClosed: false, baselineUsedOnlyForCleanup: false };
  let stage = "configuration";
  let failure: string | null = null;
  let account: RealTestAccount | undefined;
  let registered = false;
  let confirmed = false;
  let pendingCode: string | undefined;
  let signupVerifier: string | undefined;
  let currentPassword = "";
  let accountId: string | undefined;
  let client: Client | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  const observe = (url: URL, method: string, headers: Headers, status: number) => {
    if (url.origin !== api) return;
    const bearer = headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
    observations.push({ endpoint: url.pathname, method, status, clientKeyMatches: headers.has("apikey") ? headers.get("apikey") === key : null, bearerHash: bearer ? digest(bearer) : null, anonymousBearer: bearer === key });
  };
  const timedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    ensure(url.origin === api, "unexpected_api_origin");
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    const signals = [AbortSignal.timeout(20_000), ...(init?.signal ? [init.signal] : [])];
    const response = await fetch(input, { ...init, signal: AbortSignal.any(signals) });
    observe(url, init?.method ?? (input instanceof Request ? input.method : "GET"), headers, response.status);
    return response;
  };
  const makeClient = async (clientKey = key) => {
    const instance = createGoTrueClient({ baseUrl: api, clientKey, storage, fetch: timedFetch });
    clients.push(instance);
    await instance.auth.initialize();
    instance.auth.stopAutoRefresh();
    return instance;
  };
  const authOk = (result: { error: { code?: string | undefined; status?: number | undefined } | null }, label: string) => {
    if (result.error) {
      const code = /^[a-z0-9_]+$/i.test(result.error.code ?? "") ? result.error.code : "rejected";
      throw new SmokeFailure(`${label}_${code}`);
    }
  };
  const remember = (session: Session | null) => {
    ensure(session?.access_token && session.refresh_token && session.user.id, "missing_authenticated_session");
    issuedTokens.add(digest(session.access_token));
    accountId = session.user.id;
    if (account) account.accessToken = session.access_token;
    return session;
  };
  const verifyEmail = async (type: "signup" | "recovery") => {
    ensure(account, "mailbox_missing");
    const link = await waitForAuthEmail(account, origin, type);
    const response = await fetch(link, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    ensure([301, 302, 303, 307, 308].includes(response.status), `${type}_verification_not_redirected`);
    const target = new URL(response.headers.get("location") ?? "", origin);
    ensure(target.origin === origin, "unexpected_confirmation_redirect");
    const code = target.searchParams.get("code");
    ensure(code, `${type}_verification_missing_pkce_code`);
    pendingCode = code;
    return code;
  };
  const signIn = async (instance: Client, password = currentPassword) => {
    ensure(account, "mailbox_missing");
    const result = await instance.auth.signInWithPassword({ email: account.address, password });
    authOk(result, "login");
    return remember(result.data.session);
  };
  const storedSession = async () => {
    ensure(page, "browser_missing");
    for (let attempt = 0; attempt < 100; attempt++) {
      const session = await page.evaluate((prefix) => {
        for (const name of Object.keys(localStorage)) {
          if (!name.startsWith(prefix)) continue;
          try {
            const value = JSON.parse(localStorage.getItem(name) ?? "null") as Session | null;
            if (value?.access_token && value.refresh_token && value.user?.id) return value;
          } catch { /* PKCE and unrelated records are not sessions. */ }
        }
        return null;
      }, `${AUTH_STORAGE_KEY}:`);
      if (session) return remember(session);
      await page.waitForTimeout(300);
    }
    throw new SmokeFailure("browser_session_missing");
  };
  const uiLogin = async (password = currentPassword, expectSuccess = true) => {
    ensure(page && account, "browser_account_missing");
    await page.getByLabel("Email", { exact: true }).fill(account.address);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    if (expectSuccess) {
      await page.locator(".canvas-shell").waitFor({ timeout: 30_000 });
      return storedSession();
    }
    await page.getByRole("alert").waitFor({ timeout: 20_000 });
    ensure(!(await page.locator(".canvas-shell").isVisible()), "invalid_login_accepted");
    return null;
  };
  const uiLogout = async () => {
    ensure(page, "browser_missing");
    await page.getByRole("button", { name: "Connection", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).waitFor({ timeout: 30_000 });
  };
  const waitForObservation = async (predicate: (observation: Observation) => boolean) => {
    ensure(page, "browser_missing");
    for (let attempt = 0; attempt < 100; attempt++) {
      if (observations.some(predicate)) return;
      await page.waitForTimeout(300);
    }
    throw new SmokeFailure("expected_auth_response_missing");
  };

  try {
    ensure(!process.env.CI && !process.env.DEBUG && !process.env.PWDEBUG && !process.env.NODE_OPTIONS?.includes("inspect"), "local_only_no_debug");
    ensure(phase === "prepublish" || phase === "deployed", "invalid_phase");
    ensure(key.startsWith("playground-public-client-") && !key.includes("."), "random_non_jwt_configuration_required");
    ensure(evidenceDir, "evidence_directory_required");
    if (phase === "deployed") {
      const sha = process.env.PLAYGROUND_RELEASE_SHA;
      ensure(sha && /^[a-f0-9]{40}$/.test(sha), "full_release_sha_required");
      const response = await fetch(`${origin}/release.json?auth-smoke=${Date.now()}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
      const release = await response.json() as { commit?: string };
      ensure(response.status === 200 && release.commit === sha, "deployed_sha_mismatch");
    }
    stage = "mailbox";
    account = await createDisposableMailbox();
    currentPassword = account.password;
    console.log(`Auth smoke (${phase}): disposable mailbox ready; no subscription or inference.`);

    if (phase === "prepublish") {
      client = await makeClient();
      stage = "signup";
      const signup = await client.auth.signUp({ email: account.address, password: currentPassword, options: { emailRedirectTo: redirectUrl } });
      authOk(signup, "signup");
      ensure(signup.data.user, "signup_user_missing");
      accountId = signup.data.user.id;
      registered = true;
      signupVerifier = memory.get(`${AUTH_STORAGE_KEY}-code-verifier`);
      stage = "signup_confirmation";
      const exchange = await client.auth.exchangeCodeForSession(await verifyEmail("signup"));
      authOk(exchange, "signup_exchange"); remember(exchange.data.session); confirmed = true; pendingCode = undefined;
      steps.push("signup_pkce_confirmation");
      console.log("Auth smoke: real signup and PKCE confirmation passed.");
      const user = await client.auth.getUser(); authOk(user, "user"); ensure(user.data.user?.email_confirmed_at, "email_not_confirmed");
      stage = "password_login";
      authOk(await client.auth.signOut(), "logout");
      const rejected = await client.auth.signInWithPassword({ email: account.address, password: "synthetic-invalid-password" });
      ensure(rejected.error?.code === "invalid_credentials" && !rejected.data.session, "invalid_login_wrong_failure");
      await signIn(client); steps.push("invalid_password_rejected", "password_login");
      stage = "refresh";
      const refresh = await client.auth.refreshSession(); authOk(refresh, "refresh"); remember(refresh.data.session);
      authOk(await client.auth.getUser(), "refreshed_user"); steps.push("refresh_authenticated_user");
      stage = "recovery";
      authOk(await client.auth.resetPasswordForEmail(account.address, { redirectTo: redirectUrl }), "recovery_request");
      const recovery = await client.auth.exchangeCodeForSession(await verifyEmail("recovery")); authOk(recovery, "recovery_exchange"); remember(recovery.data.session); pendingCode = undefined;
      const nextPassword = `Dvn!${randomBytes(18).toString("base64url")}9b`;
      authOk(await client.auth.updateUser({ password: nextPassword }), "password_update"); currentPassword = nextPassword;
      authOk(await client.auth.signOut(), "logout"); await signIn(client);
      steps.push("recovery_pkce_password_update", "updated_password_login", "signout");
      stage = "oauth_urls";
      for (const provider of ["google", "github"] as const) {
        const oauth = await client.auth.signInWithOAuth({ provider, options: { redirectTo: redirectUrl, skipBrowserRedirect: true } });
        authOk(oauth, "oauth_url"); ensure(oauth.data.url, "oauth_url_missing");
        const url = new URL(rewriteGoTrueAuthUrl(oauth.data.url, api));
        ensure(url.origin === api && url.pathname === "/auth/authorize" && url.searchParams.get("provider") === provider && url.searchParams.get("redirect_to") === redirectUrl && url.searchParams.has("code_challenge"), "oauth_url_invalid");
      }
      steps.push("oauth_urls_only");
    } else {
      stage = "browser_start";
      const launchEnv = { ...process.env };
      for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "OPENAI_API_KEY", "VITE_GOTRUE_ANON_KEY", "PLAYGROUND_BASELINE_CLIENT_KEY"]) delete launchEnv[name];
      browser = await chromium.launch({ env: launchEnv });
      context = await browser.newContext({ serviceWorkers: "block" });
      page = await context.newPage();
      page.on("response", (response) => {
        const request = response.request();
        const url = new URL(response.url());
        if (url.origin !== api) return;
        void request.allHeaders().then((headers) => observe(url, request.method(), new Headers(headers), response.status())).catch(() => undefined);
      });
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Continue with Devneya", exact: true }).waitFor();
      ensure(await page.getByRole("button", { name: "Use an API key", exact: true }).count() === 1, "setup_choices_missing");
      await page.getByRole("button", { name: "Continue with Devneya", exact: true }).click();
      stage = "browser_signup";
      await page.getByRole("button", { name: "Create an account", exact: true }).click();
      await page.getByLabel("Email", { exact: true }).fill(account.address);
      await page.getByLabel("Password", { exact: true }).fill(currentPassword);
      const signupResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/auth/signup" && response.request().method() === "POST");
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      const signup = await signupResponse;
      ensure(signup.status() === 200, "browser_signup_rejected"); registered = true;
      const signupBody = await signup.json() as { id?: string; user?: { id?: string } };
      accountId = signupBody.user?.id ?? signupBody.id;
      await page.getByRole("status").filter({ hasText: "Check your email" }).waitFor();
      stage = "browser_confirmation";
      await page.goto(await waitForAuthEmail(account, origin, "signup"), { waitUntil: "domcontentloaded" });
      await page.locator(".canvas-shell").waitFor({ timeout: 30_000 });
      await storedSession(); confirmed = true;
      steps.push("browser_signup_pkce_confirmation");
      console.log("Auth smoke: deployed browser signup and confirmation passed.");
      stage = "browser_login";
      await uiLogout(); await uiLogin("synthetic-invalid-password", false); await uiLogin();
      steps.push("browser_invalid_password_rejected", "browser_password_login", "browser_signout");
      stage = "browser_persistence";
      const prompt = page.getByLabel("Prompt 1 instruction", { exact: true });
      await prompt.fill("Auth release workspace persistence probe.");
      await page.waitForTimeout(1200);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".canvas-shell").waitFor(); await storedSession();
      ensure(await prompt.inputValue() === "Auth release workspace persistence probe.", "workspace_restore_failed");
      steps.push("browser_session_workspace_reload");
      stage = "browser_refresh";
      const refreshCount = observations.filter((item) => item.endpoint === "/auth/token" && item.status === 200).length;
      await page.evaluate((prefix) => {
        for (const name of Object.keys(localStorage)) {
          if (!name.startsWith(prefix)) continue;
          try {
            const session = JSON.parse(localStorage.getItem(name) ?? "null") as Session | null;
            if (session?.refresh_token && session.access_token) { session.expires_at = Math.floor(Date.now() / 1000) - 60; localStorage.setItem(name, JSON.stringify(session)); }
          } catch { /* Non-session records remain intact. */ }
        }
      }, `${AUTH_STORAGE_KEY}:`);
      await page.reload({ waitUntil: "domcontentloaded" }); await page.locator(".canvas-shell").waitFor();
      await waitForObservation(() => observations.filter((item) => item.endpoint === "/auth/token" && item.status === 200).length > refreshCount);
      const session = await storedSession();
      const userStatus = await page.evaluate(async ({ apiOrigin, token, clientKey }) => (await fetch(`${apiOrigin}/auth/user`, { headers: { apikey: clientKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })).status, { apiOrigin: api, token: session.access_token, clientKey: key });
      ensure(userStatus === 200, "browser_refreshed_user_rejected"); steps.push("browser_refresh_authenticated_user");
      stage = "browser_export";
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export options", exact: true }).click();
      await page.getByRole("button", { name: "Export workspace", exact: true }).click();
      const stream = await (await downloadPromise).createReadStream(); let exported = "";
      if (stream) for await (const chunk of stream) exported += chunk.toString();
      ensure(exported.length > 0 && ![key, session.access_token, session.refresh_token, currentPassword].some((value) => exported.includes(value)), "workspace_export_contains_credentials");
      steps.push("credential_free_workspace_export");
      stage = "browser_recovery";
      await uiLogout();
      await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
      await page.getByLabel("Email", { exact: true }).fill(account.address);
      await page.getByRole("button", { name: "Send recovery link", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "a recovery link" }).waitFor();
      await page.goto(await waitForAuthEmail(account, origin, "recovery"), { waitUntil: "domcontentloaded" });
      await page.getByLabel("New password", { exact: true }).waitFor({ timeout: 30_000 });
      const nextPassword = `Dvn!${randomBytes(18).toString("base64url")}9b`;
      await page.getByLabel("New password", { exact: true }).fill(nextPassword);
      await page.getByRole("button", { name: "Update password", exact: true }).click();
      await page.locator(".canvas-shell").waitFor({ timeout: 30_000 }); currentPassword = nextPassword;
      await storedSession(); await uiLogout(); await uiLogin();
      steps.push("browser_recovery_password_update", "browser_updated_password_login");
    }
    stage = "header_boundaries";
    ensure(observations.some((item) => item.anonymousBearer && item.clientKeyMatches && item.status === 200), "random_client_headers_not_observed");
    ensure(observations.some((item) => item.endpoint === "/auth/user" && item.status === 200 && item.bearerHash && issuedTokens.has(item.bearerHash) && !item.anonymousBearer), "issued_user_bearer_not_observed");
    ensure(!observations.some((item) => /chat\/completions|generateContent|\/messages$|\/subscribe/.test(item.endpoint)), "billing_or_inference_request_forbidden");
    console.log(`Auth smoke (${phase}): authentication lifecycle passed; cleaning up.`);
  } catch (error) {
    failure = error instanceof SmokeFailure ? error.category : `${stage}_unexpected_failure`;
  } finally {
    if (account) {
      if (registered) {
        try {
          let cleanupClient = await makeClient();
          if (!confirmed && phase === "prepublish") {
            if (signupVerifier) memory.set(`${AUTH_STORAGE_KEY}-code-verifier`, signupVerifier);
            const code = pendingCode ?? await verifyEmail("signup");
            const result = await cleanupClient.auth.exchangeCodeForSession(code);
            if (!result.error) { remember(result.data.session); confirmed = true; }
          }
          let login = await cleanupClient.auth.signInWithPassword({ email: account.address, password: currentPassword });
          if (login.error && baseline) {
            failure ??= "random_cleanup_login_rejected";
            cleanup.baselineUsedOnlyForCleanup = true;
            cleanupClient = await makeClient(baseline);
            if (!confirmed && phase === "prepublish") {
              if (signupVerifier) memory.set(`${AUTH_STORAGE_KEY}-code-verifier`, signupVerifier);
              const result = await cleanupClient.auth.exchangeCodeForSession(pendingCode ?? await verifyEmail("signup"));
              if (!result.error) { remember(result.data.session); confirmed = true; }
            }
            login = await cleanupClient.auth.signInWithPassword({ email: account.address, password: currentPassword });
          }
          authOk(login, "cleanup_login"); const session = remember(login.data.session);
          // The deployed legacy API compares revocation times at whole-second precision.
          // Delete in a later second so its cutoff covers this fresh cleanup token.
          await new Promise((resolve) => setTimeout(resolve, 1_200));
          const deleted = await timedFetch(`${api}/account`, { method: "DELETE", headers: { Authorization: `Bearer ${session.access_token}` } });
          ensure(deleted.ok, "account_delete_rejected"); cleanup.accountDeleted = true;
          const absent = await timedFetch(`${api}/auth/user`, { headers: { apikey: key, Authorization: `Bearer ${session.access_token}` } });
          ensure([401, 403, 404].includes(absent.status), "deleted_gotrue_user_still_present");
          const rejected = await timedFetch(`${api}/account/usage`, { headers: { Authorization: `Bearer ${session.access_token}` } });
          ensure([401, 403].includes(rejected.status), "deleted_account_token_not_rejected"); cleanup.tokenRejected = true;
        } catch (error) { failure ??= error instanceof SmokeFailure ? error.category : "account_cleanup_failed"; }
      } else { cleanup.accountDeleted = true; cleanup.tokenRejected = true; }
      if (cleanup.accountDeleted) {
        try { await deleteDisposableMailbox(account); cleanup.mailboxDeleted = true; } catch { failure ??= "mailbox_cleanup_failed"; }
      }
    }
    for (const instance of clients) instance.auth.stopAutoRefresh();
    memory.clear();
    if (context) {
      try { if (page) { await page.goto(`${origin}/robots.txt`); await page.evaluate(async () => { localStorage.clear(); sessionStorage.clear(); await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase("devneya-playground"); request.onsuccess = () => resolve(); request.onerror = () => reject(new Error("storage")); request.onblocked = () => reject(new Error("storage")); }); }); } cleanup.storageCleared = true; } catch { failure ??= "browser_storage_cleanup_failed"; }
      try { await context.close(); cleanup.contextClosed = true; } catch { failure ??= "context_cleanup_failed"; }
    } else { cleanup.storageCleared = true; cleanup.contextClosed = true; }
    if (browser) { try { await browser.close(); cleanup.browserClosed = true; } catch { failure ??= "browser_cleanup_failed"; } }
    else cleanup.browserClosed = true;
    let cleanupRecoveryFile: string | null = null;
    if (account && (!cleanup.accountDeleted || !cleanup.tokenRejected || !cleanup.mailboxDeleted)) {
      // Only generated disposable-account credentials; never browser storage or client keys.
      const recoveryDir = "/home/ubuntu/.cache/devneya-release-tools/auth-cleanup";
      mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
      cleanupRecoveryFile = join(recoveryDir, `${Date.now()}-${phase === "deployed" ? "deployed" : "prepublish"}.json`);
      writeFileSync(cleanupRecoveryFile, JSON.stringify({ account, currentPassword, accountId, accountDeleted: cleanup.accountDeleted, mailboxDeleted: cleanup.mailboxDeleted }), { mode: 0o600 });
    }
    const evidence = { phase, releaseSha: process.env.PLAYGROUND_RELEASE_SHA ?? null, fingerprint: digest(key), steps, observations: observations.map(({ bearerHash, anonymousBearer, ...item }) => ({ ...item, bearer: anonymousBearer ? "public-client" : bearerHash && issuedTokens.has(bearerHash) ? "issued-user" : bearerHash ? "other" : "none" })), cleanup, cleanupRecoveryFile, remainingAccountId: cleanup.accountDeleted ? null : accountId ?? null, failure, paidRequests: 0, externalOAuthConsentTested: false };
    if (evidenceDir) { mkdirSync(evidenceDir, { recursive: true }); writeFileSync(join(evidenceDir, `${phase === "prepublish" || phase === "deployed" ? phase : "invalid"}.json`), JSON.stringify(evidence, null, 2) + "\n"); }
  }
  if (failure) throw new Error(`Auth smoke failed: ${failure}. Publication must stop for analysis. Sanitized evidence retained.`);
});
