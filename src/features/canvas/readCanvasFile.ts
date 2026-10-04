import { MAX_FILE_BYTES, storedFileSchema } from "../../domain/files";
import { LIMITS } from "../../domain/limits";
import type { ManualTextData } from "../../domain/types";
import { isSafeSvg } from "../../domain/images";

export const readCanvasFile = async (file: File): Promise<ManualTextData> => {
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Choose a non-empty file up to 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = String.fromCharCode(...bytes.slice(0, 12));
  const mimeType = head.startsWith("%PDF-") ? "application/pdf" : head.startsWith("\x89PNG\r\n\x1a\n") ? "image/png"
    : head.startsWith("\xff\xd8\xff") ? "image/jpeg" : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP" ? "image/webp" : undefined;
  const title = file.name.slice(0, LIMITS.maxNodeTitleCodePoints);
  const upload = { name: file.name.slice(0, 120), size: file.size };
  if (mimeType) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    const attachment = storedFileSchema.parse({ name: file.name.slice(0, 120), mimeType, size: file.size, dataUrl: `data:${mimeType};base64,${btoa(binary)}` });
    return { kind: "text", origin: "manual", title, text: "", upload, files: [attachment] };
  }
  if (file.size > LIMITS.maxTextBytes) throw new Error("Text files must be up to 64 KB.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("Supported uploads: UTF-8 text/code, PNG, JPEG, WebP and PDF."); }
  if ([...text].some(character => character.charCodeAt(0) < 32 && !"\t\n\r".includes(character))) throw new Error("Supported uploads: UTF-8 text/code, PNG, JPEG, WebP and PDF.");
  if (/\.svg$/i.test(file.name) && isSafeSvg(text.trim())) return { kind: "text", origin: "manual", title, text: "", upload, images: [{ name: upload.name, mimeType: "image/svg+xml", source: text.trim() }] };
  return { kind: "text", origin: "manual", title, text, upload };
};
