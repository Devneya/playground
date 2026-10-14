# Playground handoff

## Current provider-picker implementation — 2026-10-14

Branch: `feature/api-key-provider-picker`, based on the complete prepared
`release/openai-provider-setup` HEAD `c5e520e78c44de59f015c04b19da1247366be67d`.
This scope supersedes the previous two-provider setup below. The canvas and
existing local Codex implementation are retained.

Setup puts **Continue with Devneya** first. **Use an API key** reveals OpenAI,
Anthropic, Google Gemini, OpenRouter, Groq, Mistral, DeepSeek, and Custom
OpenAI-compatible. Keys stay in one active browser connection record, outside
the shared IndexedDB workspace and exports. Existing OpenAI records still
restore. Provider changes settle active runs as cancelled and retain the canvas.
API-key model selection is manual. Setup loads live catalogs without inference;
OpenRouter checks `/api/v1/key` before its public catalog.

Custom requires an HTTPS base URL, bearer key, and live `/models` catalog.
No manual models, HTTP loopback, arbitrary headers, or inferred version paths.
Requests use small HTTP adapters: existing OpenAI, compatible Chat Completions,
Anthropic Messages, and Gemini generateContent. No new SDK dependencies;
coverage and bundle limits remain fixed. Hosted Codex remains deferred.

The 2026-10-14 synthetic upstream browser research found readable authentication
responses for the named providers (Anthropic requires the browser-access
header). This is transport evidence, not real-key validation or live inference.
Ignored research summary: `release-evidence/provider-research/summary-2026-10-14.json`.
The local browser suite separately observes actual OPTIONS on different
loopback ports without routing or service workers, including native headers
and custom base paths. Keep the existing `--check-cors`, `--preflight`, and
bounded OpenAI certification commands below; only their UI selectors change.

Final implementation checks passed on Node 22.23.2: typecheck, lint, **412 unit
checks in 54 files**, coverage, production/full audits (zero vulnerabilities),
validation/mock/production builds, artifact checks, unchanged bundle budgets,
and **91 Chromium browser tests** with one worker. This includes all eight
provider journeys, native delayed cancellation in both directions, expanded
form accessibility, and actual OPTIONS acceptance/rejection on local ports.
Checked whole coverage: 96.73% statements / 93.35% branches; API coverage:
99.69% statements / 96.77% branches. `git diff --check` passed.

Configured production artifact: 20 files, 794,112 JavaScript bytes / 233,705 gzip.
Validation: 794,145 / 233,633. Mock: 1,021,353 / 340,610. No dependencies or
bundle/coverage limits changed. Production inspection now also rejects the
new synthetic provider keys. The final `dist/` is the production artifact.
It uses the public anonymous configuration already served by the existing
production site; `/auth/settings` returned HTTP 200, and the configured build,
production-artifact inspection, and bundle check passed. The key was selected
in memory from the deployed artifact and was not recorded in evidence or files.

The genuine OpenAI CORS command passed with observed upstream OPTIONS 200,
readable synthetic 401 responses, and successful context/browser cleanup.
Evidence: `release-evidence/openai-cors/2026-10-14T07-42-29-305Z/cors.json`.
Local check logs and summary: `release-evidence/api-key-provider-picker/`.
Credential preflight and `npm run test:e2e` stopped before browser launch or
network access because the Platform key is missing. Zero paid requests,
inference tokens, and $0.00 estimated cost for this work and the cumulative
release. The budget ledger remains absent and was not initialized.

Implementation commit: `c06a644c18c566ac20a46f17c9d94e35ce001e40`
(`Add API-key provider picker`). The operator has authorized committing and
publishing the complete branch. Preserve the portable zero-usage ledger and
existing live-run caps and lock policy. Never substitute the synthetic
validation configuration for production configuration.

### Release-access findings — 2026-10-14

- GitHub access is available through the configured Git credential helper.
  Repository API checks confirmed push and admin permissions. An empty
  `gh auth status` result only describes the CLI's login store; it does not
  establish that Git's existing credential is unavailable. Capture helper
  output privately and supply its token only through the `GH_TOKEN` process
  environment when invoking `gh`; never echo `git credential fill` output,
  helper definitions, or token values. The temporary local wrapper
  `/tmp/playground-gh-via-git.py` implements this without storing a token.
  A new GitHub device login is unnecessary; the earlier device code expired.
- `gh secret list` confirmed the existing Actions secret
  `VITE_SUPABASE_PUBLIC_KEY`. The workflow maps it to
  `VITE_GOTRUE_ANON_KEY`; listing reveals names, not values. No new key or
  secret is required. This anonymous key is public browser configuration
  for the GoTrue authentication client, distinct from user JWTs, Bifrost
  virtual keys, and provider inference keys. Existing production already
  publishes it, and its read-only authentication check passed.
  The current key requirement comes from initializing the full
  `@supabase/supabase-js` client: its constructor rejects an empty key, and
  `src/auth/gotrueClient.ts` adds an explicit missing-key guard. Do not infer
  that standalone GoTrue inherently requires a Supabase project key.
  A separate `GET https://api.devneya.com/auth/settings` probe returned 200
  with neither `apikey` nor `Authorization`. That public endpoint does not
  prove that signup, login, refresh, recovery, and OAuth callbacks all work
  without the key. An auth-only client could remove the SDK constructor
  dependency, but that migration and full auth verification are separate
  work; this release retains the existing client and working configuration.
- Pages HTTPS enforcement is now enabled. The API reports
  `https_enforced: true`; HTTP returned 301 to the expected HTTPS origin,
  which returned 200 with normal TLS validation. This settings change did
  not deploy the provider-picker source.
- The remaining credential prerequisite is the local OpenAI Platform key
  for the agreed preflight and bounded live release certification. Hosting
  the static app and users supplying their own API keys do not require an
  application-owned OpenAI key. Keep the pre-merge release gate until that
  local credential is available. No paid request has been forwarded.

Current remote PR/check/deployment state belongs in ignored release evidence;
record final certification there without changing the certified source commit.
These findings supersede the missing-access/configuration assumptions in the
dated historical sections below.

## Previous two-provider release scope — 2026-10-13

Repository: `Devneya/playground`, branch `release/openai-provider-setup`.
Publish the complete reviewed branch, including the accepted spatial canvas
work. The current release offers exactly **Use OpenAI API key** and
**Continue with Devneya**. Hosted Codex is deferred. The dated authentication
research below records historical exploration, not a third release choice.
Existing local `dev:codex` support is retained.

Read this file and `PRODUCT_NOTES.md` before editing. Use Node 22.23.2 from
`.nvmrc`, `npm ci`, and `npx playwright install --with-deps chromium`.
Keep GoTrue JWTs, Bifrost virtual keys, and Platform keys separate. Workspaces
stay in the existing IndexedDB browser-workspace record across providers.
No application API or persistence migration is required.

Release implementation now includes a genuine browser preflight check for
both OpenAI endpoints. The synthetic `--check-cors` mode reads no credential
file, sends no paid inference, and observes actual OPTIONS via CDP Network
without routing or Fetch interception. The full runner checks credential
selection, deployed metadata, and genuine CORS before opening the allowance.
CORS evidence survives an early failure under ignored `release-evidence/`.

Publication requires GitHub push/merge/Pages settings access, an available
Platform API key, approved public GoTrue configuration through the process
environment, and the Actions secret `VITE_SUPABASE_PUBLIC_KEY`. Secret listing
cannot retrieve its value. Keep credentials out of chat, shell arguments,
`.env` files, source, tests, logs, and Git history. The runner still prefers
the supported top-level auth-file key over the process environment and
rejects OAuth-only credentials.

The saved portable ledger establishes zero forwarded completions and $0.00
usage; no later live usage is recorded. Keep the ignored cumulative ledger
and lock across machines and corrective deployments. At most two live runs,
four forwarded paid requests, and $0.10 estimated usage are permitted. Never
reset the ledger or remove a lock belonging to an active process.

## Previous implementation validation — 2026-10-13

The two-provider implementation is finished locally on the release branch.
Node 22.23.2 and GitHub CLI 2.102.0 were installed outside the repository with
verified checksums. Typecheck, lint, 330 unit tests in 50 files, coverage,
production/full audits (zero vulnerabilities), validation build, mock build,
artifact checks, bundle budgets, and all 69 Chromium browser checks passed.
The browser suite includes eight provider regressions and seven genuine CORS
regressions on separate local HTTP ports. The checked whole coverage group is
96.01% statements and 92.06% branches; thresholds and dependency ranges are
unchanged. `git diff --check` passed.

The final production-mode build and its artifact/bundle checks passed:
20 files, 781,669 JavaScript bytes, 229,967 gzip bytes. It has no mock runtime
or synthetic credentials. This machine has no approved public GoTrue value,
so that local artifact does not configure Devneya sign-in and is not a valid
two-provider release artifact. A configured protected production build and
Actions secret verification remain publication gates. The mock artifact has
21 files, 1,004,045 JavaScript bytes, and 335,852 gzip bytes.

The final `--check-cors` run at 2026-10-13 16:09 UTC passed from the fixed
production origin: both endpoints had observed upstream OPTIONS 200 with
matching requested methods/headers and readable synthetic 401 responses.
Its isolated context and browser both closed. Evidence is local and ignored:
`release-evidence/openai-cors/2026-10-13T16-09-34-446Z/cors.json`.
Deterministic check logs and the sanitized implementation summary are under
`release-evidence/implementation-checks/`.

Credential preflight and `npm run test:e2e` both stopped with the fixed missing
Platform-key message before browser launch or network activity. No paid run
began: this turn and the cumulative release each have zero forwarded paid
requests, zero inference tokens, and $0.00 estimated cost. The cumulative
ledger remains absent and was not initialized; the portable zero-usage record
above still applies.

The operator requested finishing code and checks while reporting blockers.
GitHub authentication, a Platform key, and approved public GoTrue configuration
are absent. The Actions secret's presence could not be inspected without
GitHub access. No PR, push, merge, deployment, HTTPS setting change, or rollback
was performed. The existing deployment baseline later in this file is a saved
historical value; refresh the latest successful Pages deployment immediately
before an eventual merge. Publication and two-completion live certification
remain incomplete.

## Accepted direction

- Keep the original React Flow boxes with Georgia serif content and neutral
  notes/files. Panoramic, lane, and chat replacements were rejected.
- Sent prompts keep their text and draft geometry. Each prompt has one model by
  default; future multi-model work needs a separate product decision.
- See [PRODUCT_NOTES.md](PRODUCT_NOTES.md) for current interaction details.

## Local development and boundaries

- Run `npm ci`, then `npm run dev:codex`; local Codex mode is at
  `http://127.0.0.1:3002`. The existing machine Codex sign-in is used by the
  server-side bridge in `src/api/local-codex.mjs`; no credentials belong in Git.
- The bridge requests Fast/priority service and uses xhigh effort by default
  when supported. SVG drawings are passive vectors. Upload limits: text/SVG
  64 KB, image/PDF 2 MB each, and 4 MB total per request.
- Hosted setup offers OpenAI API-key and Devneya GoTrue/Bifrost connections.
  Keep GoTrue JWTs, Bifrost virtual keys, and OpenAI API keys separate.
- Workspaces live in one IndexedDB record (`devneya-playground`, `workspaces`,
  key `browser-workspace`) shared across providers and Devneya accounts in the
  browser. Older per-user records are left untouched. No credentials or browser
  workspace data are stored in Git.
- Changes debounce for 800 ms, with page-exit flush and explicit IndexedDB
  transaction commit. Camera zoom, focus, and user panning persist; placement
  uses measured box sizes.

## Previous hosted connections — 2026-10-13

- Fresh users see `Use OpenAI API key` and
  `Continue with Devneya`. OpenAI setup checks the key with the
  authenticated `GET https://api.openai.com/v1/models` catalog request; it does
  not send inference. The chosen catalog is shown in the existing model picker,
  and model selection remains manual because the list includes non-chat models.
- The OpenAI API key is saved in this browser's `localStorage`. API billing
  is separate from the ChatGPT subscription. OpenAI requests use
  `POST /v1/chat/completions` directly from the browser.
- Devneya uses GoTrue for sign-in, `/account/key` to obtain the Bifrost virtual
  key, and the Devneya `/llm/v1` OpenAI-compatible endpoints. OpenAI selection
  does not initialize GoTrue or use Devneya API settings.
- The upper-right Connection menu offers Change connection and Disconnect.
  Both providers keep the same canvas; provider credentials are never included
  in workspace exports.
- For suitable independent delegation, `AGENTS.md` calls for `gpt-6-luna` with
  xhigh reasoning when that is expected to save total time and tokens.

## Historical authentication discussion — 2026-10-13

The historical exploration proposed three explicit choices: **Devneya**,
**OpenAI API**, and **Codex**. Hosted Codex is now deferred; this proposal is not current release scope. The current code has two hosted setup buttons and an existing
`local-codex` adapter used by `npm run dev:codex`; a selectable hosted Codex
connection has not been implemented.

Endpoint and credential mechanics:

- `https://chatgpt.com/backend-api/codex/responses` and
  `https://api.openai.com/v1/responses` are different inference endpoints.
  The HTTP flows use HTTPS, JSON, bearer credentials, and Responses-style
  streaming events. Similar transport does not establish identical accepted
  fields, model access, or catalog shapes.
- The local bridge in `src/api/local-codex.mjs` reads the machine's cached
  `tokens.access_token` and optional `tokens.account_id`, then sends the bearer
  token and applicable `ChatGPT-Account-ID` to the Codex backend. It uses
  Responses requests with `stream: true` and `store: false`, and keeps the
  credentials in the server runtime. This explains how local Playground use
  can use the existing Codex sign-in without a separately supplied Platform
  key. It does not establish that any particular historical test was live.
- An OpenAI SDK can be configured to send equivalent HTTP requests in
  principle: use `https://chatgpt.com/backend-api/codex` as the base URL,
  without `/responses`, because `responses.create` appends that route. Passing
  an OAuth token as `api_key` places it in the bearer header; it does not
  perform Codex login or OAuth token renewal. Use a valid Codex credential,
  applicable account headers, and a compatible request. This exact SDK plus
  Codex-backend configuration has not been live-verified here; the existing
  bridge uses `fetch`.
- API keys and OAuth access tokens have the same bearer-header mechanism but
  represent different authorization and usage accounts. A Platform API key
  belongs to the Platform billing context. A Codex ChatGPT sign-in uses the
  ChatGPT identity and its entitlements. A separate Sign in with ChatGPT grant
  with `chatgpt.tokens.use.direct` can authorize eligible public Responses API
  calls using ChatGPT plan usage; do not assume a cached Codex login token has
  that grant.

References: [Codex backend and account headers](https://learn.chatgpt.com/docs/enterprise/sign-in-with-chatgpt-through-a-gateway),
[OpenAI SDK configuration](https://developers.openai.com/api/reference/python),
[public API ChatGPT-plan inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
and [Sign in with ChatGPT scopes and eligibility](https://developers.openai.com/siwc/quickstart).

Historical proposed setup presentation: `Continue with Devneya`, `Use OpenAI API key`,
and `Use Codex`. Remove the ambiguous `OpenAI/ChatGPT key` label. Keep one
active connection and the same canvas across all three, with separate
credentials, authenticated catalogs, connection validation, and disconnect
behavior.

The user rejected the local-helper recommendation for the Codex option.
The third connection must not depend on a local companion server. Whether
this means browser OAuth sign-in or entry of an existing Codex access token
is still being clarified; do not present token entry as an OAuth login.
A static hosted page cannot read the machine's `auth.json`. Browser OAuth
requires a supported registration, redirect and token flow with the
applicable eligibility. Direct browser calls using an entered Codex token
require verification of the actual browser request path, including CORS;
Node HTTP compatibility alone does not establish browser compatibility.
The existing Vite bridge accepts same-origin local requests only. No
credential value is recorded in these notes.

Runtime clarification: the production React app executes API calls in the
browser. Node.js builds the static files; GitHub Pages runs no Node.js API
server. The existing local Codex mode instead makes upstream calls through
the Node.js Vite bridge. CORS is enforced by browsers for cross-origin script
requests, not by native HTTP clients such as Node.js or curl. Such clients
still need valid credentials, applicable headers, and compatible requests;
the CORS findings alone do not verify authenticated inference.

Other documented Codex authentication mechanisms include Platform API-key
login, ChatGPT sign-in, enterprise Codex access tokens for trusted automation,
and workload identity federation for eligible managed workspaces. Browser
and device-code sign-in are ways to obtain the ChatGPT OAuth credential,
not additional inference providers. Availability and credentials must be
checked on the machine where work resumes. See [Codex authentication](https://learn.chatgpt.com/docs/auth),
[enterprise access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens),
and [workload identity federation](https://developers.openai.com/api/docs/guides/workload-identity-federation).

Browser-sign-in feasibility was rechecked against the official docs on
2026-10-13. OAuth can issue an access token after a browser authorization and
code exchange with PKCE; it does not retrieve the cached Codex credential.
The documented hosted website flow requires a registered OAuth client,
callback, and backend, and is currently a limited partner trial. Its standard
identity-only contract does not require an inference access token. ChatGPT
plan inference needs its own authorized scopes. The publicly documented OSS
self-registration flow requires a `127.0.0.1` callback listener and uses the
public Responses API, so it does not establish a helper-free static hosted
flow or native Codex-backend access. The desired browser-sign-in UX is still
conditional on a supported hosted inference registration and runtime.

### Actual browser feasibility checks — 2026-10-13

A fresh local Chromium context loaded `https://playground.devneya.com`
(HTTPS 200) and tested cross-origin requests with synthetic credentials.
No real access token, refresh token, or API key was transmitted; no inference
request or completed login occurred. Service workers were blocked, certificate
validation stayed enabled, and Playwright request routing was disabled for
the decisive run so the browser's real CORS preflights were preserved.

- Codex `/models` returned HTTP 400 to the actual browser OPTIONS request,
  without `Access-Control-Allow-Origin`. Chromium then reported
  `PreflightMissingAllowOriginHeader` and did not send the authenticated GET.
  Independent OPTIONS requests to Codex `/responses` also returned 400 with
  no allowed origin, both with and without the optional account header.
  Therefore direct browser calls to the native Codex backend are currently
  blocked from this production origin before token authentication.
- Both native and documented OAuth token endpoints returned browser-readable
  errors (401 and 400 respectively) for an invalid authorization code, with
  `Access-Control-Allow-Origin: *`. Device-code creation and polling endpoint
  OPTIONS requests returned 200 with that allowed origin. This establishes
  cross-origin reachability, not a completed or authorized sign-in; the earlier
  blanket claim that browser token exchange cannot work was too broad.
- The public OpenAI `/v1/models` control passed its real browser preflight
  and returned a readable 401 for a synthetic invalid API key.
- Read-only inspection of the current Codex token's declared scopes found
  neither `chatgpt.tokens.use.direct` nor `resource.invoke`. The token was
  decoded locally, and only these boolean findings were saved. The separate
  documented public Responses plan-usage flow requires its own grant;
  changing the native Codex token's destination is not an established solution.
- Synthetic native authorization requests with both loopback and production
  callback URLs encountered Cloudflare challenge responses. They do not prove
  whether the hosted callback is accepted. Hosted app eligibility, a valid
  login, renewal, model access, and inference were not verified. The already
  observed Codex API CORS failure rules out the proposed direct native-backend
  browser connection regardless of that callback question.

Chromium was closed and the isolated context was cleared. Sanitized results,
verification assertions, and the synthetic probe are in the ignored local
directory `release-evidence/codex-feasibility/2026-10-13T14-43-29.261Z/`.

Portable record of the decisive run (2026-10-13 14:43:29 UTC):

| Check | Observed result |
| --- | --- |
| Production HTTPS origin | 200, `https://playground.devneya.com` |
| Browser Codex model OPTIONS | 400, no allowed origin; `PreflightMissingAllowOriginHeader` |
| Codex Responses OPTIONS, with/without account header | Both 400, no allowed origin; no inference POST sent |
| Native OAuth token endpoint, synthetic invalid code | Browser-readable 401, allowed origin `*` |
| Documented OAuth token endpoint, synthetic invalid code | Browser-readable 400, allowed origin `*` |
| Device-code creation/polling OPTIONS | Both 200, allowed origin `*`; no device login attempted |
| Public OpenAI models control | OPTIONS 200, browser-readable invalid-key 401, allowed origin `*` |
| Native authorization callback checks | Both 403 Cloudflare challenge; callback acceptance inconclusive |
| Scope inspection of this machine's cached token | Neither direct-plan-usage nor resource-invoke grant declared |
| Credential transmission / inference / cost | Synthetic values only / zero / $0.00 |
| Cleanup | Isolated storage cleared, context and Chromium closed |

Reproduce the synthetic transport probe from the repository root after
installing dependencies and Chromium:

```sh
npm ci
npx playwright install chromium
node scripts/check-codex-browser-feasibility.mjs
```

The tracked probe uses no credential file and never completes login or sends
inference. It makes actual network requests from this machine, writes a
sanitized summary and a copy of itself under ignored `release-evidence/`, and
uses the public native client identifier only for invalid-code diagnostics.
That identifier is not a registered hosted application. Run it locally with
CI and Playwright debug logging unset. Inspect the recorded results; endpoint
reachability does not imply granted inference permission.

Testing caveat: this installed Playwright version synthesizes OPTIONS 204
responses when Chromium request routing is enabled, even when a handler uses
`route.continue()`. Its source implements this in `coreBundle.js` under
`isInterceptedOptionsPreflight`. Response-level CORS still applies, but routed
tests alone cannot establish that the real server accepts preflights. The
current OpenAI release runner uses an independent unrouted genuine-preflight
check before publication/live certification; the earlier synthetic response-CORS
test did not establish that property.

## Deferred research: Sign in with ChatGPT

Checked 2026-10-04 against [OpenAI's Sign in with ChatGPT docs](https://developers.openai.com/siwc/quickstart): **plan-funded inference is feasible for an eligible open-source local client.** An eligible user can explicitly grant `chatgpt.tokens.use.direct`; Plus/Pro plan usage or available credits can then cover eligible requests without an API key. This calls the public Responses API using the user's OAuth access token. It does not sign Devneya into ChatGPT's website, embed ChatGPT Web, expose their chats/GPTs, or reuse a browser session. ChatGPT identity alone does not grant inference permission.

Implementation notes:

- Keep this as an optional, separate connection. The current `dev:codex`
  bridge reads the machine's Codex credentials; do not treat or store those as
  Sign in with ChatGPT credentials. Keep this token set distinct from GoTrue
  sessions and Bifrost virtual keys.
- For the open-source/local flow, use the official dynamic OAuth client flow:
  PKCE, fresh state and nonce, a loopback callback on `127.0.0.1`, and a stable
  opaque `ext_agent_host_id`. Save the issued per-account `client_id`; do not
  save `dynamic_agent_client`. Validate the ID token and granted scopes, then
  protect and refresh access/refresh tokens in the local server runtime. Keep
  tokens out of browser storage, logs, source, and exports.
- Build the model picker from the signed-in account's `GET /v1/models` catalog
  and confirm access by completing inference. OpenAI's example uses
  `gpt-6.1-sol`; do not assume every model or reasoning effort in the existing
  Codex catalog is available under every ChatGPT account/workspace.
- Send requests to `POST /v1/responses` with `store: false`, `stream: true`,
  and the required conversation history in each request. Follow the preview's
  unsupported-field and tool limits. It accepts image/file inputs when the
  model supports them, but **does not support image generation**; keep current
  local SVG drawing behavior separate.
- Explain in the UI that the user is opting to spend ChatGPT plan usage, offer
  a link to ChatGPT Usage settings, and show when a request uses that plan.
  Plus usage draws from the shared five-hour allowance across apps; do not
  advertise a separate Devneya allowance. See [usage UI guidance](https://developers.openai.com/siwc/ui-ux-guidelines),
  [OAuth and account handling](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
  [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
  and [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
- Scope boundary: OpenAI documents plan usage for open-source/local clients
  and selected private clients; paid or remotely hosted offerings must go
  through its interest process. The separate “Sign in on your website”
  identity integration is currently a limited trial for selected commercial
  partners. Treat this repo's localhost playground as the candidate first
  integration; do not enable plan-funded inference on the hosted Devneya app
  until OpenAI confirms eligibility.

## Previous validation and local UI coverage

Cross-machine handoff checks on 2026-10-13 passed typecheck, lint, all 321 unit
tests, coverage (96.01% statements, 92.06% branches), the tracked probe's
syntax check, and `git diff --check`. That previous repeat used
Node 22.14.0 on that previous machine; the earlier full release gates below
used the pinned 22.23.2.
`npm run test:e2e` was attempted again and stopped with the fixed missing-key
message before launching Chromium or making API requests. No additional live
usage was incurred. The synthetic probe was made portable and syntax/lint
checked; its saved network findings come from the earlier decisive run.

Release preparation on 2026-10-13 used Node 22.23.2. All 321 unit tests and 54
mocked Chromium checks passed, along with typecheck, lint, coverage, both npm
audits (zero vulnerabilities), validation/mock/production builds, artifact
checks, and unchanged bundle budgets. Mock JavaScript is 1,002,857 bytes and
excludes the production auth vendor. A synthetic Chromium check verified that
the response-stage redirect guard preserves normal responses and prevents a
request to the redirect target. A second synthetic check confirmed that real
Chromium CORS blocking still applies while requests use `route.continue()`.

The release is prepared on `release/openai-provider-setup`: credential
preflight failed because the active Codex auth file has ChatGPT sign-in only
and the executing environment has no Platform key. No OpenAI live request, PR,
merge, deployment, or HTTPS setting change was made. The refreshed existing
Pages deployment SHA is `4e928547f9582727e35310b25546d910b176eb60`; its Pages job
succeeded and its later Devneya live job failed. HTTPS enforcement remains
disabled. The production build used the already-public deployed GoTrue anon
configuration in memory; no credential file or build secret was created.

For current local UI coverage, run:

```sh
npm run test:e2e:codex -- \
  tests/codex-local/canvas-navigation.spec.ts \
  tests/codex-local/typing-performance.spec.ts \
  tests/codex-local/file-presentation.spec.ts \
  tests/codex-local/canvas-controls.spec.ts \
  tests/codex-local/canvas-improvements.spec.ts
```

The other `tests/codex-local/` specs include retained experiments and historical
fixtures. Captured-output fixtures replay prior model responses; they do not
perform live inference. Retired experiments remain in code and persistence for
history/compatibility, but are not mounted and are not current acceptance.

## Release checks

The prepared lockfile contains compatible patches: `brace-expansion` 1.1.21
and 5.0.12, `source-map-js` 1.2.2, and `undici` 8.11.2. Keep dependency ranges
and bundle budgets unchanged; do not use `npm audit fix --force`.

GitHub Actions keeps deterministic validation, mock browser integration, the
production build, and GitHub Pages deployment. The real-server Devneya E2E is
still an explicit local command (`npm run test:e2e:real`); it creates disposable
mailboxes/accounts and opens a Dodo test/sandbox checkout. It is not an Actions
job and is not part of the OpenAI live check.

The Pages build requires the Actions secret `VITE_SUPABASE_PUBLIC_KEY`, mapped
to `VITE_GOTRUE_ANON_KEY`; the build fails before artifact upload if that secret
is absent. `dist/release.json` records the full source commit SHA.

Before publishing, require both the synthetic CORS check and credential preflight. After deployment, run the
local OpenAI check against `https://playground.devneya.com`, using the deployed
full release SHA from `release.json`:

```sh
node scripts/run-openai-live.mjs --check-cors
node scripts/run-openai-live.mjs --preflight
PLAYGROUND_RELEASE_SHA=<full-commit-sha> npm run test:e2e:openai:live
```

`npm run test:e2e` delegates to `npm run test:e2e:openai:live`. The runner reads
the top-level `OPENAI_API_KEY` from `${CODEX_HOME}/auth.json` when set, or
`/home/alex/.codex/auth.json`, then falls back to an existing `OPENAI_API_KEY`
in the executing process environment. The key is transmitted only in the
HTTPS Authorization header directly to `api.openai.com`.
It never uses OAuth tokens and refuses CI or debug environments. Missing the
key is a stop before publication.

Standard pricing was rechecked on 2026-10-13 against the official
[GPT-6 Luna model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna):
$0.10 per million input tokens and $0.50 per million output tokens. Cost
reports remain estimates. The official
[Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
confirms that the completion cap includes reasoning tokens.

Each live run makes exactly two non-streaming `gpt-6-luna` calls. Serialized
messages may use at most 4,096 UTF-8 bytes; `max_completion_tokens` is 4,096,
including reasoning. There are no retries, a 30-second setup limit, and a
130-second completion limit. Allow at most one corrective run per release:
four calls and $0.10 total across the release. Only sanitized categories
(401/403, model unavailable, quota, or CORS) are recorded. The runner
disconnects and cleans up its isolated context. Sanitized evidence goes only
under the ignored `release-evidence/<sha>/<UTC>/openai-live` directory.
The ignored `release-evidence/openai-provider-setup-budget.json` ledger and
exclusive lock enforce the allowance across corrective deployment SHAs. Keep
the ledger for the entire release; a crashed run's reserved requests still count.

For a security issue or regression after deployment, roll back through a PR
and preserve local-only CI and dependency patches while preparing the revert.
Stop live requests on 401, 403, unavailable `gpt-6-luna`, or quota/rate limits;
never substitute a model or claim a pass. CORS evidence uses the browser's
actual response availability and sanitized diagnostics; do not bypass it or
add a proxy. A targeted application fix needs affected deterministic gates,
republishing, and the single corrective run. An unresolved regression or
security failure requires a new revert PR, the release gates, and Pages
redeployment; never reset or force-push `main`. Report a failed rollback as
incomplete restoration.

## Saved publication procedure

Publication remains pending and must stop while local credential preflight
fails. Require the genuine-preflight result before certifying browser
compatibility. Rerun the full deterministic gates on Node 22.23.2: typecheck,
lint, unit tests, coverage, production and full audits, validation build and
bundle check, mock build/artifact/bundle checks, browser integration with one
worker, then production build/artifact/bundle checks and `git diff --check`.
Finish with the production artifact because mock builds overwrite `dist/`.

Use GitHub CLI 2.102.0 and verify `gh auth status` before GitHub operations.
This Linux machine has the pinned Node and CLI under
`/home/ubuntu/.cache/devneya-release-tools/`; prepend their `bin` directories
to PATH in each new shell.
Create the PR from `feature/api-key-provider-picker` to `main` with title
`Add API-key providers and local production verification`; describe
the actual final behavior and checks without credentials or local evidence.
Wait for required checks on the final reviewed head and squash-merge normally
with `--match-head-commit`; respect required reviews and merge queues. Before merging, refresh
the last successful Pages deployment SHA; the saved baseline is
`4e928547f9582727e35310b25546d910b176eb60`.

Enable Pages HTTPS enforcement with:

```sh
gh api --method PUT repos/Devneya/playground/pages -F https_enforced=true
```

Wait for the merged SHA's workflow to build and deploy. Require valid
production HTTPS 200, HTTP redirecting to HTTPS, `/release.json` matching the
merge SHA, the fresh setup screen, and an artifact without mock code or API
keys. Then run the local OpenAI test with that SHA. It must complete all
scenarios with exactly two successful `gpt-6-luna` responses, numeric usage,
and successful persisted OpenAI executions. The final execution report must
give the URL, deployed SHA, actual gates, request count/usage/cost, ignored
evidence path, and cleanup result. Do not claim deployment or live verification
complete based only on the preparation checks or synthetic Codex probes.
