# Product notes — spatial chat

## The product

One surface: an ordinary-feeling chat assembled from freely movable prompt
and response cards. There is no Conversation/Map/Editor mode switch. The graph
is the conversation, not a separate representation to open.

The original yellow accent stays. Content has priority: small headers, tight
spacing, discreet controls, no large frames, welcome panels, or bulky menus.

## Default interaction

- Write a prompt and send it. Its response appears directly below. A compact
  next-prompt card follows, inheriting the responding model.
- Enter sends; Shift+Enter inserts a newline. The wheel scrolls the surface
  rather than zooming it; horizontal trackpad movement navigates branches.
- Prompt and response cards are separate objects, with a small consistent gap.
  A submitted prompt becomes a compact text block. Answers retain their full
  readable content instead of being squeezed into a fixed-height preview.
- Model choice belongs to each prompt. Existing responses keep their actual
  model identity even when a later prompt changes models.
- New prompts select the first available model from the live catalog. Keep
  at least one selected; choose another before deselecting the last one.

## Branches and alternatives

Branch continues from an answer in a new column to the right, next to the
existing continuation. It inherits the selected answer's conversation history.

Model selection stays inside the next prompt, including a branched prompt.
There is no separate “Try another model” action. Prompt numbers are accessible
identifiers, not visible headings. Context and models occupy the header;
Send sits inside the input's trailing edge. Header controls share one vertical
centerline; the empty input starts at one line and grows with its content.
The default mock catalog offers two models,
selectable together; larger catalogs remain regression fixtures.

Sent prompts are immutable in the interface. “Branch” creates an editable
copy beside the original, carrying the captured instruction, context, and
models without including the original answer. There is no “Edit prompt” action.
On an answer, the same Branch action continues with that answer included in
history. Tooltips explain the contextual difference; avoid competing names
for the same spatial action.

Save as note belongs in the response header as an outward-copy action. It
ejects an editable copy above-right of the response without moving the original
or its following prompt, leaving the branch lane clear. A Source link returns
to the original response. The note retains an immutable record of the source
prompt, response, model, and execution identifiers through editing, persistence,
export, and flow duplication. Deleted sources leave the record readable.
Older notes without source metadata are not assigned guessed origins.

The original thread remains intact. Branch provenance and conversational
connections survive changes to the physical arrangement of cards.

## Automatic layout and manual freedom

Automatic placement is a starting arrangement, not a constraint. New cards
align using measured card heights and an 8px vertical gap. Parallel columns
use a 24px gutter: visibly related rather than distant panels.

Drag any card by its header. Its text remains selectable, and fields/buttons
remain usable without moving the card. A manual move changes only placement:
never the generating model, execution snapshot, source context, or edges.
Moving a card does not drag its followers along. Manually arranged cards must
not snap back when a response arrives, a disclosure opens, or the page reloads.

Existing saved positions are preserved. Reformatting the surface must not
destroy a user's previous manual arrangement.

## Context and provenance

Each execution captures its instruction, model, and earlier user/assistant
turns. Later edits do not silently rewrite the history of an existing answer.
Sibling responses are excluded unless explicitly selected as context.

Context is available in a collapsed disclosure, not a permanently expanded
configuration panel. Generating context and current visual position are
independent concepts. Oversized requests fail visibly rather than silently
dropping earlier conversation.

Keep the pure graph domain, browser-local IndexedDB persistence, portable
exports, live model catalog, and separation between authentication credentials
and model API credentials.

## Future artifacts and concepts

### Multi-model arrangement under evaluation

The current comparison places 2–4 answers alongside each other below their
prompt, each with its own continuation. Browser examples cover all three
counts. This preserves reading order, but four columns need horizontal space.
The proposed directional alternative (two below; two below and one above;
four cardinal directions) remains a design experiment, not the default.
Above/left placement must account for prior messages, variable answer heights,
and future continuations without moving manually arranged cards. A two-column
comparison group is another candidate; neither should introduce a new mode.

### Durable outputs

Note extraction has a visible “Note” label and a yellow folded-paper icon in
the response header. Canvas navigation belongs in the same compact rail as
workspace actions, not a separate floating control cluster.

Artifact is the broad category of durable outputs: concepts, summaries, plans,
and decisions. Concept is the working term for a higher-level abstraction
supported by observations, examples, and sources, similar to a class organizing
particular instances. Summary implies compression; synthesis emphasizes
combining sources.

A concept may draw on several messages or threads; one response may contribute
to several concepts. Proposed actions are Create concept, Connect concepts,
and Explore concept. Keep exact source excerpts and links; preview which
material a new exploration will send. Relationships such as “supports,”
“contradicts,” and “depends on” are not automatically model-context edges.

These artifacts should eventually live on this same surface. They are a future
layer, not a reason to introduce separate modes. Start with manual extraction;
later, offer model-generated concept suggestions for review. Do not claim
semantic concept extraction is already implemented.

## Acceptance scenarios

1. Two turns read like normal chat without zooming, wiring, or switching views.
2. The next prompt keeps the model; a branch can choose another model while
   retaining its source conversation history.
3. A branch appears beside its source thread without overlapping either column.
4. Drag prompt and response cards independently, then keep chatting: manually
   chosen positions and all provenance remain intact after reload/export.
5. Long responses and expanded details remain readable without overlapping
   automatically placed following cards.
6. Default wheel scrolling does not change zoom; mobile remains usable without
   overflowing the page itself.

The discarded three-mode redesign was a misunderstanding of this interaction.
It is not the product direction. The test of success is whether writing,
branching, moving, and returning to a thought all feel like one activity.
