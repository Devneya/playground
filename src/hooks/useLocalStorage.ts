import { useState } from "react";

/**
 * Custom hook to manage state synchronized with localStorage.
 * @param keyName - The key to use in localStorage.
 * @param initState - The initial state to use if no value exists in localStorage.
 * @returns An array containing the current state, a function to update the state, and a function to remove the state.
 */
export const useLocalStorage = (keyName: string, initState: string) => {
  /**
   * Retrieves the current state from localStorage.
   * If no value exists, returns the initial state.
   */
  function getLocalStorageState() {
    const value = localStorage.getItem(keyName);
    if (value == null) return initState;
    return JSON.parse(value);
  }

  // State to manage the localStorage value
  const [localStorageState, setLocalStorageState] = useState(
    getLocalStorageState()
  );

  /**
   * Saves the given state to localStorage and updates the hook's state.
   * @param state - The new state to save.
   */
  function saveLocalStorageState(state: string) {
    localStorage.setItem(keyName, JSON.stringify(state));
    setLocalStorageState(state);
  }

  /**
   * Removes the state from localStorage and resets the hook's state to the initial state.
   */
  function removeLocalStorageState() {
    localStorage.removeItem(keyName);
    setLocalStorageState(initState);
  }

  // Return the current state, a function to update it, and a function to remove it
  return [localStorageState, saveLocalStorageState, removeLocalStorageState];
};
