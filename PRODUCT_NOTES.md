# Product notes — spatial prompt boxes

## Product direction

The product is one freeform React Flow canvas made from prompt, response, note,
and file boxes. Keep the original box interface and Georgia serif text inside
the boxes; use neutral styling for notes and files. The panoramic prototype,
lanes, and chat-card replacements were rejected. Do not treat those layouts as
the product direction.

Prompts, responses, and notes remain separate movable objects. Automatic
placement uses measured card dimensions; a person can move each box on its own.
Cards remain readable as their content grows. A sent prompt keeps its text and
the same geometry as its editable draft instead of collapsing into a compact
label. Branching and connections preserve the captured conversation history.

## Canvas interactions

- A prompt uses one model. Models come from the active provider’s live catalog. Catalog presence does not
  guarantee completion compatibility or authorization; API-key model selection
  stays manual.
  The picker opens near the upper-left of its box, focuses its search field,
  and offers compact effort choices directly. Multi-model-per-prompt behavior
  is not the product default; any later multi-model work needs a separate
  product decision.
- Enter sends a prompt; Shift+Enter adds a newline. Border dots on the left,
  right, and bottom create connected prompts; dragging between boxes makes an
  explicit connection.
- The canvas toolbar order is New prompt, Upload, Note, Undo, Redo, then a
  separator. Export opens choices for workspace JSON and Print / Save PDF.
- Save as note is beside the response header controls. It creates an editable
  note nearby to the right of the response, leaving existing boxes in place.
- Context belongs to each box. While a prompt is still unsent, prior context
  items can be excluded individually or cleared together. A sent prompt keeps
  its captured prompt and context for that response; fork it to edit a copy.

## Local Codex and production API

Local Codex development is provided by `src/api/local-codex.mjs`, a Vite
server-side bridge that uses the machine's existing Codex sign-in and keeps
credentials out of browser code. It requests the priority service tier and
defaults to xhigh effort when the selected model supports it; effort is
selectable per prompt. SVG drawings are passive inline vectors.

Hosted setup places **Continue with Devneya** first, followed by **Use an API key**. The API-key form offers OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral, DeepSeek, and Custom OpenAI-compatible. Setup loads live models without inference; OpenRouter first authenticates against `/key`. Keys are saved only in the browser's connection `localStorage`, never in the workspace or export. API usage has its own billing; ChatGPT subscriptions do not pay for OpenAI API requests.

Custom connections require HTTPS, a bearer API key, and a live `/models` catalog. Enter the API base URL including its version path; the client appends `/models` and `/chat/completions`. There is no manual catalog fallback, arbitrary authentication headers, or HTTP loopback exception. Catalog access does not prove generation access. Native Anthropic Messages and Gemini generateContent adapters preserve conversation history and supported inline attachments. New providers use their default reasoning behavior; the existing local Codex controls remain.

Devneya still signs in through GoTrue, exchanges its JWT for a Bifrost virtual key through `/account/key`, and uses the Devneya OpenAI-compatible endpoints. Keep these credentials separate. Hosted Codex is deferred; historical research and local development support remain.

The GoTrue client rewrites generated OAuth authorization URLs from
`/auth/v1/authorize` to Devneya's `/auth/authorize` route. The former returned
404; the corrected route responds with a redirect while preserving the PKCE
parameters. This checks URL construction, not consent at an external OAuth
provider.

Signup, recovery, and OAuth return to the full Playground root URL with a
trailing `/`. Without it, the deployed GoTrue allowlist falls back to
`app.devneya.com`. The random non-JWT public client value passed real
prepublication authentication and complete cleanup; authenticated requests
still use issued user JWTs. The older API's same-second revocation limitation
is documented in HANDOFF; this release changes no backend service.

The Connection control is at the upper-right of the canvas. It offers Change
connection and Disconnect. There is one active inference connection at a time.
Switching connections keeps the same canvas and waits for active runs to settle
as cancelled before the screen changes. Disconnect removes the active
connection and its API key while retaining the workspace; Devneya Sign out
remains a separate action.

For historical ChatGPT account linking and plan-funded inference research, see the dated
feasibility and implementation note in [HANDOFF.md](HANDOFF.md). That is a
separate integration from the OpenAI API-key connection, local Codex sign-in,
and Devneya authentication.

Text and SVG uploads are limited to 64 KB. Images and PDFs are limited to
2 MB each, with a 4 MB combined request-file limit.

## Persistence and experiments

Workspaces save locally in IndexedDB, in the `devneya-playground` database's
`workspaces` object store, under one `browser-workspace` record shared by
providers and Devneya accounts in this browser. Older per-user records are left
untouched. Drafts and workspace changes debounce for 800 ms; page-exit handling
flushes pending saves, and the IndexedDB transaction is explicitly committed so
reloads retain the latest state. Camera zoom, focus, and manual panning persist.
Automatic placements use measured box dimensions.

The retired generated-workspace experiments and their persistence shapes are
kept for compatibility and history, but are not mounted in the current app and
are not current acceptance criteria. Their fixtures can replay captured model
output. They do not make multi-model prompts the current product direction.

## Release validation — 2026-10-14

The final implementation passed 428 unit tests and all 91 Chromium browser checks,
including all eight API-key journeys, persistence, cancelled runs before
switching, credential-free export, form accessibility, and real unrouted
OPTIONS exchanges for native headers and custom paths. Coverage, both audits,
all builds, and artifact/bundle limits passed. The separate genuine OpenAI
production CORS probe passed with successful cleanup. This is synthetic and
deterministic verification. Pages enforces HTTPS. The latest publication uses
the preferred public Actions variable `PLAYGROUND_GOTRUE_CLIENT_KEY`, mapped
to the build-time `VITE_GOTRUE_ANON_KEY`, while retaining the existing
`VITE_SUPABASE_PUBLIC_KEY` secret as fallback. The random-value auth proof is
passed before publication; deployed browser certification remains pending.
Do not claim both phases passed until the actual deployed run finishes. The operator
waived OpenAI credential preflight and paid live certification for this
publication. Existing paid-runner guards and caps remain unchanged. See
[HANDOFF.md](HANDOFF.md).
