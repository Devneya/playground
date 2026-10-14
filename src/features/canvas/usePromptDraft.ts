import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export const PROMPT_IDLE_MS = 800;

/** Keep keystrokes local; commit a burst before sending, leaving, or saving. */
export const usePromptDraft = (value: string, onCommit: (text: string) => void) => {
  const [text, setText] = useState(value);
  const latest = useRef(value);
  const incoming = useRef(value);
  const committed = useRef(value);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    if (latest.current !== committed.current) {
      committed.current = latest.current;
      commit.current(latest.current);
    }
    return latest.current;
  }, []);
  const change = useCallback((next: string) => {
    latest.current = next;
    setText(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, PROMPT_IDLE_MS);
  }, [flush]);
  useEffect(() => {
    if (value === incoming.current) return;
    incoming.current = value;
    // A delayed echo of our own commit must not overwrite newer typing.
    if (value === committed.current) return;
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    latest.current = value;
    committed.current = value;
    setText(value);
  }, [value]);
  useEffect(() => {
    const leaving = () => flushSync(() => { flush(); });
    window.addEventListener("beforeunload", leaving);
    window.addEventListener("pagehide", leaving);
    return () => { window.removeEventListener("beforeunload", leaving); window.removeEventListener("pagehide", leaving); flush(); };
  }, [flush]);
  return { text, change, flush };
};
