import { useEffect, useMemo, useRef } from "react";
import { sceneStateSchema, type SceneState } from "../../domain/sceneState";
import type { SurfaceObject } from "../../domain/surface";

const encoded = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
/** Opaque origin + CSP: generated code sees only its own bounded state. */
export const sceneDocument = (html: string, state: SceneState, token: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:transparent;color:#253d32;font:16px/1.4 system-ui,sans-serif}button,input,select{font:inherit}button{cursor:pointer}:focus-visible{outline:3px solid #8d683d;outline-offset:3px}svg{max-width:100%}button:disabled{cursor:default}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}</style><script>(()=>{let state=${encoded(state)},listeners=[];let sequence=0;const emit=()=>listeners.forEach(fn=>fn(structuredClone(state)));window.workshop=Object.freeze({get state(){return structuredClone(state)},save(next){state=structuredClone(next);parent.postMessage({type:'devneya:state',token:${encoded(token)},state,sequence:++sequence},'*')},onRestore(fn){listeners.push(fn);return()=>{listeners=listeners.filter(item=>item!==fn)}}});addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='devneya:restore'||event.data.token!==${encoded(token)})return;state=structuredClone(event.data.state);emit()})})()</script></head><body>${html}</body></html>`;

export const Scene = ({ object, onState }: { object: SurfaceObject; onState(state: SceneState): void }) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useRef({ object, onState });
  current.current = { object, onState };
  // State edits must not reload the frame. Code changes intentionally rebuild it
  // from the latest saved state; undo/redo restore through the message bridge.
  const document = useMemo(() => { const token = crypto.randomUUID(); return { token, html: sceneDocument(object.html ?? "", current.current.object.state ?? {}, token) }; }, [object.html]);
  const activeDocument = useRef(document);
  activeDocument.current = document;
  const lastSent = useRef<string>("");
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow || !event.data || typeof event.data !== "object") return;
      const message = event.data as Record<string, unknown>;
      if (message.type !== "devneya:state" || message.token !== activeDocument.current.token) return;
      const parsed = sceneStateSchema.safeParse(message.state);
      if (!parsed.success) return;
      const next = JSON.stringify(parsed.data);
      if (next === JSON.stringify(current.current.object.state ?? {})) return;
      lastSent.current = next;
      current.current.onState(parsed.data);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    const next = JSON.stringify(object.state ?? {});
    if (next === lastSent.current) return;
    lastSent.current = next;
    frame.current?.contentWindow?.postMessage({ type: "devneya:restore", token: activeDocument.current.token, state: object.state ?? {} }, "*");
  }, [object.state]);
  return <div className="work-scene-stage nodrag nopan nowheel">
    <iframe ref={frame} title={object.title} srcDoc={document.html} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" style={{ height: object.height }} onLoad={() => frame.current?.contentWindow?.postMessage({ type: "devneya:restore", token: activeDocument.current.token, state: current.current.object.state ?? {} }, "*")} />
    <div className="work-scene-cue"><span>↔ {object.interaction}</span><small>Your changes are saved</small></div>
  </div>;
};
