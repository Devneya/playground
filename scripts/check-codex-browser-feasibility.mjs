// Synthetic transport probe only: no credential files, login completion, or inference.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';

if (process.env.CI || process.env.DEBUG || process.env.PWDEBUG) {
  console.error('Run this synthetic probe locally without CI or Playwright debug logging.');
  process.exit(1);
}

const productionOrigin = 'https://playground.devneya.com';
// Public identifier observed in Codex 0.160.0; not a hosted-app registration.
const publicClientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
const dummyBearer = 'invalid-codex-token-for-browser-feasibility-test';
const targets = [
  { name: 'codex_models', url: 'https://chatgpt.com/backend-api/codex/models?client_version=0.160.0', method: 'GET', headers: 'authorization,chatgpt-account-id' },
  { name: 'codex_responses', url: 'https://chatgpt.com/backend-api/codex/responses', method: 'POST', headers: 'authorization,chatgpt-account-id,content-type' },
  { name: 'oauth_token_native', url: 'https://auth.openai.com/oauth/token', method: 'POST', headers: 'content-type' },
  { name: 'oauth_token_documented', url: 'https://auth.openai.com/api/accounts/oauth/token', method: 'POST', headers: 'content-type' },
  { name: 'device_usercode', url: 'https://auth.openai.com/api/accounts/deviceauth/usercode', method: 'POST', headers: 'content-type' },
  { name: 'device_poll', url: 'https://auth.openai.com/api/accounts/deviceauth/token', method: 'POST', headers: 'content-type' },
  { name: 'codex_models_authorization_only', url: 'https://chatgpt.com/backend-api/codex/models?client_version=0.160.0', method: 'GET', headers: 'authorization' },
  { name: 'codex_responses_without_account_header', url: 'https://chatgpt.com/backend-api/codex/responses', method: 'POST', headers: 'authorization,content-type' },
  { name: 'platform_models_control', url: 'https://api.openai.com/v1/models', method: 'GET', headers: 'authorization' },
];
const timestamp = new Date().toISOString();
const evidenceDir = resolve('release-evidence', 'codex-feasibility', timestamp.replaceAll(':', '-'));
const summary = { timestamp, productionOrigin, nativeVersion: '0.160.0', syntheticCredentialsOnly: true, actualLoginCompleted: false, inferenceRequests: 0, preflights: [], browser: {}, authorizationRedirectChecks: [] };
const category = error => {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'timeout';
  const code = error?.cause?.code ?? error?.code;
  return ({ ENOTFOUND: 'dns', EAI_AGAIN: 'dns', EACCES: 'sandbox_permission', EPERM: 'sandbox_permission', ECONNREFUSED: 'connection_refused', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'certificate' })[code] ?? 'network_or_runtime';
};
const corsHeaders = headers => ({ allowOrigin: headers.get('access-control-allow-origin'), allowMethods: headers.get('access-control-allow-methods'), allowHeaders: headers.get('access-control-allow-headers'), allowCredentials: headers.get('access-control-allow-credentials') });

await Promise.all(targets.map(async target => {
  const started = Date.now();
  let result;
  try {
    const response = await fetch(target.url, { method: 'OPTIONS', redirect: 'manual', headers: { Origin: productionOrigin, 'Access-Control-Request-Method': target.method, 'Access-Control-Request-Headers': target.headers }, signal: AbortSignal.timeout(15000) });
    result = { status: response.status, ...corsHeaders(response.headers) };
    await response.body?.cancel();
  } catch (error) { result = { category: category(error) }; }
  summary.preflights.push({ name: target.name, url: target.url, requestedMethod: target.method, requestedHeaders: target.headers, milliseconds: Date.now() - started, ...result });
}));

try {
  const response = await fetch('https://auth.openai.com/.well-known/openid-configuration', { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (response.ok) {
    const data = await response.json();
    summary.discovery = { status: response.status, issuer: data.issuer, authorizationEndpoint: data.authorization_endpoint, tokenEndpoint: data.token_endpoint, tokenEndpointAuthMethods: data.token_endpoint_auth_methods_supported };
  } else { summary.discovery = { status: response.status }; await response.body?.cancel(); }
} catch (error) { summary.discovery = { category: category(error) }; }

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
for (const redirectUri of ['http://localhost:1455/auth/callback', `${productionOrigin}/auth/codex/callback`]) {
  const url = new URL('https://auth.openai.com/oauth/authorize');
  url.search = new URLSearchParams({ client_id: publicClientId, response_type: 'code', redirect_uri: redirectUri, scope: 'openid profile email offline_access', code_challenge: challenge, code_challenge_method: 'S256', state: randomBytes(16).toString('hex'), codex_cli_simplified_flow: 'true', originator: 'codex_cli_rs' }).toString();
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const location = response.headers.get('location');
    let locationSummary = null;
    if (location) {
      const next = new URL(location, url);
      locationSummary = { origin: next.origin, pathname: next.pathname, error: /^[a-z_]+$/.test(next.searchParams.get('error') ?? '') ? next.searchParams.get('error') : null };
    }
    const body = (await response.text()).slice(0, 200000).toLowerCase();
    summary.authorizationRedirectChecks.push({ redirectUri, status: response.status, location: locationSummary, mentionsRedirectUri: body.includes('redirect_uri'), mentionsInvalidRedirect: /invalid.{0,60}redirect|redirect.{0,60}(invalid|not allowed|not registered|mismatch)/.test(body), cloudflareChallenge: /cf-chl-|just a moment/.test(body) });
  } catch (error) { summary.authorizationRedirectChecks.push({ redirectUri, category: category(error) }); }
}

let browser, context, page;
try {
  for (const name of ['DBUS_SESSION_BUS_ADDRESS','DBUS_SESSION_BUS_ADDRESS_FILE','GNOME_KEYRING_CONTROL','GNOME_KEYRING_PID','DBUS_STARTER_ADDRESS','DBUS_STARTER_BUS_TYPE']) delete process.env[name];
  const browserEnv = { ...process.env };
  for (const name of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_FEDERATION_RULE_ID','OPENAI_IDENTITY_TOKEN_FILE','DEBUG','PWDEBUG']) delete browserEnv[name];
  browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--password-store=basic'], env: browserEnv });
  context = await browser.newContext({ serviceWorkers: 'block', ignoreHTTPSErrors: false });
  // Do not use Playwright routing: it synthesizes OPTIONS preflight responses.
  summary.browser.requestInterception = false;
  page = await context.newPage();
  const events = [], requests = new Map();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['https://api.devneya.com/*', 'https://*.supabase.co/*'] });
  cdp.on('Network.requestWillBeSent', event => {
    const target = targets.find(item => item.url === event.request.url);
    if (target) requests.set(event.requestId, { name: target.name, method: event.request.method });
  });
  cdp.on('Network.responseReceived', event => {
    const request = requests.get(event.requestId);
    if (!request) return;
    const cors = Object.fromEntries(Object.entries(event.response.headers).filter(([key]) => key.toLowerCase().startsWith('access-control-allow-')).map(([key, value]) => [key.toLowerCase(), String(value).replace(/[\r\n]+/g, ', ')]));
    const headers = { get: name => cors[name.toLowerCase()] ?? null };
    events.push({ ...request, status: event.response.status, ...corsHeaders(headers) });
  });
  cdp.on('Network.loadingFailed', event => {
    const request = requests.get(event.requestId);
    if (request) events.push({ ...request, category: event.corsErrorStatus ? 'cors' : event.errorText === 'net::ERR_ABORTED' ? 'body_cancelled_after_status_read' : 'network', corsError: event.corsErrorStatus?.corsError ?? null });
  });
  const production = await page.goto(`${productionOrigin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (new URL(page.url()).origin !== productionOrigin) throw new Error('origin_changed');
  summary.browser.productionStatus = production.status();
  summary.browser.actualOrigin = new URL(page.url()).origin;
  const tokenForm = new URLSearchParams({ grant_type: 'authorization_code', client_id: publicClientId, code: 'invalid-authorization-code-for-feasibility-test', code_verifier: verifier, redirect_uri: `${productionOrigin}/auth/codex/callback` }).toString();
  const browserTests = [
    { name: 'codex_models_authorization_only', url: targets[0].url, method: 'GET', headers: { Authorization: `Bearer ${dummyBearer}` } },
    { name: 'oauth_token_native', url: targets[2].url, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenForm },
    { name: 'oauth_token_documented', url: targets[3].url, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenForm },
    { name: 'platform_models_control', url: 'https://api.openai.com/v1/models', method: 'GET', headers: { Authorization: 'Bearer invalid-openai-key-for-browser-feasibility-control' } },
  ];
  summary.browser.requestShapes = browserTests.map(test => ({ name: test.name, method: test.method, url: test.url, headerNames: Object.keys(test.headers) }));
  summary.browser.results = await page.evaluate(async tests => await Promise.all(tests.map(async test => {
    const started = Date.now();
    try {
      const response = await fetch(test.url, { method: test.method, headers: test.headers, ...(test.body ? { body: test.body } : {}), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
      await response.body?.cancel();
      return { name: test.name, readable: true, status: response.status, milliseconds: Date.now() - started };
    } catch (error) { return { name: test.name, readable: false, errorName: error.name, milliseconds: Date.now() - started }; }
  })), browserTests);
  summary.browser.networkEvents = events;
  summary.browser.syntheticAuthorizationCodeOnly = true;
  summary.browser.noResponsesPostSent = true;
} catch (error) { summary.browser.failureCategory = /executable doesn't exist/i.test(error.message ?? '') ? 'missing_browser_executable' : category(error); }
finally {
  summary.cleanup = {};
  if (context) {
    try {
      await context.clearCookies();
      if (page && !page.isClosed() && new URL(page.url()).origin === productionOrigin) await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      summary.cleanup.isolatedStorageCleared = true;
    } catch { summary.cleanup.isolatedStorageCleared = false; }
    try { await context.close(); summary.cleanup.contextClosed = true; } catch { summary.cleanup.contextClosed = false; }
  }
  if (browser) { try { await browser.close(); summary.cleanup.browserClosed = true; } catch { summary.cleanup.browserClosed = false; } }
}
summary.preflights.sort((a,b) => a.name.localeCompare(b.name));
await mkdir(evidenceDir, { recursive: true });
await writeFile(`${evidenceDir}/summary.json`, JSON.stringify(summary, null, 2) + '\n');
await copyFile(fileURLToPath(import.meta.url), `${evidenceDir}/probe.mjs`);
console.log(JSON.stringify({ evidenceDir, summary }, null, 2));
