import { z } from "zod";
import { utf8ByteLength } from "./limits";

const elements = new Set("svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath title desc".toLowerCase().split(" "));
const attributes = new Set("xmlns viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray opacity transform id clip-path offset stop-color stop-opacity gradientUnits gradientTransform font-family font-size font-weight text-anchor dominant-baseline preserveAspectRatio role aria-label aria-labelledby aria-describedby aria-hidden".toLowerCase().split(" "));

/** Only passive vector primitives; an image is never mounted as model-authored DOM. */
export const isSafeSvg = (source: string): boolean => {
  if (utf8ByteLength(source) > 128 * 1024 || !/^\s*<svg\s/.test(source) || /<!|<\?|&(?!(?:amp|lt|gt|quot|apos);)/.test(source)) return false;
  if ([...source].some(character => character.charCodeAt(0) < 32 && !"\t\n\r".includes(character))) return false;
  const stack: string[] = [];
  let end = 0, roots = 0;
  for (const match of source.matchAll(/<([^<>]+)>/g)) {
    if (source.slice(end, match.index).includes("<") || (!stack.length && source.slice(end, match.index).trim())) return false;
    const tag = match[1]!;
    const closing = /^\//.test(tag), selfClosing = /\/\s*$/.test(tag);
    const name = /^\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(tag)?.[1]?.toLowerCase();
    if (!name || !elements.has(name)) return false;
    if (closing) {
      if (tag.trim() !== `/${name}` && tag.trim().toLowerCase() !== `/${name}`) return false;
      if (stack.pop() !== name) return false;
    } else {
      if (!stack.length && (name !== "svg" || ++roots > 1)) return false;
      let rest = tag.slice(name.length).replace(/\/\s*$/, "");
      const seen = new Set<string>();
      while (rest.trim()) {
        const attr = /^\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(["'])([^<>]*?)\2/.exec(rest);
        if (!attr) return false;
        const key = attr[1]!.toLowerCase(), value = attr[3]!;
        if (!attributes.has(key) || seen.has(key) || /javascript:|data:|https?:|\/\/|\\/i.test(value) && !(key === "xmlns" && value === "http://www.w3.org/2000/svg")) return false;
        if (/url\s*\(/i.test(value) && !/^url\(#[a-zA-Z][\w-]*\)$/.test(value)) return false;
        seen.add(key); rest = rest.slice(attr[0].length);
      }
      if (!selfClosing) stack.push(name);
    }
    end = match.index! + match[0].length;
  }
  return roots === 1 && !stack.length && !source.slice(end).trim();
};

export const storedImageSchema = z.object({
  name: z.string().min(1).max(120),
  mimeType: z.literal("image/svg+xml"),
  source: z.string().refine(isSafeSvg, "The drawing must contain only passive SVG primitives."),
}).strict();
export type StoredImage = z.infer<typeof storedImageSchema>;

export const drawingInstructions = "Answer directly using Markdown. When asked to draw, create an actual vector illustration, not ASCII art. Put one complete SVG in a fenced svg block, with xmlns and a viewBox, using only svg, g, path, rect, circle, ellipse, line, polyline, polygon, text, tspan, defs, linearGradient, radialGradient, stop, clipPath, title and desc. Use quoted attributes; no scripts, style elements, CSS style attributes, foreignObject, links, external images, entities or embedded data. The app renders it as a locally stored image. Make the requested subject clear, with careful proportions. Use the conversation to resolve 'it' and revision requests. Ordinary answers stay Markdown; code and ASCII art use fenced code blocks.";

export const extractDrawings = (text: string): { text: string; images?: StoredImage[] } => {
  const images: StoredImage[] = [];
  const prose = text.replace(/```svg\s*\n([\s\S]*?)\n```/gi, (block, source: string) => {
    source = source.replace(/<!--[\s\S]*?-->/g, "").trim();
    if (images.length >= 3 || !isSafeSvg(source)) return block;
    const title = /<title>([^<]{1,100})<\/title>/.exec(source)?.[1] ?? `Drawing ${images.length + 1}`;
    images.push({ name: title, mimeType: "image/svg+xml", source });
    return "";
  }).trim();
  return { text: prose || (images.length ? "Generated drawing." : text), ...(images.length ? { images } : {}) };
};
