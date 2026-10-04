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
