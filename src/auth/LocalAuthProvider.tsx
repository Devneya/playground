import type { PropsWithChildren } from "react";
import type { User } from "@supabase/supabase-js";
import { AuthContext } from "./useAuth";

// A local workspace identity, not a GoTrue session or a provider credential.
const user: User = { id: "local-codex-workspace", aud: "local", email: "Local Codex workspace", app_metadata: {}, user_metadata: {}, created_at: new Date(0).toISOString() };
const unavailable = async () => { throw new Error("Manage your Codex sign-in using codex login."); };
export const LocalAuthProvider = ({ children }: PropsWithChildren) => <AuthContext.Provider value={{ user, session: null, initializing: false, recovery: false, login: unavailable, signup: unavailable, sendRecovery: unavailable, updatePassword: unavailable, signInWithOAuth: unavailable, signOut: unavailable }}>{children}</AuthContext.Provider>;
