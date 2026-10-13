# Playground handoff

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

## Current hosted connections

- Fresh users see `Provide OpenAI/ChatGPT key` and
  `Start immediately with Devneya`. OpenAI setup checks the key with the
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

## Future: Sign in with ChatGPT

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

## Validation and UI coverage

Release preparation on 2026-10-13 used Node 22.23.2. All 321 unit tests and 54
mocked Chromium checks passed, along with typecheck, lint, coverage, both npm
audits (zero vulnerabilities), validation/mock/production builds, artifact
checks, and unchanged bundle budgets. Mock JavaScript is 1,002,857 bytes and
excludes the production auth vendor. A synthetic Chromium check verified that
the response-stage redirect guard preserves normal responses and prevents a
request to the redirect target. A second synthetic check confirmed that real
Chromium CORS blocking still applies while requests use `route.continue()`.

The release remains local on `release/openai-provider-setup`: credential
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

GitHub Actions keeps deterministic validation, mock browser integration, the
production build, and GitHub Pages deployment. The real-server Devneya E2E is
still an explicit local command (`npm run test:e2e:real`); it creates disposable
mailboxes/accounts and opens a Dodo test/sandbox checkout. It is not an Actions
job and is not part of the OpenAI live check.

The Pages build requires the Actions secret `VITE_SUPABASE_PUBLIC_KEY`, mapped
to `VITE_GOTRUE_ANON_KEY`; the build fails before artifact upload if that secret
is absent. `dist/release.json` records the full source commit SHA.

Before publishing, run the credential preflight. After deployment, run the
local OpenAI check against `https://playground.devneya.com`, using the deployed
full release SHA from `release.json`:

```sh
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
