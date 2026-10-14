import { useEffect, useMemo, useRef } from "react";
import { workStateSchema, type WorkState } from "../../domain/experience";

const encoded = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
export const experienceDocument = (html: string, state: WorkState, token: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#f8f8f0;color:#293c36;font:16px/1.5 system-ui,sans-serif}button,input,select,textarea{font:inherit}button{cursor:pointer}:focus-visible{outline:3px solid #8d683d;outline-offset:3px}svg{max-width:100%}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}</style><script>(()=>{
let state=${encoded(state)},listeners=[],gesture=0,used=0,at=0,sequence=0;
const token=${encoded(token)},post=parent.postMessage.bind(parent),now=Date.now.bind(Date),clone=structuredClone,send=message=>post({...message,token},'*');document.currentScript.remove();
for(const name of ['pointerup','click','change','keydown'])addEventListener(name,event=>{if(event.isTrusted){gesture++;at=now()}},true);
Object.defineProperty(window,'studio',{value:Object.freeze({get state(){return clone(state)},commit(next,description){if(!gesture||used===gesture||now()-at>1500||typeof description!=='string'||!description.trim())return false;used=gesture;state=clone(next);send({type:'studio:commit',state,description:description.slice(0,500),sequence:++sequence});return true},onRestore(fn){listeners.push(fn);return()=>listeners=listeners.filter(item=>item!==fn)}}),writable:false,configurable:false});
addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='studio:restore')return;state=clone(event.data.state);listeners.forEach(fn=>fn(clone(state)))});
const editing=()=>send({type:'studio:editing',active:!!document.activeElement?.matches('input,textarea,[contenteditable=true]')});addEventListener('focusin',editing,true);addEventListener('focusout',()=>setTimeout(editing,0),true);
addEventListener('pointerdown',event=>{if(event.isTrusted)send({type:'studio:editing',active:true})},true);for(const name of ['pointerup','pointercancel'])addEventListener(name,()=>setTimeout(editing,0),true);
addEventListener('error',event=>send({type:'studio:error',message:String(event.message).slice(0,300)}));
addEventListener('unhandledrejection',()=>send({type:'studio:error',message:'An interaction failed in this version.'}));
})()</script></head><body>${html}</body></html>`;

export const ExperienceFrame = ({ html, state, title, onCommit, onError, onEditing }: { html: string; state: WorkState; title: string; onCommit(state: WorkState, description: string): void; onError(message: string): void; onEditing(active: boolean): void }) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useRef({ state, onCommit, onError, onEditing }); current.current = { state, onCommit, onError, onEditing };
  const document = useMemo(() => { const token = crypto.randomUUID(); return { token, html: experienceDocument(html, current.current.state, token) }; }, [html]);
  const active = useRef(document); active.current = document;
  const lastSequence = useRef({ token: "", value: 0 });
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow || !event.data || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      if (data.token !== active.current.token) return;
      if (data.type === "studio:editing" && typeof data.active === "boolean") { current.current.onEditing(data.active); return; }
      if (data.type === "studio:error" && typeof data.message === "string") { current.current.onError(data.message.slice(0, 300)); return; }
      if (data.type !== "studio:commit" || typeof data.sequence !== "number" || !Number.isSafeInteger(data.sequence) || data.sequence < 1 || typeof data.description !== "string" || !data.description.trim() || data.description.length > 500) return;
      if (lastSequence.current.token === data.token && data.sequence <= lastSequence.current.value) return;
      const parsed = workStateSchema.safeParse(data.state);
      if (!parsed.success) { current.current.onError("This interaction could not be saved: its state is too large or invalid."); return; }
      lastSequence.current = { token: active.current.token, value: data.sequence };
      current.current.onCommit(parsed.data, data.description);
    };
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: "studio:restore", state }, "*"); }, [state]);
  return <iframe className="experience-frame" ref={frame} title={title} srcDoc={document.html} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" onLoad={() => frame.current?.contentWindow?.postMessage({ type: "studio:restore", state: current.current.state }, "*")} />;
};
