## Devneya Playground

The clean-cutover flow playground for `playground.devneya.com`. It is a React + TypeScript + Vite static site deployed to GitHub Pages; runtime workspace data stays in the signed-in user’s browser.

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

The app discovers models from `GET /llm/v1/models`, obtains a Bifrost virtual key from `/account/key` using the GoTrue JWT, and sends completions to `/llm/v1/chat/completions` with only the Bifrost key.

### Product boundaries

- Nodes are Text and Generation only. Text may be manual or a read-only generated result.
- Inputs are ordered, graph cycles are rejected, and only successful results can be reused.
- A run snapshots its inputs and instruction, creates one result per selected model, runs models concurrently, and records failures without retrying or overwriting results.
- Named flows are persisted in IndexedDB (`devneya-playground`, `workspaces`) under the authenticated user ID.
- Workspace export/import uses the versioned `devneya-flow-v1` JSON format.
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

`.github/workflows/deploy.yml` validates every pull request and deploys only after validation on `main`. The build publishes the `dist/` artifact through GitHub Pages. `public/CNAME` keeps the custom domain `playground.devneya.com`.

Required Actions secret:

- `VITE_GOTRUE_ANON_KEY`
