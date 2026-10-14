import { useEffect, useState } from "react";

export const GenerationStatus = ({ modelName, startedAt, instruction, characters = 0, message, onStop }: { modelName: string; startedAt: string; instruction: string; characters?: number; message?: string | undefined; onStop(): void }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <section className="generation-status nodrag nopan nowheel" aria-label="Generation in progress">
    <div className="generation-character-count" aria-label="Characters received">{characters.toLocaleString()} <span>characters received</span></div>
    <div className="generation-status-phase">
      <span className="status-orbit" aria-hidden="true" />
      <span role="status">{modelName} {characters ? "responding" : "working"}</span>
      <time aria-label="Elapsed time">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</time>
    </div>
    <div className="generation-status-actions">
      <details><summary>{message || "View question sent"}</summary><p>{instruction}</p></details>
      <button type="button" className="stop-generation" aria-label="Cancel run" onClick={onStop}><span aria-hidden="true">■</span> Stop</button>
    </div>
    {!characters && elapsed >= 60 && <p className="long-wait">The model has not returned an answer yet. The timer tracks this request; it is not a completion estimate.</p>}
  </section>;
};
