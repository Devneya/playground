import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

export type AuthState = {
  session: Session | null;
  user: User | null;
  initializing: boolean;
  recovery: boolean;
};

export type AuthActions = {
  login(email: string, password: string): Promise<void>;
  signup(email: string, password: string): Promise<void>;
  sendRecovery(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signInWithOAuth(provider: "google" | "github"): Promise<void>;
  signOut(): Promise<void>;
};

export const AuthContext = createContext<(AuthState & AuthActions) | null>(null);

export const useAuth = (): AuthState & AuthActions => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
};
