import { Session } from "@supabase/supabase-js";
import { createContext } from "react";

export const SessionContext = createContext<Session | null>(null);

export const VirtualKeyContext = createContext<string | null>(null);
