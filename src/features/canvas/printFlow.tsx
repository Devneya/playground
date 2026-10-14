import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { FlowDocument } from "../../domain/types";
import { MarkdownText } from "./MarkdownText";

const printStyles = `
  @page { size: A4; margin: 18mm; }
  body { color: #34463e; background: white; font: 16px/1.55 Georgia, serif; margin: 0; }
  h1 { font-size: 28px; } article { border: 1px solid #d8d0c4; border-radius: 10px; padding: 16px; margin: 16px 0; break-inside: avoid; }
  article.answer { background: #f3eee4; } article.note { background: #fff6c4; }
  header { font: 12px/1.4 system-ui, sans-serif; margin-bottom: 10px; } .prompt { text-align: right; white-space: pre-wrap; }
  p { margin: 0 0 .7em; } pre { font: 12px/1.5 monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  img { max-width: 100%; max-height: 140mm; display: block; margin: 10px auto; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; } th, td { border: 1px solid #ccc; padding: 6px; }
  blockquote { border-left: 2px solid #aaa; padding-left: 12px; } .file { font: 13px system-ui, sans-serif; }
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
`;

const PrintableFlow = ({ flow }: { flow: FlowDocument }) => <><h1>{flow.name}</h1>
  {[...flow.nodes].filter(node => node.data.kind !== "generation" || node.data.instruction.trim()).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x).map(node => <article key={node.id} className={node.data.kind === "generation" ? "prompt" : node.data.origin === "generated" ? "answer" : "note"}>
    <header>{node.data.kind === "generation" ? `Prompt · ${node.data.modelIds.join(" · ")}` : node.data.origin === "generated" ? `Response · ${node.data.title}` : node.data.title}</header>
    {node.data.kind === "generation" ? node.data.instruction : <>
      <MarkdownText text={node.data.text} />
      {node.data.images?.map((image, i) => <img key={i} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(image.source)}`} alt={image.name} />)}
      {node.data.origin === "manual" && node.data.files?.map((file, i) => file.mimeType.startsWith("image/") ? <img key={i} src={file.dataUrl} alt={file.name} /> : <p key={i} className="file">Attached PDF: {file.name}</p>)}
    </>}
  </article>)}
</>;

export const printFlow = (flow: FlowDocument, preview = window.open("", "_blank")) => {
  if (!preview) throw new Error("Allow the print preview popup, then try again.");
  preview.document.open(); preview.document.write('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="print-root"></div></body></html>'); preview.document.close();
  preview.document.title = `${flow.name} · Devneya`;
  const style = preview.document.createElement("style"); style.textContent = printStyles; preview.document.head.append(style);
  const root = createRoot(preview.document.getElementById("print-root")!);
  flushSync(() => root.render(<PrintableFlow flow={flow} />));
  void Promise.all([...preview.document.images].map(image => image.decode().catch(() => {}))).then(() => { preview.focus(); preview.print(); });
};
