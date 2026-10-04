import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasArtifact as Artifact } from "../../domain/canvasReply";
import { MarkdownText } from "./MarkdownText";

// Both policies matter: the opaque-origin sandbox protects the parent, while
// CSP blocks resource loading inside the visual. index.html also forbids frame
// URL navigation; srcdoc itself is an inline document, not a network load.
export const artifactDocument = (html: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#fbfaf5;color:#273c36;font:15px/1.45 system-ui,sans-serif}button,input,select{font:inherit}button{cursor:pointer}:focus-visible{outline:2px solid #526c50;outline-offset:3px}svg{max-width:100%}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}</style></head><body>${html}<script>(()=>{const roots=[...document.body.children].filter(e=>!['STYLE','SCRIPT','LINK','META'].includes(e.tagName));const root=roots.length===1&&['DIV','MAIN','SECTION','ARTICLE','SVG'].includes(roots[0].tagName)?roots[0]:null;const originalHeight=root?.style.height;addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='devneya:immersive'&&typeof e.data.active==='boolean'&&root)root.style.height=e.data.active?'100vh':originalHeight});let last=0;const report=()=>{const height=Math.ceil(document.body.getBoundingClientRect().height);if(height!==last&&height>0){last=height;parent.postMessage({type:'devneya:size',height},'*')}};new ResizeObserver(report).observe(document.body);addEventListener('load',report);report()})()</script></body></html>`;

export const CanvasArtifact = ({ artifact, title, fallback, compact = false, exploredPrompts, onExplore }: { artifact: Artifact; title: string; fallback: string; compact?: boolean; exploredPrompts: string[]; onExplore(prompt: string): void }) => {
  const stage = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(artifact.height);
  const [immersive, setImmersive] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [expandError, setExpandError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const [selection, setSelection] = useState("");
  const [revision, setRevision] = useState(0);
  const opened = exploredPrompts.includes(selection);
  const srcDoc = useMemo(() => artifactDocument(artifact.html), [artifact.html]);
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== "object") return;
      const message = event.data as Record<string, unknown>;
      if (message.type === "devneya:size" && typeof message.height === "number" && Number.isFinite(message.height)) {
        if (document.fullscreenElement === stage.current) return;
        setHeight(Math.max(artifact.height, Math.min(1200, message.height)));
        return;
      }
      if (message.type !== "devneya:selection" || typeof message.prompt !== "string" || !message.prompt.trim() || message.prompt.length > 2000) return;
      setSelection(message.prompt.trim());
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [artifact.height]);
  useEffect(() => {
    const changed = () => {
      const active = document.fullscreenElement === stage.current;
      setImmersive(active);
      frame.current?.contentWindow?.postMessage({ type: "devneya:immersive", active }, "*");
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const expand = async () => {
    try {
      if (document.fullscreenElement === stage.current) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
      setExpandError("");
    } catch { setExpandError("Your browser could not enter full screen. The experience is still available on the canvas."); }
  };
  const explore = async () => {
    const prompt = selection;
    setExploring(true);
    try {
      if (document.fullscreenElement === stage.current) {
        await document.exitFullscreen();
        // Restore the source card's measured height before placing its continuation.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      onExplore(prompt);
    } catch { setExpandError("Return to the canvas, then explore this selection."); }
    finally { setExploring(false); }
  };
  return <div ref={stage} className={`canvas-artifact nodrag nopan nowheel ${compact ? "compact-artifact" : ""}`}>
    {(!compact || immersive) && <div className="experience-toolbar"><span>{title}</span><button type="button" onClick={() => void expand()}>{immersive ? "Return to canvas ↙" : "Enter experience ⛶"}</button></div>}
    <iframe key={revision} ref={frame} title={title} srcDoc={srcDoc} onLoad={() => frame.current?.contentWindow?.postMessage({ type: "devneya:immersive", active: document.fullscreenElement === stage.current }, "*")} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" style={{ height }} />
    {compact && <div className="artifact-answer"><MarkdownText text={fallback} /></div>}
    <div className="artifact-caption">{compact ? <button type="button" aria-label={`Expand ${title}`} onClick={() => void expand()}>Expand ⛶</button> : <span>Made for this question · yours to explore</span>}<button type="button" onClick={() => { setRevision((value) => value + 1); setSelection(""); setHeight(artifact.height); }}>Reset visual</button></div>
    {expandError && <p role="status" className="artifact-alternative">{expandError}</p>}
    {selection && <div className="artifact-selection">{compact ? <details><summary>Current view</summary><p>{selection}</p></details> : <p>{selection}</p>}<button type="button" disabled={opened || exploring} onClick={() => void explore()}>{opened ? "Opened on canvas ✓" : compact ? "Ask about this view ↗" : "Explore this selection ↗"}</button></div>}
    {!compact && <details className="artifact-alternative"><summary>About this visual</summary><p>{fallback}</p><p>Controls reset on reload. Exploring a selection keeps its values in the new prompt.</p></details>}
  </div>;
};
