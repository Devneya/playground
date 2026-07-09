import {FlowSnapshot, parseFlow} from "./flowSnapshot";
import {SNAPSHOTS_BUCKET_NAME} from "../config/constants";
import {supabase} from "../supabase";
import {initialFlow} from "../config/initialFlow";
import {Canvas} from "./flowStore/interfaces";

/**
 * Loads a flow snapshot for a specific canvas from the user's storage in Supabase.
 * Checks the version of the snapshot to ensure compatibility.
 * @returns {Promise<FlowSnapshot>} The FlowSnapshot if successful.
 * @throws An error if the user is not authorized or the flow cannot be loaded.
 */
export async function loadFlow(canvasId?: string): Promise<FlowSnapshot> {
  const {
    data: {user},
    error: userError
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(`Error on loading flow from user storage: ${userError.message}`);
  }

  if (!user) {
    throw new Error("Error on loading flow from user storage: not authorized.");
  }

  let filePath: string;
  if (!canvasId || (canvasId && canvasId.trim().length === 0)) {
    filePath = `${user.id}/flow.json`;
  } else {
    filePath = `${user.id}/flow-${canvasId}.json`;
  }

  let result;
  try {
    result = await supabase.storage
      .from(SNAPSHOTS_BUCKET_NAME)
      .download(filePath);

    if (result.error || !result.data) {
      const errorMessage = result.error?.message || "Unknown error";
      const isNotFound =
        errorMessage.includes("404") ||
        errorMessage.includes("not found") ||
        errorMessage.includes("NotFound") ||
        errorMessage.includes("The resource was not found");

      if (isNotFound) {
        throw new Error("FILE_NOT_FOUND");
      }

      console.error(`Error on loading flow from user storage: ${errorMessage}.`);
      return initialFlow;
    }
  } catch (e: any) {
    console.error(`Unexpected error while loading flow: ${e.toString()}`);
    return initialFlow;
  }

  try {
    return parseFlow(JSON.parse(await result.data.text()));
  } catch (e: any) {
    throw new Error(`Error parsing flow data: ${e.toString()}`);
  }
}

/**
 * Saves a flow snapshot to the user's storage in Supabase.
 * The snapshot is versioned before saving.
 * @param snapshot - The FlowSnapshot to save.
 * @param canvasId - ID of the canvas to save.
 * @returns {Promise<Error | void>} Resolves if the save is successful.
 */
export async function saveFlowInUserStorage(
  snapshot: FlowSnapshot,
  canvasId?: string,
): Promise<boolean> {
  const {
    data: {user},
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("Error on saving flow in user storage: not authorized.");
    return false;
  }

  if (!canvasId) {
    canvasId = await getLastOpenedCanvasId() ?? undefined;
  }

  if (!canvasId) {
    return false;
  }

  try {
    const result = await supabase.storage.from(SNAPSHOTS_BUCKET_NAME).upload(
      `${user.id}/flow-${canvasId}.json`,
      new Blob([JSON.stringify(snapshot)], {
        type: "application/json",
      }),
      {upsert: true}
    );
    if (result.error) {
      console.error(`Error on saving flow in user storage: ${result.error.message}.`);
      return false;
    }
    await setLastOpenedCanvasId(canvasId);
    console.log("Flow saved successfully in user storage.");
    return true;
  } catch (e: any) {
    console.error(`Unexpected error while saving flow: ${e.toString()}`);
    return false;
  }
}

export async function getLastOpenedCanvasId(): Promise<string | null> {
  const {data, error} = await supabase.auth.getUser();
  if (error) {
    return null;
  }
  return data?.user?.user_metadata?.last_opened_canvas_id;
}

export async function setLastOpenedCanvasId(canvasId: string): Promise<boolean> {
  const {
    data: {user},
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return false;
  }

  try {
    const {error: updateError} = await supabase.auth.updateUser({
      data: {last_opened_canvas_id: canvasId},
    });
    return !updateError;
  } catch (e: any) {
    console.error(`Error while setting last opened canvas: ${e.toString()}`);
    return false;
  }
}

/**
 * Deletes a flow snapshot file from the user's storage in Supabase.
 * @param canvasId - ID of the canvas whose flow should be deleted.
 * @returns {Promise<boolean>} Returns true if the file was deleted successfully or didn't exist, false on error.
 */
export async function deleteFlowFromStorage(canvasId: string): Promise<boolean> {
  const {
    data: {user},
  } = await supabase.auth.getUser();

  if (!user || !canvasId) {
    return false;
  }

  try {
    const filePath = `${user.id}/flow-${canvasId}.json`;
    const {error} = await supabase.storage
      .from(SNAPSHOTS_BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      return error.message.includes("not found") || error.message.includes("NotFound");
    }
    return true;
  } catch (e: any) {
    console.error(`Error while deleting flow: ${e.toString()}`);
    return false;
  }
}

/**
 * Loads and sets the last opened canvas index based on user metadata and available canvases.
 * If lastCanvasId exists in canvases, use it, otherwise use first canvas as fallback.
 * If no canvases exist, creates a new canvas.
 *
 * @param getCanvases - Function to get all canvases from store
 * @param getCanvasById - Function to get canvas by ID from store
 * @param addNewCanvas - Function to add new canvas to store
 * @returns {Promise<string>} The canvas ID that was set (always returns a string)
 */
export async function loadLastOpenedCanvasId(
  getCanvases: () => Canvas[],
  getCanvasById: (id: string) => Canvas | null,
  addNewCanvas: (data?: Partial<Pick<Canvas, "snapshotJson" | "screenshotBase64">> & {
    originalName?: string
  }) => Canvas
): Promise<string> {
  const canvases = getCanvases();
  let currentCanvasId;

  const lastCanvasId = await getLastOpenedCanvasId();

  if (lastCanvasId) {
    let lastCanvas = getCanvasById(lastCanvasId);
    if (lastCanvas) {
      currentCanvasId = lastCanvasId;
    }
  }

  if (!currentCanvasId && canvases.length > 0) {
    const fallback = canvases[0];
    await setLastOpenedCanvasId(fallback.id);
    currentCanvasId = fallback.id;
  }

  if (!currentCanvasId) {
    // Migration: Check for old flow.json format (single canvas)
    let flowForNewCanvas: FlowSnapshot;
    try {
      flowForNewCanvas = await loadFlow();
    } catch (e: any) {
      flowForNewCanvas = initialFlow;
    }

    // Create canvas with migrated flow or initialFlow
    const newCanvas = addNewCanvas({
      snapshotJson: JSON.stringify(flowForNewCanvas)
    });
    await setLastOpenedCanvasId(newCanvas.id);
    await saveFlowInUserStorage(flowForNewCanvas, newCanvas.id);
    currentCanvasId = newCanvas.id;
  }
  return currentCanvasId;
}