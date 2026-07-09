import {Template, TemplateMetadata} from "../../logic/flowStore/interfaces";
import {parseTemplateFlow, FlowSnapshot} from "../../logic/flowSnapshot";
import {blobToB64} from "../../logic/utils";

let templatesMetadataCache: Map<string, TemplateMetadata> | null = null;
let metadataLoading: Promise<void> | null = null;
let screenshotsLoading: Promise<void> | null = null;
let templatesFlowCache: Map<string, Template> = new Map();
let flowLoading: Map<string, Promise<Template>> = new Map();

async function loadManifest(manifestUrl: string): Promise<TemplateMetadata[]> {
  if (!manifestUrl) {
    throw new Error("Template index URL is required");
  }

  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to load template index: ${response.statusText}`);
  }

  const data = await response.json();

  try {
    if (!data.templates || !Array.isArray(data.templates)) {
      throw new Error("Invalid index structure");
    }
    return data.templates.map((entry: any) => {
      if (!entry.name || !entry.path) {
        throw new Error(`Invalid template entry: missing required fields (name or path)`);
      }
      return {
        id: entry.id || entry.name.toLowerCase().replace(/\s+/g, "_"),
        name: entry.name,
        description: entry.description || "",
        path: entry.path,
        screenshotPath: entry.screenshotPath,
      };
    });
  } catch (e: any) {
    throw new Error(`Failed to parse template index: ${e.toString()}`);
  }
}

async function loadScreenshot(screenshotPath: string): Promise<string | undefined> {
  try {
    if (screenshotPath.startsWith("data:")) {
      return screenshotPath;
    }

    const response = await fetch(screenshotPath);
    if (!response.ok) {
      return undefined;
    }
    const blob = await response.blob();
    const base64 = await blobToB64(blob);
    return `data:image/png;base64,${base64}`;
  } catch (e: any) {
    console.warn(`Failed to load screenshot from ${screenshotPath}: ${e.toString()}`);
    return undefined;
  }
}

async function loadTemplateFile(path: string): Promise<FlowSnapshot> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load template file: ${response.statusText}`);
  }

  const data = await response.json();

  try {
    const flowData = data.flow || data;
    return parseTemplateFlow(flowData);
  } catch (e: any) {
    throw new Error(`Failed to parse template file: ${e.toString()}`);
  }
}

async function loadTemplatesMetadata(manifestUrl: string): Promise<Map<string, TemplateMetadata>> {
  const metadataMap = new Map<string, TemplateMetadata>();
  const templates = await loadManifest(manifestUrl);

  for (const entry of templates) {
    metadataMap.set(entry.id, {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      path: entry.path,
      screenshotPath: entry.screenshotPath,
    });
  }

  return metadataMap;
}

export async function loadTemplatesScreenshots(): Promise<void> {
  if (!templatesMetadataCache) {
    throw new Error("Templates metadata not loaded yet");
  }

  if (screenshotsLoading) {
    return screenshotsLoading;
  }

  const allScreenshotsLoaded = Array.from(templatesMetadataCache.values()).every((metadata) => {
    const cached = templatesFlowCache.get(metadata.id);
    return !metadata.screenshotPath || cached?.screenshotBase64;
  });

  if (allScreenshotsLoaded) {
    return Promise.resolve();
  }

  screenshotsLoading = (async () => {
    try {
      const loadPromises = Array.from(templatesMetadataCache!.entries()).map(async ([id, metadata]) => {
        const cached = templatesFlowCache.get(id);
        if (cached?.screenshotBase64 || !metadata.screenshotPath) {
          return;
        }

        try {
          const screenshotBase64 = await loadScreenshot(metadata.screenshotPath);
          if (screenshotBase64) {
            if (cached) {
              templatesFlowCache.set(id, {...cached, screenshotBase64});
            } else {
              templatesFlowCache.set(id, {
                id: metadata.id,
                name: metadata.name,
                description: metadata.description,
                screenshotBase64,
              });
            }
          }
        } catch (e: any) {
          console.warn(`Failed to load screenshot for template ${id}: ${e.toString()}`);
        }
      });

      await Promise.allSettled(loadPromises);
    } finally {
      screenshotsLoading = null;
    }
  })();

  return screenshotsLoading;
}

export function preloadTemplates(manifestUrl: string): Promise<void> {
  if (metadataLoading) {
    return metadataLoading;
  }

  if (templatesMetadataCache) {
    return Promise.resolve();
  }

  metadataLoading = (async () => {
    try {
      templatesMetadataCache = await loadTemplatesMetadata(manifestUrl);
    } catch (e: any) {
      console.error(`Failed to preload templates: ${e.toString()}`);
      templatesMetadataCache = new Map();
      throw e;
    } finally {
      metadataLoading = null;
    }
  })();

  return metadataLoading;
}

export function getTemplateMetadata(id: string): TemplateMetadata {
  if (!templatesMetadataCache) {
    throw new Error("Templates metadata not loaded yet");
  }

  const metadata = templatesMetadataCache.get(id);
  if (!metadata) {
    throw new Error(`Template metadata not found: ${id}`);
  }

  return metadata;
}

export function getAllTemplateMetadata(): (TemplateMetadata | Template)[] {
  if (!templatesMetadataCache) {
    return [];
  }

  return Array.from(templatesMetadataCache.values()).map((metadata) => {
    const cached = templatesFlowCache.get(metadata.id);
    return cached || metadata;
  });
}

export async function loadTemplate(id: string): Promise<Template> {
  const cached = templatesFlowCache.get(id);
  if (cached?.flow) {
    return cached;
  }

  const loading = flowLoading.get(id);
  if (loading) {
    return loading;
  }

  const metadata = getTemplateMetadata(id);
  if (!metadata.path) {
    throw new Error(`Template ${id} has no path specified`);
  }

  const loadPromise = (async (): Promise<Template> => {
    try {
      const flow = await loadTemplateFile(metadata.path!);
      const existing = templatesFlowCache.get(id);

      const template: Template = {
        id: metadata.id,
        name: metadata.name,
        description: metadata.description,
        screenshotBase64: existing?.screenshotBase64,
        flow,
      };

      templatesFlowCache.set(id, template);
      flowLoading.delete(id);
      return template;
    } catch (e: any) {
      flowLoading.delete(id);
      throw new Error(`Failed to load template: ${e.toString()}`);
    }
  })();

  flowLoading.set(id, loadPromise);
  return loadPromise;
}

export function getTemplate(id: string): Template | null {
  const cached = templatesFlowCache.get(id);
  return cached?.flow ? cached : null;
}
