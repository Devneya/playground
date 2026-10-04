// @vitest-environment node
import { describe, expect, it } from "vitest";
import { storedFileSchema, MAX_FILE_BYTES } from "../../src/domain/files";
import { readCanvasFile } from "../../src/features/canvas/readCanvasFile";
import { defaultEffort } from "../../src/domain/reasoning";

const pdf = Buffer.from("%PDF-1.4\nexample\n%%EOF");
describe("local canvas uploads", () => {
  it("identifies uploaded text separately and stores PDFs and images as bounded inline files", async () => {
    expect(await readCanvasFile(new File(["# Hello 🌱"], "notes.md"))).toMatchObject({ title: "notes.md", text: "# Hello 🌱" });
    const data = await readCanvasFile(new File([pdf], "notes.pdf"));
    expect(data.files?.[0]).toEqual({ name: "notes.pdf", size: pdf.length, mimeType: "application/pdf", dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}` });
    for (const [mime, source] of [["image/png", "\x89PNG\r\n\x1a\n"], ["image/jpeg", "\xff\xd8\xff"], ["image/webp", "RIFF0000WEBP"]]) {
      const bytes = Buffer.from(source!, "latin1");
      const result = await readCanvasFile(new File([bytes], "image"));
      expect(result.files?.[0]?.mimeType).toBe(mime);
      expect(storedFileSchema.safeParse(result.files?.[0]).success).toBe(true);
    }
  });
  it("previews passive uploaded SVGs and keeps unsafe SVGs as text", async () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="gray"/></svg>';
    const drawing = await readCanvasFile(new File([source], "drawing.svg"));
    expect(drawing).toMatchObject({ text: "", upload: { name: "drawing.svg", size: source.length }, images: [{ mimeType: "image/svg+xml", source }] });
    const unsafe = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    expect(await readCanvasFile(new File([unsafe], "unsafe.svg"))).toMatchObject({ text: unsafe, upload: { name: "unsafe.svg" } });
    expect((await readCanvasFile(new File([unsafe], "unsafe.svg"))).images).toBeUndefined();
  });
  it("rejects binary, malformed, mismatched, empty and oversized files", async () => {
    const valid = { name: "report.pdf", mimeType: "application/pdf", size: pdf.length, dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}` };
    for (const change of [{ dataUrl: "https://example.test/file.pdf" }, { dataUrl: "data:application/pdf;base64,!!!!!" }, { size: 2 }, { mimeType: "image/png" }, { size: MAX_FILE_BYTES + 1 }]) expect(storedFileSchema.safeParse({ ...valid, ...change }).success).toBe(false);
    await expect(readCanvasFile(new File([], "empty.txt"))).rejects.toThrow("non-empty");
    await expect(readCanvasFile(new File([new Uint8Array(MAX_FILE_BYTES + 1)], "large.pdf"))).rejects.toThrow("2 MB");
    await expect(readCanvasFile(new File(["x".repeat(65537)], "large.txt"))).rejects.toThrow("64 KB");
    await expect(readCanvasFile(new File([new Uint8Array([255])], "binary.bin"))).rejects.toThrow("Supported");
    await expect(readCanvasFile(new File(["a\0b"], "binary.txt"))).rejects.toThrow("Supported");
  });
});
it("derives effort defaults from live capabilities", () => {
  const model = { id: "model", object: "model" as const, created: 0, owned_by: "devneya" as const };
  expect(defaultEffort(undefined)).toBeUndefined();
  expect(defaultEffort({ ...model, supportedReasoningEfforts: ["low", "xhigh"], defaultReasoningEffort: "low" })).toBe("xhigh");
  expect(defaultEffort({ ...model, supportedReasoningEfforts: ["low"], defaultReasoningEffort: "low" })).toBe("low");
  expect(defaultEffort({ ...model, supportedReasoningEfforts: ["medium"] })).toBe("medium");
});
