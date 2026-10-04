import { useEffect, useRef, useState } from "react";
import { appendBoardRevision, applyBoardMove, blankPosition, boardChanges, boardLineage, boardPosition, emptyBoard, moveSchema, type BoardPosition, type MoveBoard as Board } from "../../domain/moveBoard";
import { boardMessages, MOVE_BOARD_PROMPT } from "../../domain/moveBoardPrompt";
import { randomIdFactory } from "../../domain/ids";
import { streamCompletion, type CompletionProgress } from "../../api/streamCompletion";
import { useWorkspace } from "../workspace/useWorkspace";
import { ModelPicker } from "../canvas/ModelPicker";
import { loadExampleFlow } from "./exampleFlow";
import { BoardChangeReport, BoardPositionView } from "./BoardPositionView";
import "./move-board.css";

const examples = [
  ["Make something worth using", "I want to build a useful tool for people who think with AI. Show me three genuinely different interaction concepts. Give each a concrete example of a human move and how the model responds. Avoid chat and answer cards."],
  ["Take a question apart", "What makes a life meaningful? Give me three distinct positions I can examine and combine, with concrete implications and a difficult question for each. Avoid scores, generic self-help and invented measurements."],
  ["Explore a real decision", "I have a free month and want to spend it well: create something, go somewhere, or learn something deeply. Develop three different possibilities with a concrete first step, a tradeoff and an assumption I can challenge. Do not pretend you know my budget or circumstances."],
] as const;

export const MoveBoard = () => {
  const { workspace, activeFlow, dispatch, models, modelsStatus, modelsError, reloadModels, virtualKey } = useWorkspace();
  const board = activeFlow.board ?? emptyBoard();
  const current = useRef(board); current.current = board;
  const historyElement = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null);
  const expectedHead = useRef<string | null>(board.head);
  const [draft, setDraft] = useState("");
  const [chosenModel, setChosenModel] = useState("");
  const model = models.some((m) => m.id === chosenModel) ? chosenModel : models[0]?.id ?? "";
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CompletionProgress>({ text: "", characters: 0 });
  const [started, setStarted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [applied, setApplied] = useState(0);
  const [error, setError] = useState("");
  const [showMoves, setShowMoves] = useState(true);
  const revision = board.revisions.find((r) => r.id === (preview ?? board.head));
  const position = revision?.position ?? boardPosition(board);
  const pieces = position.routes.flatMap((r) => r.pieces);
  const selection = pieces.filter((p) => selected.includes(p.id));
  const lineage = boardLineage({ ...board, head: preview ?? board.head });
  const objective = lineage.find((r) => r.actor === "you")?.label;
  const beforeTurn = [...lineage].reverse().find((r) => r.actor === "you")?.position ?? blankPosition();
  const beforeMove = board.revisions.find((r) => r.id === revision?.parent)?.position ?? blankPosition();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("example") !== "1") return;
    let alive = true;
    void loadExampleFlow(workspace).then((flow) => {
      if (!alive) return;
      const url = new URL(window.location.href); url.searchParams.delete("example"); window.history.replaceState(null, "", url);
      dispatch({ type: "flow/create", flow });
    }).catch(() => { if (alive) setError("The example could not be loaded. Your work is unchanged."); });
    return () => { alive = false; };
  }, [dispatch, workspace]);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (!preview) historyElement.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest" }); }, [board.head, preview]);
  useEffect(() => { if (controller.current && board.head !== expectedHead.current) controller.current.abort(); }, [board.head]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy, started]);

  const publish = (next: Board) => {
    const baseHead = current.current.head;
    current.current = next; expectedHead.current = next.head;
    dispatch({ type: "board/set", flowId: activeFlow.id, baseHead, board: next });
  };
  const record = (actor: "you" | "model", label: string, reason: string, nextPosition: BoardPosition) => {
    publish(appendBoardRevision(current.current, { id: randomIdFactory(), parent: current.current.head, actor, label, reason, model: actor === "model" ? model : "", at: new Date().toISOString(), position: nextPosition }));
  };
  const stop = () => controller.current?.abort();
  const run = async (instruction: string, human = true, selectedIds = selection.map((p) => p.id)) => {
    if (!instruction.trim() || controller.current || !virtualKey || !model || preview) return;
    setError("");
    if (human) record("you", instruction, "", boardPosition(current.current));
    const runController = new AbortController(); controller.current = runController;
    expectedHead.current = current.current.head;
    setBusy(true); setStarted(Date.now()); setElapsed(0); setApplied(0);
    setProgress({ text: "Sending your position", characters: 0 });
    let buffer = "", count = 0, changedCount = 0;
    const accept = (line: string) => {
      if (!line.trim()) return;
      if (runController.signal.aborted) return;
      if (current.current.head !== expectedHead.current) throw new Error("The position changed. Completed moves have been kept.");
      if (++count > 3) throw new Error("The model reached its three-move limit.");
      const move = moveSchema.parse(JSON.parse(line));
      const previous = boardPosition(current.current);
      const next = applyBoardMove(previous, move);
      if (boardChanges(previous, next).changed) changedCount++;
      record("model", move.label, move.reason, next);
      setApplied(changedCount);
    };
    try {
      await streamCompletion(virtualKey, { model, instructions: MOVE_BOARD_PROMPT, messages: boardMessages(boardPosition(current.current), instruction, selectedIds, boardLineage(current.current).find((r) => r.actor === "you")?.label), stream: false }, runController.signal, (text) => {
        buffer += text;
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        lines.forEach(accept);
      }, setProgress);
      if (buffer.trim()) accept(buffer);
      if (!count && !runController.signal.aborted) throw new Error("The model returned no usable moves.");
    } catch (failure) {
      setError(runController.signal.aborted ? "Stopped. Completed moves are kept." : failure instanceof Error && failure.name !== "ZodError" ? failure.message : "The model returned an unsupported move. Completed moves are kept.");
    } finally {
      if (controller.current === runController) { controller.current = null; setBusy(false); }
    }
  };
  const markName = (value: "keep" | "question" | "dismiss") => selection.every((p) => position.marks[p.id] === value)
    ? { keep: "Release", question: "Clear questions", dismiss: "Restore" }[value]
    : { keep: "Keep", question: "Question", dismiss: "Set aside" }[value];
  const mark = (value: "keep" | "question" | "dismiss") => {
    if (controller.current || preview || !selection.length || !virtualKey || !model) return;
    const next = structuredClone(boardPosition(current.current));
    const removeMark = selection.every((p) => next.marks[p.id] === value);
    for (const piece of selection) {
      if (removeMark) delete next.marks[piece.id]; else next.marks[piece.id] = value;
    }
    const label = `${markName(value)}: ${selection.map((p) => p.label).join(" + ")}`;
    record("you", label, "", next);
    setSelected([]);
    void run(`I changed these marks: ${label}. The current position contains the resulting marks. Respond to that change with the next useful substantive move. Preserve kept pieces; do not merely reword headings.`, false, selection.map((p) => p.id));
  };
  const toggle = (id: string) => setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  const branch = () => {
    if (!preview || busy) return;
    publish({ ...current.current, head: preview }); setPreview(null); setSelected([]);
  };
  const submit = () => { const text = draft.trim(); if (!text || controller.current || preview || !virtualKey || !model) return; setDraft(""); void run(text); };
  const selectRevision = (id: string) => { setPreview(id === board.head ? null : id); setSelected([]); };

  return <div className={`move-board ${showMoves ? "with-history" : ""}`}>
    <aside className="move-history" aria-label="Move history" ref={historyElement}>
      <div className="move-history-title"><span>THE MOVES</span><button type="button" onClick={() => setShowMoves(!showMoves)} aria-label={showMoves ? "Hide move history" : "Show move history"}>{showMoves ? "←" : "→"}</button></div>
      {showMoves && <><p className="move-history-hint">Every position is a place to return to.</p><ol>{board.revisions.map((r, i) => <li key={r.id} className={`${r.actor} ${r.id === (preview ?? board.head) ? "current" : ""}`}>
        <button type="button" onClick={() => selectRevision(r.id)} aria-label={`View move ${i + 1}: ${r.label}`} aria-current={r.id === (preview ?? board.head) ? "step" : undefined}>
          <span className="move-number">{String(i + 1).padStart(2, "0")} <b>{r.actor === "you" ? "YOU" : "MODEL"}</b>{r.parent && board.revisions[i - 1]?.id !== r.parent && <em>↳ from {board.revisions.findIndex((item) => item.id === r.parent) + 1}</em>}</span><span className="move-label">{r.label}</span>{r.actor === "model" && <small>{r.model}</small>}
        </button>
      </li>)}</ol>{!board.revisions.length && <div className="history-empty"><span>01</span>Your first move starts here.</div>}
      {busy && <div className="move-history-live" role="status"><i />Model’s turn <span>{elapsed}s</span><small>{applied ? `${applied} ${applied === 1 ? "move" : "moves"} on the board` : progress.text}</small></div>}</>}
    </aside>

    <section className="move-stage" aria-label="Shared position">
      <div className="move-stage-top"><span>DEVNEYA / A POSITION IN PROGRESS</span><div>{board.head && <button type="button" onClick={() => { setPreview(null); setSelected([]); }}>Current position ↗</button>}<a href="/?view=surface">Earlier workspace ↗</a></div></div>
      {preview && <div className="move-preview" role="status"><span>Viewing move {board.revisions.findIndex((r) => r.id === preview) + 1} · {revision?.label}</span><button type="button" onClick={() => setPreview(null)}>Back to present</button><button type="button" disabled={busy} onClick={branch}>Continue from here ↗</button></div>}
      {activeFlow.name.startsWith("Example ·") && <div className="move-example-notice">Started from a recorded model example. Select pieces to keep, question or combine; your next model move is live.</div>}
      <div className="move-scroll">
        {!position.routes.length ? objective ? <div className="move-started">
          <p className="move-eyebrow">YOUR STARTING POINT</p><h1>{objective}</h1>
          <div className="move-started-status" role="status">{busy ? <><i /><span>{progress.characters ? "The first move is arriving" : progress.text}</span><small>{elapsed}s{progress.characters > 0 ? ` · ${progress.characters.toLocaleString()} characters received` : ""}</small></> : <span>Your request is here. Add a move below to continue.</span>}</div>
        </div> : <div className="move-opening">
          <p className="move-eyebrow">YOUR MOVE. THEN OURS.</p><h1>Think by<br /><em>changing things.</em></h1>
          <p className="move-opening-copy">Put a possibility in play.<br />We’ll develop it together. You decide what stays.</p>
          <div className="move-examples">{examples.map(([label, instruction], i) => <button type="button" key={label} disabled={busy || !virtualKey || !model} onClick={() => void run(instruction)}><span>0{i + 1}</span>{label}<b>↗</b></button>)}</div>
          <a className="move-example-link" href="/?example=1">Open a recorded example · try it now ↗</a>
          <svg className="move-opening-lines" viewBox="0 0 400 300" aria-hidden="true"><path d="M20 150 C150 150 180 35 360 35 M20 150 L360 150 M20 150 C150 150 180 265 360 265"/><circle cx="20" cy="150" r="7"/><circle cx="360" cy="35" r="10"/><circle cx="360" cy="150" r="10"/><circle cx="360" cy="265" r="10"/></svg>
        </div> : <>
          <header className="move-position-heading"><p className="move-eyebrow">{preview ? "EARLIER POSITION" : "ON THE TABLE"}</p><h1>{position.title || "Work in progress"}</h1>{objective && <details className="move-objective"><summary>Your move: {objective}</summary><p>{objective}</p></details>}</header>
          <BoardPositionView key={preview ?? "present"} position={position} before={beforeTurn} selected={selected} onSelect={toggle} onSelectAll={() => setSelected(selection.length === pieces.length ? [] : pieces.map((p) => p.id))} />
        </>}
      </div>

      <footer className="move-command">
        {revision?.actor === "model" && <BoardChangeReport before={beforeMove} position={position} label={revision.label} reason={revision.reason} />}
        {busy && <div className="move-progress" role="status"><i /><strong>{progress.text}</strong><span>{elapsed}s · {applied} applied{progress.characters > 0 ? ` · ${progress.characters.toLocaleString()} chars received` : ""}</span><button type="button" onClick={stop}>Stop</button></div>}
        {error && <p className="move-error" role="alert">{error}<button type="button" aria-label="Dismiss message" onClick={() => setError("")}>×</button></p>}
        {selection.length > 0 && <div className="move-selection" role="toolbar" aria-label="Your selected pieces">
          <p><strong>{selection.length === pieces.length ? `All ${selection.length} pieces selected` : `${selection.length} pieces selected`}</strong> · Selection alone changes nothing. An action below asks the model to respond.</p>
          <button type="button" disabled={busy || !!preview || !virtualKey || !model} onClick={() => mark("keep")}>✓ {markName("keep")}</button>
          <button type="button" disabled={busy || !!preview || !virtualKey || !model} aria-label={`${markName("question")} selected pieces`} onClick={() => mark("question")}>? {markName("question")}</button>
          <button type="button" disabled={busy || !!preview || !virtualKey || !model} onClick={() => mark("dismiss")}>− {markName("dismiss")}</button>
          {selection.length > 1 && <button type="button" disabled={busy || !!preview || !virtualKey || !model} onClick={() => { const ids = selection.map((p) => p.id); setSelected([]); void run(`Combine these selected pieces where they fit; explain incompatibilities instead of forcing a hybrid: ${selection.map((p) => p.label).join(" + ")}`, true, ids); }}>Combine ↗</button>}
          <button type="button" onClick={() => setSelected([])}>Clear</button>
        </div>}
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}><label className="visually-hidden" htmlFor="board-move">Your move</label><textarea id="board-move" aria-label="Your move" maxLength={8000} rows={1} placeholder={position.routes.length ? "Change a constraint, question a piece, or add something…" : "What shall we put in play?"} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && !preview) submit(); } }} /><button className="move-submit" type="submit" disabled={busy || !!preview || !draft.trim() || !virtualKey || !model}>Your move ↗</button></form>
        <div className="move-command-bottom"><ModelPicker title="Board" models={models} modelIds={model ? [model] : []} onSelect={setChosenModel} status={modelsStatus} error={modelsError} onReload={reloadModels} /><span>{busy ? "Your next thought can take shape while the model moves." : preview ? "Reviewing history · continue here to create a branch" : "Keep, question or set aside a piece — the model responds."}</span></div>
      </footer>
    </section>
  </div>;
};
