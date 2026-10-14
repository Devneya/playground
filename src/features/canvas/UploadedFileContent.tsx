import type { StoredFile } from "../../domain/files";
import type { StoredImage } from "../../domain/images";
import { StoredFiles } from "./StoredFiles";
import { StoredImages } from "./StoredImages";

export const UploadedFileContent = ({ title, text, images, files, onEdit }: { title: string; text: string; images?: StoredImage[] | undefined; files?: StoredFile[] | undefined; onEdit(text: string): void }) => <div className="uploaded-file-content">
  {images?.length ? <><StoredImages images={images} /><details className="file-source nowheel"><summary>View SVG source</summary><pre>{images.map(image => image.source).join("\n\n")}</pre></details></> : null}
  {files?.length ? <StoredFiles files={files} /> : null}
  {!images?.length && !files?.length && <><pre className="file-text-preview nowheel">{text}</pre><details className="file-source nowheel"><summary>Edit text source</summary><textarea className="node-textarea file-source-editor nodrag nopan nowheel" aria-label={`${title} text`} value={text} onChange={event => onEdit(event.target.value)} /></details></>}
</div>;
