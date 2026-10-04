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

- A prompt uses one model. Models come from the live `/llm/v1/models` catalog.
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

Production remains GoTrue authentication plus the Bifrost API and account
virtual key. Keep GoTrue JWTs separate from Bifrost keys. Never add secrets,
local auth files, or machine credentials to source, fixtures, `.env` files, or
Git history.

Text and SVG uploads are limited to 64 KB. Images and PDFs are limited to
2 MB each, with a 4 MB combined request-file limit.

## Persistence and experiments

Workspaces save locally in IndexedDB, in the `devneya-playground` database's
`workspaces` object store. Drafts and workspace changes debounce for 800 ms;
page-exit handling flushes pending saves, and the IndexedDB transaction is
explicitly committed so reloads retain the latest state. Camera zoom, focus,
and manual panning persist. Automatic placements use measured box dimensions.

The retired generated-workspace experiments and their persistence shapes are
kept for compatibility and history, but are not mounted in the current app and
are not current acceptance criteria. Their fixtures can replay captured model
output. They do not make multi-model prompts the current product direction.
