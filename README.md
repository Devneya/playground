## Devneya Playground

**Devneya Playground** — a spatial chat canvas: write, branch, compare, and follow thought on a mind-map board.

The clean-cutover flow playground for `playground.devneya.com`. It is a React + TypeScript + Vite static site deployed to GitHub Pages; runtime workspace data stays in this browser and is shared by its inference connections.

The spatial-chat look is the product: cream prompts, grey answers, yellow notes, overlay Context, grouped single-select models, and compact flow chrome. See `PRODUCT_NOTES.md`.

The current implementation and cross-machine resume notes are on
`release/openai-provider-setup`; see [HANDOFF.md](HANDOFF.md) for the current
two-provider release, historical browser authentication
research, and release prerequisites. Hosted Codex is deferred; existing local
Codex development support is retained.

### Local development

Node.js 22 and npm are required. The repository pins the supported major in .nvmrc and package.json.

```bash
nvm use
npm ci
npm run dev
```

For the Devneya connection, supply the approved public `VITE_GOTRUE_ANON_KEY`
through the process environment, with `VITE_API_BASE_URL=https://api.devneya.com`.
Keep credentials out of `.env` files, source, fixtures, and Git history.

On first launch, choose **Use OpenAI API key** or **Continue with Devneya**. The OpenAI choice requests a standard OpenAI API key, saves it in this browser's `localStorage`, and calls the authenticated `GET https://api.openai.com/v1/models` endpoint to validate it and load the live catalog. It sends no inference request during setup. ChatGPT subscriptions do not pay for API usage. The model picker uses those returned model IDs; choose a model manually because the catalog also contains models that may not support Chat Completions.

The Devneya choice uses GoTrue sign-in, obtains a Bifrost virtual key from `/account/key` with the GoTrue JWT, and sends completions to `/llm/v1/chat/completions` with only the Bifrost key. A 403 on `/account/key` is an inactive or blocked account, not CORS (playground origin is already allowed). Activate the plan on `https://app.devneya.com/`. Its catalog comes from `GET /llm/v1/models`. The top-right Connection menu provides Change connection and Disconnect; it also links to the Devneya Profile and Dashboard when connected there. Both actions retain the workspace and settle active runs as cancelled before changing screens. Disconnect removes the active connection, including the stored OpenAI key; Devneya Sign out is a separate action.

### Product boundaries

- Nodes are Text and Generation only. Text may be manual or a read-only generated result.
- Each Generation takes up to 8 Text inputs, graph cycles are rejected, and only successful results can be reused as inputs for threading.
- Each prompt selects one model. A run snapshots its inputs and instruction and records failures without retrying or overwriting results. Older execution histories retain their original shape.
- Named flows are persisted in one IndexedDB record (`devneya-playground`, `workspaces`, key `browser-workspace`) shared across providers and Devneya accounts in this browser. Existing older per-user records are left untouched.
- Workspace export/import uses the versioned `devneya-flow-v3` (older versions still import) JSON format.
- Supabase is used only for GoTrue auth; no Supabase database, storage, or realtime client is used.
- Provider credentials are kept separately from the workspace document and workspace exports.

### Verification

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm audit --omit=dev
npm audit
VITE_API_BASE_URL=https://api.devneya.com VITE_GOTRUE_ANON_KEY=validation-public-anon-key npm run build:validation
npm run verify:bundle
npm run build:mock
npm run verify:mock-artifact
npm run verify:bundle
npm run test:browser-integration -- --workers=1
npm run build:prod
npm run verify:artifact
npm run verify:bundle
git diff --check
```

Vitest covers domain transitions, execution lifecycle invalidation, provider API boundaries, persistence fallback and save coalescing, setup, connection replacement, and auth UI states. Mock-backed Playwright browser integration covers model fan-out, partial failure, cancellation, the shared browser workspace, export/import, and error responses. Real-server functional E2E remains a separate, explicit local command described below.

For deterministic browser integration without production credentials, use the mock build. It is test-only and is never deployed to GitHub Pages. These tests are not functional E2E.

The existing Devneya real-server functional E2E is an explicit local command, `npm run test:e2e:real`. It accepts `PLAYGROUND_E2E_BASE_URL` and optionally `E2E_TEST_MODEL`; each run creates two disposable mailboxes and accounts, confirms the real GoTrue email links, opens a Dodo test/sandbox checkout with the documented test card, verifies activation and shared browser workspace behavior, then cancels and deletes the accounts, revokes their tokens, and deletes the mailboxes. It is not run by GitHub Actions or by the OpenAI live release check.

Use `npm run test:browser-integration:evidence` for local mock-browser evidence, or `npm run test:e2e:real:evidence` for real-server evidence. Each command creates an ignored `release-evidence/<commit>/<timestamp>/` directory containing unaltered screenshots, isolated Playwright report/trace data when present, sanitized browser/network observations, an evidence summary, test metadata, and `SHA256SUMS`; evidence is local-only and must never be committed or uploaded. Mock browser integration is regression evidence, not functional E2E.

For a production deployment with Devneya sign-in enabled, provide the public GoTrue anonymous key, then run `npm run build:prod`, `npm run verify:artifact`, and `npm run verify:bundle`. A static build can also serve OpenAI connections without that key. The production bundle budget is 350 KB gzip JavaScript; the mock bundle has a separately reported 400 KB gzip allowance for its intentional MSW browser runtime.

The 2026-10-13 implementation checks passed: 330 unit tests, all 69 Chromium
browser checks, typecheck, lint, coverage, both audits (zero vulnerabilities),
validation/mock builds, and artifact/bundle inspection. The genuine production
CORS probe passed with upstream OPTIONS 200 and readable synthetic 401 for
both OpenAI endpoints; context/browser cleanup succeeded. Production-mode
compilation and inspection also pass without GoTrue configuration, but the
configured two-provider release is blocked by missing GitHub access, Platform
key, and approved public GoTrue configuration. No paid requests or deployment
occurred. See [HANDOFF.md](HANDOFF.md) for exact evidence and resume gates.

### Deployment

`.github/workflows/deploy.yml` validates every pull request and deploys only after validation on `main`. Deterministic checks, the mock artifact, browser integration, build, and Pages deployment stay in Actions; live provider checks run locally. The production build requires the GitHub Actions secret `VITE_SUPABASE_PUBLIC_KEY`, which the workflow maps to `VITE_GOTRUE_ANON_KEY`. If it is missing, the build stops before artifact upload. The uploaded `dist/` includes `release.json` with the full source commit SHA. `public/CNAME` keeps the custom domain `playground.devneya.com`. Full `npm audit` (including devDependencies) must be clean or Validate never reaches deploy.

Before publishing, require GitHub push/merge/Pages-settings access, the Actions
secret named below, the approved public GoTrue production configuration,
a successful credential preflight, and a successful synthetic CORS check.
After deployment, run the local OpenAI release check against `https://playground.devneya.com` with the deployed full release commit SHA:

```bash
node scripts/run-openai-live.mjs --check-cors
node scripts/run-openai-live.mjs --preflight
PLAYGROUND_RELEASE_SHA=<full-commit-sha> npm run test:e2e:openai:live
```

`npm run test:e2e` delegates to `npm run test:e2e:openai:live`. The live run requires `PLAYGROUND_RELEASE_SHA`, matching production `release.json`, and an enforced HTTP-to-HTTPS redirect. The runner reads the top-level `OPENAI_API_KEY` from `${CODEX_HOME}/auth.json` (when `CODEX_HOME` is set), or `/home/alex/.codex/auth.json`, then falls back to an existing `OPENAI_API_KEY` in the executing process environment. It transmits the key only in the HTTPS Authorization header directly to `api.openai.com`. It never uses OAuth tokens. The runner refuses CI and debug environments; a missing API key stops the release before publication. Preflight launches no browser and sends no API requests.

The live check makes exactly two non-streaming calls to `gpt-6-luna`. The UTF-8 serialized messages are limited to 4,096 bytes, and `max_completion_tokens` is 4,096 including reasoning. It does not retry. Setup has a 30-second limit and each completion has a 130-second limit. A release may have at most one corrective run, for a maximum of four calls and $0.10 total across the release. Failures are recorded only as sanitized categories such as 401, 403, model unavailable, quota, or CORS. The runner disconnects and cleans up its isolated context; ignored evidence is written only under `release-evidence/<sha>/<UTC>/openai-live` and contains sanitized data.

The ignored `release-evidence/openai-provider-setup-budget.json` ledger and exclusive lock enforce the allowance across corrective deployment SHAs. Keep the ledger throughout this release. Forwarded requests that fail or time out still count. There is no tracing, HAR, video, storage-state export, or automatic screenshot capture.

`--check-cors` reads no credential file and consumes no paid allowance. It
launches a fresh Chromium context with service workers blocked and validated
TLS, loads the production `robots.txt` origin, and sends a synthetic invalid
bearer to both OpenAI endpoints. CDP Network observation must see upstream
OPTIONS with the intended methods and header names, successful preflights,
and browser-readable 401 responses. No routing or Fetch interception is
installed in this context. Sanitized evidence, including cleanup and failures,
is saved under ignored `release-evidence/openai-cors/<UTC>/`.

The full runner checks credential selection, deployed release metadata, and
this genuine CORS result before opening the paid allowance. It retains CORS
evidence even if that stage fails, and reports it separately from guarded UI
inference. Exactly one runner mode is accepted: no option, `--preflight`, or
`--check-cors`. Historical Codex research in HANDOFF remains historical.

Publish the complete reviewed release branch through a PR to `main`. Wait for
checks on the reviewed head, record the latest successful Pages deployment SHA
as the rollback baseline, enable and verify Pages HTTPS enforcement, and
squash-merge with `--match-head-commit`. Wait for the merged SHA's exact push
workflow and deployment. Fresh requests must see HTTPS 200, an HTTP-to-HTTPS
redirect, matching `/release.json`, both setup choices, a protected artifact
without mocks or credentials, and Devneya configuration before the bounded
live command. Preserve the cumulative ledger across corrective deployments.

If a security issue or regression requires rollback after deployment, revert through a PR and preserve local-only CI or dependency patches while preparing it.

Required Actions secret:

- `VITE_SUPABASE_PUBLIC_KEY` (mapped by the workflow to `VITE_GOTRUE_ANON_KEY`)

### Local Codex playground

Run `npm run dev:codex` and open `http://127.0.0.1:3002/`. This uses the existing Codex sign-in on this computer. Available models and reasoning levels come from the live catalog; the local default prefers the requested `gpt-6.1-sol` when available. Open the model picker to search the live catalog; search receives focus automatically, and effort choices appear under the selected model. Requests default to xhigh when supported and request Fast service through `priority`; acceleration is not guaranteed. Credentials remain server-side. Hosted builds offer the two API-key and Devneya connections described above.

The canvas toolbar has neutral New prompt, Upload and Note buttons. New prompts and notes go into nearby free space, receive a brief highlight and focus for editing. Save as note creates an editable copy to the answer’s right, moving into nearby free space when needed. Canvas zoom and focus are saved per flow. New results stay above the bottom fifth of the canvas when space allows. The original prompt, answer and note boxes retain Georgia serif content typography and the Devneya wordmark.

Prompt drafts commit after 800ms of idle time and flush on blur, send or page leave. Workspace saves are debounced by 800ms. Consecutive edits share an undo entry. Answers stream with a received character count, model phase and elapsed time, plus a Stop control. Markdown renders in answers and notes; fenced code retains its spacing. Drawing requests produce passive SVG illustrations through the existing Codex sign-in. Drawings stay in the local IndexedDB workspace, travel with exports and notes, can be downloaded as SVG, and are included in follow-up context for revisions.

Click an answer or file’s left, right or bottom border dot to create a connected prompt on that side, or drag the dot onto empty canvas to place it. A sent prompt’s Fork creates an editable copy while the original answer continues, with a subtle dashed line showing its origin. Sent prompts retain the same box and input geometry. A connection’s hover delete control sits on its curve.

On an unsent prompt, open Context to exclude individual pieces with × or use Clear context to remove all prior pieces while keeping the current question. Exclusions change the actual request and persist locally. New connections add new context without restoring excluded pieces. Sent context remains a record of what was sent; fork the prompt to edit its copy.

Upload adds text/code or passive SVG (up to 64 KB), PNG/JPEG/WebP images or PDF files (up to 2 MB each) to neutral file boxes with type labels and previews. Existing safe SVG uploads also display a drawing preview; text sources remain available to inspect or edit. Connect a file box to a prompt to send its content with that request; uploading alone does not send it. Attachments persist in IndexedDB and JSON exports. Requests accept up to 4 MB of attachments, and file support depends on the chosen model. The Codex sign-in route supports inline attachments, not hosted bitmap image generation.

Export opens a menu with Workspace JSON for the editable workspace and Print / Save PDF for a reading copy of the active flow, including response drawings and uploaded images; PDF attachments are listed by name.

`npm run test:e2e:codex -- canvas-controls.spec.ts` checks model folders, effort requests, parallel forks, connector gestures, uploads, persistence and printable PDF output. Set `CANVAS_FILES_LIVE=1` to also test a real Codex request reading an uploaded PDF.

`npm run test:e2e:codex -- restored-canvas.spec.ts` tests a real completion, notes, forks and reload in Chromium. This uses Codex inference. `canvas-improvements.spec.ts` checks progress, Markdown, drawing downloads, persistence and revision context; its live drawing case runs only with `CANVAS_DRAW_LIVE=1`, or replays captured output with `CANVAS_DRAW_FIXTURE=tests/fixtures/codex-elephant.ndjson`. Other files in that test folder document retired experiments and are not checks of the current interface.
