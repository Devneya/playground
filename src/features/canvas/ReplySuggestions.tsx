import type { OutputSuggestions } from "../../domain/canvasReply";
import { LIMITS } from "../../domain/limits";
import { useWorkspace } from "../workspace/useWorkspace";

export const ReplySuggestions = ({ nodeId, suggestions }: { nodeId: string; suggestions: OutputSuggestions }) => {
  const { activeFlow, dispatch } = useWorkspace();
  const accept = (kind: "branch" | "note" | "grid", index = 0) => dispatch({ type: "suggestion/accept", flowId: activeFlow.id, sourceNodeId: nodeId, kind, index });
  const hasRoom = (count = 1) => activeFlow.nodes.length + count <= LIMITS.maxNodesPerFlow && activeFlow.edges.length + count <= LIMITS.maxEdgesPerFlow;
  const grid = suggestions.grid;
  return <section className="reply-suggestions nodrag nopan" aria-label="Ideas to work with">
    {grid && !grid.accepted && <div className="map-proposal">
      <div className="proposal-heading"><span>AN ANSWER IN SPACE</span><span>{grid.cells.length} cards</span></div>
      <div className="map-preview" style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }} aria-label="Proposed map">
        {grid.cells.map((cell) => <div key={`${cell.col}:${cell.row}`} className={cell.noted ? "map-preview-cell noted" : "map-preview-cell"} style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }} title={cell.text}><strong>{cell.title}</strong><p>{cell.text}</p></div>)}
      </div>
      <button type="button" className="place-map-button" disabled={grid.accepted || !hasRoom(grid.cells.length)} onClick={() => accept("grid")}>{grid.accepted ? "✓ Placed on your canvas" : hasRoom(grid.cells.length) ? "Place map on canvas ↗" : "Canvas is full"}</button>
      {!grid.accepted && <small>New cards beside this answer. You decide what connects.</small>}
    </div>}
    {!!suggestions.notes?.length && <div className="suggested-notes"><div className="proposal-heading">WORTH KEEPING</div>{suggestions.notes.map((note, index) => <button type="button" className="suggestion-note" disabled={note.accepted || !hasRoom()} key={index} onClick={() => accept("note", index)} title={note.text}><span>{note.accepted ? "✓" : "+"}</span><strong>{note.title}</strong><span>{note.accepted ? "Kept" : "Keep note"}</span></button>)}</div>}
    {!!suggestions.branches?.length && <div className="suggested-branches"><div className="proposal-heading">POSSIBLE DIRECTIONS</div>{suggestions.branches.map((branch, index) => <button type="button" className="suggestion-branch" disabled={branch.accepted || !hasRoom()} key={index} title={branch.instruction} onClick={() => accept("branch", index)}><span>{branch.accepted ? "✓" : "↗"}</span>{branch.title}<small>{branch.accepted ? "Opened" : "Explore"}</small></button>)}</div>}
  </section>;
};
