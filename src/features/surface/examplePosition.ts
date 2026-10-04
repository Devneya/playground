// Recorded from the live Codex browser test, 2026-10-03. No user workspace data.
export const exampleBoard: unknown = {
  "head": "b0fdb655-3bc8-4e0e-b2d7-d9bbd5d5296d",
  "revisions": [
    {
      "id": "7f78203c-25ab-4684-b8a2-f1ca32efa1a9",
      "parent": null,
      "actor": "you",
      "label": "I want a truly visual interface for people and LLMs to think together. Like a tweaked chess game: I make a move, the model makes one or several moves, perhaps revisiting something earlier while I type. Compare three concrete interaction designs. No chat, no answer cards, no kids' toys.",
      "reason": "",
      "model": "",
      "at": "2026-10-03T18:38:58.638Z",
      "position": {
        "title": "",
        "question": "",
        "routes": [],
        "marks": {}
      }
    },
    {
      "id": "74432806-2d0c-4b54-bf27-2e89dfd74b65",
      "parent": "7f78203c-25ab-4684-b8a2-f1ca32efa1a9",
      "actor": "model",
      "label": "1 · Make relationships the playing surface",
      "reason": "This direction makes thinking spatial: a move changes a relationship, not a message. It supports live model activity without letting the model rewrite the sentence you are composing.",
      "model": "gpt-6.1-sol",
      "at": "2026-10-03T18:40:03.807Z",
      "position": {
        "title": "Three interfaces for shared visual thinking",
        "question": "",
        "routes": [
          {
            "id": "relation_field",
            "title": "Relation field",
            "premise": "One continuous map of claims, constraints, and dependencies. Human and model moves change its topology.",
            "pieces": [
              {
                "id": "rf_surface",
                "label": "Words and lines, not containers",
                "detail": "An open canvas uses short typographic statements joined by labeled lines. No bubbles or response panels. Opening position for this brief: “Model moves while I type” —conflicts with→ “My active thought stays undisturbed”; “Revisit earlier moves” —requires→ “Visible history.” Selecting a line reveals its precise meaning in place.",
                "kind": "idea",
                "basis": "proposal"
              },
              {
                "id": "rf_human_move",
                "label": "A gesture changes a relationship",
                "detail": "Drag “My active thought stays undisturbed” onto “Model moves while I type.” A small operator wheel offers requires, conflicts with, narrows, and supports. Choose narrows and type “outside my editing region.” This is the human move: a changed relationship plus a new boundary, not a prompt sent elsewhere.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "rf_model_move",
                "label": "The model extends the map",
                "detail": "The model adds “Protect the active region,” connects it to the new boundary, and redirects the earlier history requirement toward “Record changes by object.” New lines briefly carry a distinctive double stroke and a move number. Selecting that number highlights the entire move; keep or undo acts on the change set, not a block of prose.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "rf_concurrency",
                "label": "Local protection, visible revisits",
                "detail": "Typing visibly protects that statement and its incident lines. The model can extend unlocked regions immediately, but cannot alter your words. Proposed edits to protected objects remain dashed until you release them. Revisiting an earlier statement leaves a faint previous connection that you can inspect or restore; the canvas never silently rearranges under your pointer.",
                "kind": "constraint",
                "basis": "proposal"
              }
            ],
            "tradeoff": "Excellent for relationships and unresolved tensions; weaker for reading long prose or comparing complete alternative positions.",
            "test": "Use this interface brief to narrow the live-move rule. Check whether the changed relationship, model response, and untouched human draft are legible without opening a transcript."
          }
        ],
        "marks": {}
      }
    },
    {
      "id": "0381eee8-d4d7-4300-abbd-e0d432fa8380",
      "parent": "74432806-2d0c-4b54-bf27-2e89dfd74b65",
      "actor": "model",
      "label": "2 · Make alternative histories the playing surface",
      "reason": "This direction takes the chess analogy seriously through positions, branches, and recoverable moves—not chess pieces. It makes returning to an earlier decision a first-class operation.",
      "model": "gpt-6.1-sol",
      "at": "2026-10-03T18:40:15.088Z",
      "position": {
        "title": "Three interfaces for shared visual thinking",
        "question": "",
        "routes": [
          {
            "id": "relation_field",
            "title": "Relation field",
            "premise": "One continuous map of claims, constraints, and dependencies. Human and model moves change its topology.",
            "pieces": [
              {
                "id": "rf_surface",
                "label": "Words and lines, not containers",
                "detail": "An open canvas uses short typographic statements joined by labeled lines. No bubbles or response panels. Opening position for this brief: “Model moves while I type” —conflicts with→ “My active thought stays undisturbed”; “Revisit earlier moves” —requires→ “Visible history.” Selecting a line reveals its precise meaning in place.",
                "kind": "idea",
                "basis": "proposal"
              },
              {
                "id": "rf_human_move",
                "label": "A gesture changes a relationship",
                "detail": "Drag “My active thought stays undisturbed” onto “Model moves while I type.” A small operator wheel offers requires, conflicts with, narrows, and supports. Choose narrows and type “outside my editing region.” This is the human move: a changed relationship plus a new boundary, not a prompt sent elsewhere.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "rf_model_move",
                "label": "The model extends the map",
                "detail": "The model adds “Protect the active region,” connects it to the new boundary, and redirects the earlier history requirement toward “Record changes by object.” New lines briefly carry a distinctive double stroke and a move number. Selecting that number highlights the entire move; keep or undo acts on the change set, not a block of prose.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "rf_concurrency",
                "label": "Local protection, visible revisits",
                "detail": "Typing visibly protects that statement and its incident lines. The model can extend unlocked regions immediately, but cannot alter your words. Proposed edits to protected objects remain dashed until you release them. Revisiting an earlier statement leaves a faint previous connection that you can inspect or restore; the canvas never silently rearranges under your pointer.",
                "kind": "constraint",
                "basis": "proposal"
              }
            ],
            "tradeoff": "Excellent for relationships and unresolved tensions; weaker for reading long prose or comparing complete alternative positions.",
            "test": "Use this interface brief to narrow the live-move rule. Check whether the changed relationship, model response, and untouched human draft are legible without opening a transcript."
          },
          {
            "id": "variation_tracks",
            "title": "Variation tracks",
            "premise": "Several inspectable histories share an ancestor. The model can develop a different continuation while the human continues the current one.",
            "pieces": [
              {
                "id": "vt_surface",
                "label": "A shared trunk, branching positions",
                "detail": "A narrow move spine runs down the left edge. The main area displays a full working position; sibling positions sit alongside it, aligned to the same scale. They are editable diagrams, not answer cards. For this brief, the common ancestor contains “Human typing” and “Model action”; branches show different ownership boundaries around them.",
                "kind": "idea",
                "basis": "proposal"
              },
              {
                "id": "vt_human_move",
                "label": "Every edit becomes a recoverable move",
                "detail": "Draw a protected boundary around the active writing area. On completion, that edit adds “Protect active region” to the spine. Hovering a move exposes its before-and-after geometry directly on the position. Clicking an earlier move restores its editable state without deleting later continuations.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "vt_model_move",
                "label": "The model forks instead of interrupting",
                "detail": "While you type the next rule, the model branches from the boundary decision. One continuation permits additions outside the boundary; another permits only provisional changes. Both show actual boundary geometry and action rules. The model may add several moves along either branch, but it cannot switch your active position or rewrite its ancestry.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "vt_recombine",
                "label": "Carry selected moves across branches",
                "detail": "Drag the boundary from one continuation into another to retain it. The interface shows the exact imported change and highlights any incompatible rule before applying it. A retained object keeps its wording and identity. A model revisit appears as a new branch from the relevant earlier move, with a visible connection back to that decision.",
                "kind": "action",
                "basis": "proposal"
              }
            ],
            "tradeoff": "Strongest for alternatives, provenance, and reversal. Branch management costs attention, and continuously fluid collaboration becomes a sequence of committed edits.",
            "test": "Compare the two live-action policies, retain one boundary, then revise an earlier rule. Check whether you can identify what survived and return to the previous position."
          }
        ],
        "marks": {}
      }
    },
    {
      "id": "b0fdb655-3bc8-4e0e-b2d7-d9bbd5d5296d",
      "parent": "0381eee8-d4d7-4300-abbd-e0d432fa8380",
      "actor": "model",
      "label": "3 · Make the actual work the playing surface",
      "reason": "This direction removes the separate representation of a conversation. Human and model work directly on the same material, with overlays making authorship and proposed changes visible.",
      "model": "gpt-6.1-sol",
      "at": "2026-10-03T18:40:26.997Z",
      "position": {
        "title": "Three interfaces for shared visual thinking",
        "question": "While you type, should the model change unlocked shared material, develop a separate branch, or only draw proposed edits over the current work?",
        "routes": [
          {
            "id": "relation_field",
            "title": "Relation field",
            "premise": "One continuous map of claims, constraints, and dependencies. Human and model moves change its topology.",
            "pieces": [
              {
                "id": "rf_surface",
                "label": "Words and lines, not containers",
                "detail": "An open canvas uses short typographic statements joined by labeled lines. No bubbles or response panels. Opening position for this brief: “Model moves while I type” —conflicts with→ “My active thought stays undisturbed”; “Revisit earlier moves” —requires→ “Visible history.” Selecting a line reveals its precise meaning in place.",
                "kind": "idea",
                "basis": "proposal"
              },
              {
                "id": "rf_human_move",
                "label": "A gesture changes a relationship",
                "detail": "Drag “My active thought stays undisturbed” onto “Model moves while I type.” A small operator wheel offers requires, conflicts with, narrows, and supports. Choose narrows and type “outside my editing region.” This is the human move: a changed relationship plus a new boundary, not a prompt sent elsewhere.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "rf_model_move",
                "label": "The model extends the map",
                "detail": "The model adds “Protect the active region,” connects it to the new boundary, and redirects the earlier history requirement toward “Record changes by object.” New lines briefly carry a distinctive double stroke and a move number. Selecting that number highlights the entire move; keep or undo acts on the change set, not a block of prose.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "rf_concurrency",
                "label": "Local protection, visible revisits",
                "detail": "Typing visibly protects that statement and its incident lines. The model can extend unlocked regions immediately, but cannot alter your words. Proposed edits to protected objects remain dashed until you release them. Revisiting an earlier statement leaves a faint previous connection that you can inspect or restore; the canvas never silently rearranges under your pointer.",
                "kind": "constraint",
                "basis": "proposal"
              }
            ],
            "tradeoff": "Excellent for relationships and unresolved tensions; weaker for reading long prose or comparing complete alternative positions.",
            "test": "Use this interface brief to narrow the live-move rule. Check whether the changed relationship, model response, and untouched human draft are legible without opening a transcript."
          },
          {
            "id": "variation_tracks",
            "title": "Variation tracks",
            "premise": "Several inspectable histories share an ancestor. The model can develop a different continuation while the human continues the current one.",
            "pieces": [
              {
                "id": "vt_surface",
                "label": "A shared trunk, branching positions",
                "detail": "A narrow move spine runs down the left edge. The main area displays a full working position; sibling positions sit alongside it, aligned to the same scale. They are editable diagrams, not answer cards. For this brief, the common ancestor contains “Human typing” and “Model action”; branches show different ownership boundaries around them.",
                "kind": "idea",
                "basis": "proposal"
              },
              {
                "id": "vt_human_move",
                "label": "Every edit becomes a recoverable move",
                "detail": "Draw a protected boundary around the active writing area. On completion, that edit adds “Protect active region” to the spine. Hovering a move exposes its before-and-after geometry directly on the position. Clicking an earlier move restores its editable state without deleting later continuations.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "vt_model_move",
                "label": "The model forks instead of interrupting",
                "detail": "While you type the next rule, the model branches from the boundary decision. One continuation permits additions outside the boundary; another permits only provisional changes. Both show actual boundary geometry and action rules. The model may add several moves along either branch, but it cannot switch your active position or rewrite its ancestry.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "vt_recombine",
                "label": "Carry selected moves across branches",
                "detail": "Drag the boundary from one continuation into another to retain it. The interface shows the exact imported change and highlights any incompatible rule before applying it. A retained object keeps its wording and identity. A model revisit appears as a new branch from the relevant earlier move, with a visible connection back to that decision.",
                "kind": "action",
                "basis": "proposal"
              }
            ],
            "tradeoff": "Strongest for alternatives, provenance, and reversal. Branch management costs attention, and continuously fluid collaboration becomes a sequence of committed edits.",
            "test": "Compare the two live-action policies, retain one boundary, then revise an earlier rule. Check whether you can identify what survived and return to the previous position."
          },
          {
            "id": "drafting_plane",
            "title": "Layered drafting plane",
            "premise": "A shared drafting surface holds the actual artifact. The model's moves are visible edits on a separate, promotable layer.",
            "pieces": [
              {
                "id": "dp_surface",
                "label": "The artifact fills the screen",
                "detail": "For this brief, the opening artifact is an interface drawing: a broad shared work area, a narrow rule margin, and a revision rail along the bottom. Labels are written directly on the drawing: “active human region,” “model working region,” and “earlier positions.” No conversation column; explanations attach to the precise object they explain.",
                "kind": "idea",
                "basis": "proposal"
              },
              {
                "id": "dp_human_move",
                "label": "Draw, type, move, or protect",
                "detail": "Resize the active human region and write “Model may revisit earlier decisions” in the rule margin. A completed stroke, object drag, or text edit constitutes a move. Underlining an object pins it against model alteration. Crossing out a proposed change dismisses it; neither gesture requires translating your intent into a chat instruction.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "dp_model_move",
                "label": "The model draws its intervention",
                "detail": "In response to that rule, the model draws a revision rail beneath the work area and a return path from an earlier position to a translucent alternate layout. It labels the path “revisit without replacing current work.” These are usable geometry and text edits on the model layer, not a description of what you should draw.",
                "kind": "action",
                "basis": "proposal"
              },
              {
                "id": "dp_layers",
                "label": "Promote edits without losing the draft",
                "detail": "While you type, model edits appear as dashed geometry or underlined replacement text, never displacing your cursor. Sweep over individual edits to promote them into the shared artifact. If their source object has changed, they remain marked as outdated rather than attaching elsewhere. Scrubbing the revision rail reveals prior layers; returning to one creates a continuation.",
                "kind": "constraint",
                "basis": "proposal"
              }
            ],
            "tradeoff": "Most direct for making diagrams, layouts, and structured documents. Overlay density can obscure the work; abstract disagreements need explicit annotations to remain visible.",
            "test": "Revise this interface drawing while the model proposes a history mechanism. Check whether you can keep only its revision rail without accepting its layout or interrupting your text."
          }
        ],
        "marks": {}
      }
    }
  ]
};
