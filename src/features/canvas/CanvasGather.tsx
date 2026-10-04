import { createContext, useContext } from "react";
export const CanvasGatherContext = createContext<{ ids: string[]; toggle: (id: string) => void } | null>(null);
export const useCanvasGather = () => useContext(CanvasGatherContext);
