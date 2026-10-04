## Devneya Playground

**Devneya Playground** — a spatial chat canvas: write, branch, compare, and follow thought on a mind-map board.

The clean-cutover flow playground for `playground.devneya.com`. It is a React + TypeScript + Vite static site deployed to GitHub Pages; runtime workspace data stays in the signed-in user’s browser.

The spatial-chat look is the product: cream prompts, grey answers, yellow notes, overlay Context, grouped single-select models, and compact flow chrome. See `PRODUCT_NOTES.md`.

### Local development

Node.js 22 and npm are required. The repository pins the supported major in .nvmrc and package.json.

```bash
nvm use
npm ci
npm run dev
```

Optional `.env.local` values:

```env
VITE_API_BASE_URL=https://api.devneya.com
VITE_GOTRUE_ANON_KEY=...
```

The app discovers models from `GET /llm/v1/models`, obtains a Bifrost virtual key from `/account/key` using the GoTrue JWT, and sends completions to `/llm/v1/chat/completions` with only the Bifrost key. A 403 on `/account/key` is an inactive or blocked account, not CORS (playground origin is already allowed). Activate the plan on `https://app.devneya.com/`. Live models are the API catalog, not the mock four-provider list. The account menu links Profile and Dashboard there; Sign out stays in playground.

### Product boundaries

- Nodes are Text and Generation only. Text may be manual or a read-only generated result.
- Each Generation takes up to 8 Text inputs, graph cycles are rejected, and only successful results can be reused as inputs for threading.
- A run snapshots its inputs and instruction, creates one result per selected model, runs models concurrently, and records failures without retrying or overwriting results.
- Named flows are persisted in IndexedDB (`devneya-playground`, `workspaces`) under the authenticated user ID.
- Workspace export/import uses the versioned `devneya-flow-v3` (older versions still import) JSON format.
- Supabase is used only for GoTrue auth; no Supabase database, storage, or realtime client is used.

### Verification

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build:validation
npm run verify:bundle
npm run build:mock
npm run verify:mock-artifact
npm run verify:bundle
npm run test:browser-integration
```

Vitest covers domain transitions, execution lifecycle invalidation, API boundaries, persistence fallback and save coalescing, and auth UI states. Mock-backed Playwright browser integration covers model fan-out, partial failure, cancellation, isolation, export/import, and error responses. Real-server functional E2E is a separate mandatory release gate.

For deterministic browser integration without production credentials, use the mock build. It is test-only and is never deployed to GitHub Pages. These tests are not functional E2E.

For real-server functional E2E, set `PLAYGROUND_E2E_BASE_URL` to the deployed pre-production or production HTTPS URL and optionally `E2E_TEST_MODEL`, then run `npm run test:e2e:real`. This is the mandatory real pre-production/production functional gate: it never uses mocks or stored user credentials. Each run creates two disposable mailboxes, registers real accounts, confirms the real GoTrue email link, logs in, opens only a Dodo test/sandbox checkout with the documented test card, verifies activation, exercises the app, verifies two-account isolation, cancels and deletes the accounts, revokes their tokens, deletes the mailboxes, and fails on any lifecycle or test failure. Screenshots are captured only when `EVIDENCE_DIR` is set.

Use `npm run test:browser-integration:evidence` for local mock-browser evidence, or `npm run test:e2e:real:evidence` for real-server evidence. Each command creates an ignored `release-evidence/<commit>/<timestamp>/` directory containing unaltered screenshots, isolated Playwright report/trace data when present, sanitized browser/network observations, an evidence summary, test metadata, and `SHA256SUMS`; evidence is local-only and must never be committed or uploaded. Mock browser integration is regression evidence, not functional E2E.

For a protected production build, provide the real public GoTrue anonymous key, then run `npm run build:prod`, `npm run verify:artifact`, and `npm run verify:bundle`. The production bundle budget is 350 KB gzip JavaScript; the mock bundle has a separately reported 400 KB gzip allowance for its intentional MSW browser runtime.

### Deployment

`.github/workflows/deploy.yml` validates every pull request and deploys only after validation on `main`. The build publishes the `dist/` artifact through GitHub Pages. `public/CNAME` keeps the custom domain `playground.devneya.com`. Full `npm audit` (including devDependencies) must be clean or Validate never reaches deploy. Post-deploy real E2E can fail on an external disposable-mail 502 even when Pages succeeded.

Required Actions secret:

- `VITE_GOTRUE_ANON_KEY`

### Local Codex playground

Run `npm run dev:codex` and open `http://127.0.0.1:3002/`. This uses the existing Codex sign-in on this computer. Available models and reasoning levels come from the live catalog; the local default prefers the requested `gpt-6.1-sol` when available. Open the model picker to search the live catalog; search receives focus automatically, and effort choices appear under the selected model. Requests default to xhigh when supported and request Fast service through `priority`; acceleration is not guaranteed. Credentials remain server-side. Hosted builds continue to use the Devneya API.

The canvas toolbar has neutral New prompt, Upload and Note buttons. New prompts and notes go into nearby free space, receive a brief highlight and focus for editing. Save as note creates an editable copy to the answer’s right, moving into nearby free space when needed. Canvas zoom and focus are saved per flow. New results stay above the bottom fifth of the canvas when space allows. The original prompt, answer and note boxes retain Georgia serif content typography and the Devneya wordmark.

Prompt drafts commit after 800ms of idle time and flush on blur, send or page leave. Workspace saves are debounced by 800ms. Consecutive edits share an undo entry. Answers stream with a received character count, model phase and elapsed time, plus a Stop control. Markdown renders in answers and notes; fenced code retains its spacing. Drawing requests produce passive SVG illustrations through the existing Codex sign-in. Drawings stay in the local IndexedDB workspace, travel with exports and notes, can be downloaded as SVG, and are included in follow-up context for revisions.

Click an answer or file’s left, right or bottom border dot to create a connected prompt on that side, or drag the dot onto empty canvas to place it. A sent prompt’s Fork creates an editable copy while the original answer continues, with a subtle dashed line showing its origin. Sent prompts retain the same box and input geometry. A connection’s hover delete control sits on its curve.

On an unsent prompt, open Context to exclude individual pieces with × or use Clear context to remove all prior pieces while keeping the current question. Exclusions change the actual request and persist locally. New connections add new context without restoring excluded pieces. Sent context remains a record of what was sent; fork the prompt to edit its copy.

Upload adds text/code or passive SVG (up to 64 KB), PNG/JPEG/WebP images or PDF files (up to 2 MB each) to neutral file boxes with type labels and previews. Existing safe SVG uploads also display a drawing preview; text sources remain available to inspect or edit. Connect a file box to a prompt to send its content with that request; uploading alone does not send it. Attachments persist in IndexedDB and JSON exports. Requests accept up to 4 MB of attachments, and file support depends on the chosen model. The Codex sign-in route supports inline attachments, not hosted bitmap image generation.

Export opens a menu with Workspace JSON for the editable workspace and Print / Save PDF for a reading copy of the active flow, including response drawings and uploaded images; PDF attachments are listed by name.

`npm run test:e2e:codex -- canvas-controls.spec.ts` checks model folders, effort requests, parallel forks, connector gestures, uploads, persistence and printable PDF output. Set `CANVAS_FILES_LIVE=1` to also test a real Codex request reading an uploaded PDF.

`npm run test:e2e:codex -- restored-canvas.spec.ts` tests a real completion, notes, forks and reload in Chromium. This uses Codex inference. `canvas-improvements.spec.ts` checks progress, Markdown, drawing downloads, persistence and revision context; its live drawing case runs only with `CANVAS_DRAW_LIVE=1`, or replays captured output with `CANVAS_DRAW_FIXTURE=tests/fixtures/codex-elephant.ndjson`. Other files in that test folder document retired experiments and are not checks of the current interface.
