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
- Production stays on GoTrue plus Bifrost. Keep GoTrue JWTs and Bifrost virtual
  keys separate. Workspaces live in IndexedDB (`devneya-playground`,
  `workspaces`); no browser workspace or credentials are stored in Git.
- Changes debounce for 800 ms, with page-exit flush and explicit IndexedDB
  transaction commit. Camera zoom, focus, and user panning persist; placement
  uses measured box sizes.
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

Latest recorded results: 294 unit tests and 63 browser checks (54 mocked
Chromium plus 9 local UI checks) passed. Typecheck, lint, coverage, validation
build, and bundle budget passed. Hosted `npm run test:e2e` lacked
`PLAYGROUND_E2E_BASE_URL`. Live inference is explicit opt-in; no fresh live
inference ran in the latest validation.

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
