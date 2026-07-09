import useFlowStore from "./flowStore/flowStore";

let initialized = false;
let unsubscribers: Array<() => void> = [];

/**
 * Initializes autosave. Attaches visibility handler to save immediately when the tab is hidden.
 */
export function initAutosave() {
  if (initialized) return;
  initialized = true;

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      void useFlowStore.getState().saveNow();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  unsubscribers.push(() =>
    document.removeEventListener("visibilitychange", handleVisibilityChange)
  );
}

export function stopAutosave() {
  for (const unsub of unsubscribers) {
    try {
      unsub();
    } catch {
    }
  }
  unsubscribers = [];
  initialized = false;
}