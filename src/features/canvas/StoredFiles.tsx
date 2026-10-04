import type { StoredFile } from "../../domain/files";

export const StoredFiles = ({ files }: { files: StoredFile[] }) => <div className="stored-files">
  {files.map((file, index) => <figure key={index}>
    {file.mimeType.startsWith("image/") ? <img src={file.dataUrl} alt={file.name} /> : <div className="pdf-file"><strong>PDF</strong><span>{file.name}</span></div>}
    <figcaption><span>{file.name} · {Math.ceil(file.size / 1024)} KB</span><a className="nodrag nopan" href={file.dataUrl} download={file.name}>Download file</a></figcaption>
  </figure>)}
  <p className="file-context-hint">Connect this box to a prompt to include the file.</p>
</div>;
