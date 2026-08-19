## Devneya Playground

The clean-cutover flow playground for `playground.devneya.com`. It is a React + TypeScript + Vite static site deployed to GitHub Pages; runtime workspace data stays in the signed-in user’s browser.

### Local development

Node.js 18+ and npm are required.

```bash
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
npm run test:e2e
```

Vitest covers completion formatting, graph invariants, reducer transitions, execution settlement/cancellation, API credential boundaries, MSW-backed HTTP adapters, IndexedDB persistence/corruption handling, and auth UI states. Playwright is configured for Chromium smoke and browser workflow coverage.

### Deployment

`.github/workflows/deploy.yml` validates every pull request and deploys only after validation on `main`. The build publishes the `dist/` artifact through GitHub Pages. `public/CNAME` keeps the custom domain `playground.devneya.com`.

Required Actions secret:

- `VITE_GOTRUE_ANON_KEY`
