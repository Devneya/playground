import { z } from "zod";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_REQUEST_FILE_BYTES = 4 * 1024 * 1024;
export const uploadInfoSchema = z.object({ name: z.string().min(1).max(120), size: z.number().int().positive().max(MAX_FILE_BYTES) }).strict();
export type UploadInfo = z.infer<typeof uploadInfoSchema>;
export const storedFileSchema = z.object({
  name: z.string().min(1).max(120),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "application/pdf"]),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  dataUrl: z.string().max(Math.ceil(MAX_FILE_BYTES / 3) * 4 + 64),
}).strict().refine(file => {
  const prefix = `data:${file.mimeType};base64,`;
  if (!file.dataUrl.startsWith(prefix)) return false;
  const encoded = file.dataUrl.slice(prefix.length);
  if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (encoded.length * 3 / 4 - padding !== file.size) return false;
  const head = atob(encoded.slice(0, 16));
  return file.mimeType === "application/pdf" ? head.startsWith("%PDF-")
    : file.mimeType === "image/png" ? head.startsWith("\x89PNG\r\n\x1a\n")
      : file.mimeType === "image/jpeg" ? head.startsWith("\xff\xd8\xff")
        : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
}, "The file data does not match its format or size.");
export type StoredFile = z.infer<typeof storedFileSchema>;
