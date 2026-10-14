import { useState } from "react";
import { boardChanges, type BoardPosition } from "../../domain/moveBoard";

const symbols = { idea: "○", action: "↗", question: "?", constraint: "∥" };
const layouts = { comparison: "Alternatives", sequence: "Steps", map: "Topic map" };

export const BoardPositionView = ({ position, before, selected, onSelect, onSelectAll }: {
  position: BoardPosition;
  before: BoardPosition;
  selected: string[];
  onSelect: (id: string) => void;
  onSelectAll: () => void;
}) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const layout = position.layout ?? "comparison";
  const changes = boardChanges(before, position);
  const allSelected = position.routes.every((r) => r.pieces.every((p) => selected.includes(p.id)));
  return <>
    <div className="board-reading-guide"><span>{layouts[layout]} · {position.routes.length} {layout === "sequence" ? "stages" : "groups"}<b>·</b> Open a title to read. Tick a piece to act on it.</span><button type="button" onClick={onSelectAll}>{allSelected ? "Clear selection" : "Select all pieces"}</button></div>
    <div className={`move-routes layout-${layout}`}>
      {position.routes.map((route, index) => <section className={`move-route route-${index}`} key={route.id} aria-label={`${layout === "sequence" ? "Stage" : layout === "map" ? "Topic" : "Direction"} ${index + 1}: ${route.title}`}>
        <div className="move-route-intro"><span className="route-letter">{layout === "sequence" ? String(index + 1).padStart(2, "0") : layout === "map" ? "◇" : String.fromCharCode(65 + index)}</span><div><h2>{layout === "sequence" ? route.title.replace(/^\d+[.)]\s+/, "") : route.title}</h2><p>{route.premise}</p></div></div>
        <div className="move-pieces">{route.pieces.map((piece, step) => {
          const updated = changes.updated.find((change) => change.after.id === piece.id);
          const added = before.routes.length > 0 && changes.added.some((p) => p.id === piece.id);
          const mark = position.marks[piece.id];
          const open = expanded === piece.id;
          return <article className={`move-piece ${selected.includes(piece.id) ? "selected" : ""} ${updated ? "changed" : ""} ${mark ?? ""}`} key={piece.id}>
            <div className="piece-top"><span className={`piece-symbol symbol-${piece.kind}`} aria-hidden="true">{layout === "sequence" ? `${index + 1}.${step + 1}` : symbols[piece.kind]}</span><label className="piece-select"><input type="checkbox" checked={selected.includes(piece.id)} onChange={() => onSelect(piece.id)} aria-label={`Select ${piece.label}`} /><span>Select</span></label></div>
            <button type="button" className="piece-read" aria-label={`Read ${piece.label}`} aria-expanded={open} onClick={() => setExpanded(open ? null : piece.id)}><span className="piece-label">{piece.label}</span><span aria-hidden="true">{open ? "−" : "+"}</span></button>
            <div className="piece-meta">{mark && <span className="piece-mark">{mark === "keep" ? "✓ Kept by you" : mark === "question" ? "? Questioned by you" : "− Set aside"}</span>}{updated ? <span className="piece-update">Updated</span> : added ? <span className="piece-update">Added</span> : piece.basis === "assumption" && <span>Assumption</span>}</div>
            {open && <div className="piece-detail" role="region" aria-label={`Details: ${piece.label}`}><p>{piece.detail}</p>{updated && <details className="piece-previous"><summary>Before this move</summary><strong>{updated.before.label}</strong><p>{updated.before.detail}</p></details>}</div>}
          </article>;
        })}</div>
        <div className="move-route-foot"><p><span>{layout === "comparison" ? "TRADE-OFF" : "TO BEAR IN MIND"}</span>{route.tradeoff}</p><details><summary>{layout === "sequence" ? "Check the result" : "Put this to the test"}</summary><p>{route.test}</p></details></div>
      </section>)}
    </div>
  </>;
};

export const BoardChangeReport = ({ before, position, label, reason }: { before: BoardPosition; position: BoardPosition; label: string; reason: string }) => {
  const changes = boardChanges(before, position);
  const counts = [changes.updated.length && `${changes.updated.length} updated`, changes.added.length && `${changes.added.length} added`, changes.removed.length && `${changes.removed.length} removed`, changes.layoutChanged && "layout changed"].filter(Boolean).join(" · ");
  return <details className="move-change-report">
    <summary><strong>{changes.changed ? counts || "Framing updated" : "No board changes"}</strong><span>{label}</span><small>See what changed</small></summary>
    <div className="move-change-content"><p>{reason}</p>{changes.updated.map(({ before: old, after }) => <div className="move-change-entry" key={after.id}><span>UPDATED</span><p><del>{old.label}{old.label === after.label && ` — ${old.detail}`}</del></p><p>{after.label} — {after.detail}</p></div>)}{changes.added.map((piece) => <div className="move-change-entry" key={piece.id}><span>ADDED</span><p>{piece.label} — {piece.detail}</p></div>)}{changes.removed.map((piece) => <div className="move-change-entry" key={piece.id}><span>REMOVED</span><p>{piece.label}</p></div>)}</div>
  </details>;
};
