import { useEffect, useRef, type ReactNode } from "react";
import type { ConversationEntry } from "../../domain/types";
import { CardIcon } from "./CardIcon";

export const ContextCount = ({ count }: { count: number }) =>
  count > 0 ? <span className="muted"> ({count})</span> : null;

export const contextThread = (instruction: string | undefined, entries: ConversationEntry[] | undefined): ConversationEntry[] => {
  const prompt = instruction?.trim();
  return [
    ...(prompt ? [{ role: "user" as const, content: prompt, nodeId: "instruction" }] : []),
    ...(entries ?? []),
  ];
};

export const ContextDisclosure = ({ count, meta, entries, children, onRemove, onClear }: { count: number; meta?: ReactNode; entries: ConversationEntry[]; children?: ReactNode; onRemove?: ((index: number) => void) | undefined; onClear?: (() => void) | undefined }) => {
  const rootRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const onPointerDown = (event: PointerEvent) => {
      if (!root?.open) return;
      const card = root.closest(".spatial-card");
      if (event.target instanceof globalThis.Node && card?.contains(event.target)) return;
      root.open = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && root?.open) root.open = false;
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  return <details ref={rootRef} className="context-disclosure">
    <summary>
      <CardIcon name="history" size={13} />
      <span>Context<ContextCount count={count} /></span>
      <CardIcon name="chevron" size={12} className="context-chevron" />
    </summary>
    <div className="context-panel nowheel nodrag nopan" onWheel={(event) => event.stopPropagation()}>
      {meta}
      {onClear && <div className="context-tools"><span>Included in the next request</span><button type="button" onClick={onClear}>Clear context</button></div>}
      <div className="context-thread">
        {entries.map((entry, index) => <div className={`context-bubble context-bubble-${entry.role}`} key={`${entry.nodeId}-${index}`}>
          <div className="context-entry-header"><span className="context-entry-role">{entry.role === "assistant" ? `Assistant${entry.modelId ? ` · ${entry.modelId}` : ""}` : entry.nodeId === "instruction" ? "This prompt" : "You"}</span>
            {onRemove && entry.nodeId !== "instruction" && <button type="button" className="context-remove" aria-label={`Remove context item ${index + 1}`} title="Exclude this piece from the next request" onClick={() => onRemove(index)}><CardIcon name="close" size={13} /></button>}
          </div>
          <p>{entry.content}</p>
          {entry.files?.map((file, fileIndex) => <small key={fileIndex}>{file.name}</small>)}
        </div>)}
        {entries.length === 0 && <p className="muted context-empty">No prior turns.</p>}
      </div>
      {children}
    </div>
  </details>;
};

export const CardRail = ({ context, action }: { context: ReactNode; action?: ReactNode }) => (
  <footer className="card-rail nodrag nopan">
    <div className="context-slot">{context}</div>
    {action}
  </footer>
);
