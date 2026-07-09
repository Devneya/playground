import {Canvas} from "./interfaces";
import {StateCreator} from "zustand";
import {EdgeSlice} from "./edgeSlice";
import {ViewportSlice} from "./viewportSlice";
import {NodeSlice} from "./nodeSlice";
import {createFilename, getNextCanvasName} from "../utils";
import {Session} from "@supabase/supabase-js";
import {uploadFile} from "../../storage";
import {FlowSnapshot, parseFlow} from "../flowSnapshot";
import {initialFlow} from "../../config/initialFlow";
import {deleteFlowFromStorage} from "../flowSaveAndLoad";
import {supabase} from "../../supabase";

/*
 * Canvases' Architecture:
 * - Canvas index (canvases-index.json): Stores metadata for all canvases (id, name, lastEdit, screenshotBase64).
 *   Screenshots are stored as base64 in the index for fast access without additional storage requests.
 *   SnapshotJson (flow data) is NOT stored in the index to keep it lightweight.
 *
 * - Flow snapshots (flow-{canvasId}.json): Each canvas's flow data (nodes, edges, viewport) is stored separately
 *   in user storage. This separation allows lazy loading - flows are only fetched when opening or exporting a canvas,
 *   not when loading the canvas list.
 *
 * - Last opened canvas: Stored in user_metadata.last_opened_canvas_id for persistence across sessions.
 *
 * - Automatic persistence: Index is saved when metadata fields (name, screenshotBase64, lastEdit) are updated.
 */

/**
 * Canvas slice manages canvas state and persistence.
 * Handles canvas CRUD operations and index persistence to storage.
 */
export type CanvasSlice = {
  canvases: Canvas[];
  currentCanvasId: string | undefined;
  setCanvases: (docs: Canvas[]) => void;
  setCurrentCanvasId: (id: string | undefined) => void;

  getCanvases: () => Canvas[];
  getCurrentCanvasId: () => string | undefined;
  getCurrentCanvas: () => Canvas | null;
  getCanvasById: (id: string) => Canvas | null;
  updateCanvasById: (
    id: string,
    updates: Partial<
      Pick<Canvas, "name" | "screenshotBase64" | "snapshotJson">
    >
  ) => Canvas | undefined;
  addNewCanvas: (
    data?: Partial<Pick<Canvas, "snapshotJson" | "screenshotBase64">> & { originalName?: string }
  ) => Canvas;

  getCanvasSnapshot: (id: string) => FlowSnapshot | null;

  deleteCanvasById: (id: string) => Promise<void>;

  persistCanvasIndexNow: (session?: Session | null) => Promise<void>;
  schedulePersistCanvasIndex: () => void;
};

let persistIndexTimer: ReturnType<typeof setTimeout> | null = null;
const persistIndexDelay = 2000;
let isPersistingIndex = false;

export const createCanvasSlice: StateCreator<
  CanvasSlice & NodeSlice & EdgeSlice & ViewportSlice,
  [],
  [],
  CanvasSlice
> = (set, get) => ({
  canvases: [],
  currentCanvasId: undefined,

  setCanvases(canvases) {
    set({canvases: canvases});
  },

  setCurrentCanvasId(id) {
    set({currentCanvasId: id ?? undefined});
  },

  getCanvases() {
    return get().canvases;
  },

  getCurrentCanvasId() {
    return get().currentCanvasId;
  },

  getCurrentCanvas() {
    const currentId = get().currentCanvasId;
    if (!currentId) return null;
    return get().canvases.find((d) => d.id === currentId) ?? null;
  },

  getCanvasById(id) {
    return get().canvases.find((d) => d.id === id) ?? null;
  },

  updateCanvasById(id, updates) {
    const canvases = get().canvases;
    const canvas = canvases.find((d) => d.id === id);
    if (!canvas) return;

    const updated: Canvas = {
      ...canvas,
      ...updates,
      lastEdit: new Date().toISOString(),
    };
    const updatedCanvases = canvases.map((d) => (d.id === id ? updated : d));
    set({canvases: updatedCanvases});

    // Trigger index persistence if index fields are updated (name, screenshotBase64, lastEdit)
    const hasIndexFields = 'name' in updates || 'screenshotBase64' in updates;
    const isEmptyUpdate = Object.keys(updates).length === 0;
    if (hasIndexFields || isEmptyUpdate) {
      get().schedulePersistCanvasIndex();
    }

    return updated;
  },

  addNewCanvas(data) {
    const canvases = get().canvases;
    const name = data?.originalName
      ? getNextCanvasName(canvases, "New Canvas", data.originalName)
      : getNextCanvasName(canvases);

    const snapshotJson = data?.snapshotJson ?? JSON.stringify(initialFlow);

    const newCanvas: Canvas = {
      id: createFilename(),
      name,
      lastEdit: new Date().toISOString(),
      snapshotJson,
      screenshotBase64: data?.screenshotBase64 ?? undefined,
    };

    const updatedCanvases = [...canvases, newCanvas];
    set({canvases: updatedCanvases});

    get().schedulePersistCanvasIndex();
    return newCanvas;
  },

  getCanvasSnapshot(id) {
    const canvas = get().canvases.find((d) => d.id === id);
    if (!canvas || !canvas.snapshotJson) {
      return null;
    }
    try {
      return parseFlow(JSON.parse(canvas.snapshotJson));
    } catch (e: any) {
      console.error(`Failed to parse snapshot for canvas:`, e.message || e.toString());
      return null;
    }
  },

  async deleteCanvasById(id) {
    const canvases = get().canvases;
    const canvas = canvases.find((d) => d.id === id);
    if (!canvas) {
      return;
    }

    try {
      const flowDeleted = await deleteFlowFromStorage(id);
      if (!flowDeleted) {
        console.warn(`Failed to delete canvas flow from storage`);
      }
    } catch (e: any) {
      console.error(`Error deleting canvas flow from storage:`, e.message || e.toString());
    }

    const updatedCanvases = canvases.filter((d) => d.id !== id);
    set({canvases: updatedCanvases});

    get().schedulePersistCanvasIndex();
  },

  async persistCanvasIndexNow(session?: Session | null) {
    if (isPersistingIndex) {
      return;
    }
    isPersistingIndex = true;

    let activeSession = session;
    if (!activeSession) {
      const {data: {session: fetchedSession}} = await supabase.auth.getSession();
      activeSession = fetchedSession;
    }

    if (!activeSession) {
      console.warn("Cannot save canvas index: no active session available");
      isPersistingIndex = false;
      return;
    }

    try {
      const canvases = get().getCanvases();
      const canvasesWithoutSnapshot = canvases.map(({snapshotJson, ...rest}) => rest);
      const indexData = {canvases: canvasesWithoutSnapshot};
      const jsonString = JSON.stringify(indexData);

      const blob = new Blob([jsonString], {
        type: "application/json",
      });
      const uploadResult = await uploadFile(
        blob,
        "canvases-index",
        activeSession.user.id,
        activeSession.access_token
      );
      if (uploadResult) {
        throw new Error(`Failed to upload canvas index: ${uploadResult}`);
      }
    } catch (e: any) {
      const errorMessage = e.message || e.toString();
      console.error(`Failed to save canvas index: ${errorMessage}`, e);
    } finally {
      isPersistingIndex = false;
    }
  },

  schedulePersistCanvasIndex() {
    if (persistIndexTimer) {
      clearTimeout(persistIndexTimer);
    }
    persistIndexTimer = setTimeout(() => {
      persistIndexTimer = null;
      void get().persistCanvasIndexNow();
    }, persistIndexDelay);
  },
});