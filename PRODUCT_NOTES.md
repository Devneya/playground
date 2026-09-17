# Product notes — spatial chat

## The product

One surface: an ordinary-feeling chat assembled from freely movable prompt
and response cards. There is no Conversation/Map/Editor mode switch. The graph
is the conversation, not a separate representation to open.

The original yellow accent stays. Content has priority: small headers, tight
spacing, discreet controls, no large frames, welcome panels, or bulky menus.

This look is the product, not a sketch. Prompts are cream chat bubbles
(you, right). Answers are grey (the other person, left). Notes are yellow
paper stickies. The send control keeps the yellow accent; prompts do not.
Context is one centered overlay on every card; the overlay scrolls under
the pointer without panning the board. The model picker is a grouped
single-select list. Flow chrome stays compact: Default flow in the top
bar, Flows in the left rail.

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
- New prompts select the first available model from the live catalog. The
  picker is single-select; choosing another model replaces the current one.

## Branches and alternatives

Branch continues from an answer in a new column to the right, next to the
existing continuation. It inherits the selected answer's conversation history.

Model selection stays inside the next prompt, including a branched prompt.
There is no separate “Try another model” action. Prompt numbers are accessible
identifiers, not visible headings. Context and models occupy the header;
Send sits inside the input's trailing edge. Header controls share one vertical
centerline; the empty input starts at one line and grows with its content.
The mock catalog lists current chat models from OpenAI, Claude, DeepSeek, and
GLM. `/llm/v1/models` does not include a provider field, so the picker groups
by id prefix (`gpt-`/`o`, `claude-`, `deepseek-`, `glm-`, else Other).
`four-models` remains a compact one-per-provider fixture.

Sent prompts are immutable in the interface. “Fork” on a sent prompt
creates an editable copy beside the original, carrying the captured
instruction, context, and models without including the original answer.
There is no “Edit prompt” action. On an answer, “Fork” opens a new column
with that answer included in history — the card below the answer is the
linear next turn, not a second reply control. Notes use “Chat” to spark a
prompt already linked from the note.

Save as note belongs in the response header as an outward-copy action. It
ejects an editable copy above-right of the response without moving the original
or its following prompt, leaving the branch lane clear. Notes look like paper
stickies, not chat cards. They use the same Context disclosure as every other
node. Show original returns to the live answer; deleted originals leave Context
readable. Older notes without source metadata are not assigned guessed origins.

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

Context is a single centered chevron on every card. Opening it overlays the
thread so the card does not grow or jump. Inside it, turns read like chat: You
on the right, assistant on the left. Generating context and current visual
position are independent concepts. Oversized requests fail visibly rather than
silently dropping earlier conversation. Show original pans to the live answer
and keeps a highlight until the next click.

Deleting a card removes that card only. Answers stay when a prompt is deleted;
prompts stay when an answer is deleted. Any content card can feed a prompt.

## Multi-model

Several models are several replies on **one step** of **one thread**: one
prompt, one next prompt. The selected reply is the one that continues.
**Branch** is the only way to open another column. Do not spawn a column
(or a next prompt) per model — that silently forks the graph.

Keep the pure graph domain, browser-local IndexedDB persistence, portable
exports, live model catalog, and separation between authentication credentials
and model API credentials.

## Future artifacts and concepts

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
2. Several models stay on one step; the next prompt keeps the selected reply's
   model. Branch is the only new column.
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
