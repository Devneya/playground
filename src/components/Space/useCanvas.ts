import {useCallback, useContext} from "react";
import JSZip from "jszip";
import saveAs from "file-saver";
import {toBlob} from "html-to-image";

import {
  Canvas,
  ContentResponse,
  isAudioResponse,
  isContentNode,
  isContentNodeData,
  isImageResponse,
  isPdfResponse,
  isTextResponse
} from "../../logic/flowStore/interfaces";
import {FlowSnapshot} from "../../logic/flowSnapshot";
import {blobToB64} from "../../logic/utils";
import {downloadFile} from "../../storage";
import useFlowStore from "../../logic/flowStore/flowStore";
import {SessionContext} from "../../context/supabaseContext";
import theme from "../../themes";
import {loadFlow, setLastOpenedCanvasId, saveFlowInUserStorage} from "../../logic/flowSaveAndLoad";
import {initialFlow} from "../../config/initialFlow";

type CanvasIndexFile = {
  canvases?: Canvas[];
};

/**
 * Creates a zip archive containing canvas content (texts, images, audio, PDF).
 * @param contentItems - Array of content items { prompt: string; response: ContentResponse }[]
 * @returns Promise<Blob> - Zip archive as a Blob
 */
export async function createContentZip(
  contentItems: { prompt: string; response: ContentResponse }[],
): Promise<Blob> {
  let textContent = "";
  let imgCounter = 1;
  let audioCounter = 1;
  let pdfCounter = 1;
  const zip = new JSZip();

  // Helper function to download and add file to zip
  const addFileToZip = async (
    filePath: string,
    zipPath: string,
    errorType: string
  ): Promise<boolean> => {
    try {
      const fileData = await downloadFile(filePath);
      if (fileData instanceof Error) {
        console.error(`Error loading ${errorType} when exporting content:`, fileData.message);
        return false;
      } else if (fileData instanceof Blob) {
        zip.file(zipPath, fileData);
        return true;
      } else {
        console.error(`Unexpected ${errorType} data type:`, typeof fileData);
        return false;
      }
    } catch (e) {
      console.error(`Unexpected error while downloading ${errorType} file:`, e);
      return false;
    }
  };

  for (const content of contentItems) {
    if (isTextResponse(content.response)) {
      textContent += `**Request:** ${
        content.prompt !== "" ? content.prompt : "Imported text:"
      }\n\n**Text:** ${
        content.response.text !== "" ? content.response.text : `""`
      }\n\n---\n\n`;
    } else if (isImageResponse(content.response)) {
      if (await addFileToZip(content.response.path, `images/image${imgCounter}.png`, "image")) {
        imgCounter++;
      }
    } else if (isAudioResponse(content.response)) {
      const ext = content.response.path.split(".").pop() || "audio";
      if (await addFileToZip(content.response.path, `audio/audio${audioCounter}.${ext}`, "audio")) {
        audioCounter++;
      }
    } else if (isPdfResponse(content.response)) {
      if (content.response.path) {
        if (await addFileToZip(content.response.path, `pdf/document${pdfCounter}.pdf`, "PDF")) {
          pdfCounter++;
        }
      }
    }
  }

  zip.file("textContent.md", textContent);
  const blob = await zip.generateAsync({type: "blob"});
  return blob;
}

export default function useCanvas() {
  const session = useContext(SessionContext);

  const setCurrentCanvasId = useFlowStore.use.setCurrentCanvasId();
  const setCurrentState = useFlowStore.use.setCurrentState();
  const updateCanvasById = useFlowStore.use.updateCanvasById();
  const addNewCanvas = useFlowStore.use.addNewCanvas();
  const saveNow = useFlowStore.use.saveNow();
  const getCurrentCanvasId = useFlowStore.use.getCurrentCanvasId();
  const loadInitialFlow = useFlowStore.use.loadInitialFlow();
  const setStoreViewport = useFlowStore.use.setStoreViewport();
  const deleteCanvasById = useFlowStore.use.deleteCanvasById();
  const getCanvases = useFlowStore.use.getCanvases();
  const getCanvasSnapshot = useFlowStore.use.getCanvasSnapshot();

  const getIndexPath = (userId: string) => `${userId}/canvases-index.json`;

  // Loads the canvas index file from storage with cache-busting to ensure fresh data
  const loadCanvasIndex = useCallback(async (): Promise<Canvas[]> => {
    if (!session) {
      return [];
    }
    const indexPath = getIndexPath(session.user.id);
    const blobOrError = await downloadFile(indexPath, true);

    if (blobOrError instanceof Error) {
      // If index file doesn't exist yet, return empty array (first time user)
      if (blobOrError.message.includes("404") || blobOrError.message.includes("not found")) {
        return [];
      }
      throw new Error(`Failed to load canvas index: ${blobOrError.message}`);
    }

    try {
      const json = (await blobOrError.text()) as string;
      const data = JSON.parse(json) as CanvasIndexFile;

      let canvases = data.canvases || [];
      return canvases.map(c => ({
        ...c,
        snapshotJson: undefined
      }));
    } catch (e: any) {
      throw new Error(`Failed to parse canvas index: ${e.message || e.toString()}`);
    }
  }, [session]);

  // Captures a screenshot of the canvas viewport (nodes and edges only, without UI controls)
  const screenshotCanvas = useCallback(async (): Promise<Blob | null> => {
    try {
      let targetElement =
        document.querySelector(".react-flow__viewport") ||
        document.querySelector(".react-flow__container");

      if (!targetElement) {
        console.warn("Could not find ReactFlow viewport element for screenshot");
        return null;
      }

      const blob = await toBlob(targetElement as HTMLElement, {
        backgroundColor: theme.palette.background.default,
        pixelRatio: 1.5,
        quality: 0.9,
        skipFonts: true,
        cacheBust: false,
        width: (targetElement as HTMLElement).offsetWidth,
        height: (targetElement as HTMLElement).offsetHeight,
      });

      return blob || null;
    } catch (e) {
      console.error("Failed to create screenshot:", e);
      return null;
    }
  }, []);

  // Saves the current canvas screenshot as base64 to the canvas store
  const saveScreenshotToStore = useCallback(async (): Promise<void> => {
    const currentId = getCurrentCanvasId();
    if (!currentId) return;

    const blob = await screenshotCanvas();
    if (!blob) return;

    const base64 = await blobToB64(blob);

    updateCanvasById(currentId, {
      screenshotBase64: base64
    });
  }, [screenshotCanvas, getCurrentCanvasId, updateCanvasById]);

  // Saves screenshot and flow state before opening the canvas list view
  const handleBeforeOpenSpace = useCallback(async () => {
    await saveScreenshotToStore();
    await saveNow();
  }, [saveScreenshotToStore, saveNow]);

  // Opens a canvas by setting it as current and loading its flow state
  const openCanvas = useCallback(
    async (canvas: Canvas) => {
      try {
        setCurrentCanvasId(canvas.id);
        const flow = await loadInitialFlow();
        const viewport = flow ?? {x: 0, y: 0, zoom: 0.9};
        setStoreViewport(viewport);
        updateCanvasById(canvas.id, {}); //to update last edit time of the canvas
        await setLastOpenedCanvasId(canvas.id);
        return canvas;
      } catch (e: any) {
        throw new Error(`Failed to open canvas "${canvas.name}": ${e.message || e.toString()}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setCurrentState, setCurrentCanvasId, updateCanvasById]
  );

  // Creates a new empty canvas and returns it
  const createCanvas = useCallback(async (): Promise<Canvas | undefined> => {
    if (!session) {
      throw new Error("Cannot create canvas: user session is not available");
    }
    try {
      const newCanvas = addNewCanvas();

      // Save flow to storage so it is available for export
      const flowSnapshot = JSON.parse(newCanvas.snapshotJson || JSON.stringify(initialFlow));
      await saveFlowInUserStorage(flowSnapshot, newCanvas.id);

      return newCanvas;
    } catch (e: any) {
      throw new Error(`Failed to create canvas: ${e.message || e.toString()}`);
    }
  }, [
    session,
    addNewCanvas,
  ]);

  // Renames a canvas by updating its name in the store
  const renameCanvas = useCallback(
    async (canvas: Canvas, name: string) => {
      try {
        if (!name.trim()) {
          throw new Error("Canvas name cannot be empty");
        }
        updateCanvasById(canvas.id, {name: name.trim()});
      } catch (e: any) {
        throw new Error(`Failed to rename canvas: ${e.message || e.toString()}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateCanvasById, session]
  );

  // Deletes a canvas and switches to another canvas if the deleted one was active
  const deleteCanvas = useCallback(
    async (canvas: Canvas) => {
      try {
        await deleteCanvasById(canvas.id);

        const currentId = getCurrentCanvasId();
        const canvases = getCanvases();

        if (currentId === canvas.id) {
          if (canvases.length > 0) {
            const newCurrent = canvases[0];
            setCurrentCanvasId(newCurrent.id);
            await setLastOpenedCanvasId(newCurrent.id);
          } else {
            setCurrentCanvasId(undefined);
          }
        }
      } catch (e: any) {
        throw new Error(`Failed to delete canvas "${canvas.name}": ${e.message || e.toString()}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getCurrentCanvasId, setCurrentCanvasId]
  );

  // Creates a duplicate of a canvas with the same content and screenshot
  const duplicateCanvas = useCallback(
    async (doc: Canvas): Promise<Canvas | undefined> => {
      try {
        return addNewCanvas({
          snapshotJson: doc.snapshotJson,
          screenshotBase64: doc.screenshotBase64,
          originalName: doc.name,
        });
      } catch (e: any) {
        throw new Error(`Failed to duplicate canvas "${doc.name}": ${e.message || e.toString()}`);
      }
    },
    [addNewCanvas]
  );

  // Exports canvas content (texts, images, audio, PDF) as a zip archive
  const exportCanvas = useCallback(
    async (canvas: Canvas) => {
      let snapshotJson = canvas.snapshotJson;
      let flowSnapshot: FlowSnapshot;

      if (!snapshotJson) {
        try {
          flowSnapshot = await loadFlow(canvas.id);
        } catch (e: any) {
          if (e.message === "FILE_NOT_FOUND") {
            const snapshotFromStore = getCanvasSnapshot(canvas.id);
            if (snapshotFromStore) {
              await saveFlowInUserStorage(snapshotFromStore, canvas.id);
              flowSnapshot = snapshotFromStore;
            } else {
              throw new Error(`Cannot export canvas "${canvas.name}": flow data not found in storage or memory`);
            }
          } else {
            throw new Error(`Failed to load canvas flow for export: ${e.message || e.toString()}`);
          }
        }
      } else {
        try {
          flowSnapshot = JSON.parse(snapshotJson);
        } catch (e: any) {
          const errorMessage = `Failed to parse canvas data for export: ${e.message || e.toString()}`;
          console.error(errorMessage, e);
          throw new Error(errorMessage);
        }
      }

      try {
        const contentItems: { prompt: string; response: ContentResponse }[] = [];
        flowSnapshot.nodes.forEach((node) => {
          if (isContentNode(node) && isContentNodeData(node.data)) {
            contentItems.push({
              prompt: node.data.prompt || "",
              response: node.data.response
            });
          }
        });

        const blob = await createContentZip(contentItems);
        saveAs(blob, `${canvas.name || "canvas"}.zip`);
      } catch (e: any) {
        const errorMessage = `Failed to create export archive: ${e.message || e.toString()}`;
        console.error(errorMessage, e);
        throw new Error(errorMessage);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return {
    createCanvas,
    deleteCanvas,
    renameCanvas,
    duplicateCanvas,
    exportCanvas,
    screenshotCanvas,
    openCanvas,
    loadCanvasIndex,
    saveScreenshotToStore,
    handleBeforeOpenSpace,
  };
}
