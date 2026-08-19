import { useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { revokeSession } from "../api/account";
import { toGoTrueAccessToken } from "../api/credentials";
import { normalizeApiError } from "../api/errors";
import { clearAuthStorage, supabase } from "./gotrueClient";
import { AuthContext, type AuthState } from "./useAuth";

const authError = (error: unknown) => normalizeApiError(error).message;

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<AuthState>({ session: null, user: null, initializing: true, recovery: false });

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        setState({ session: null, user: null, initializing: false, recovery: false });
        return;
      }
      setState({ session: data.session, user: data.session?.user ?? null, initializing: false, recovery: false });
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (!mounted) return;
      setState((previous) => ({ session, user: session?.user ?? null, initializing: false, recovery: event === "PASSWORD_RECOVERY" || previous.recovery }));
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const actions = useMemo(() => ({
    async login(email: string, password: string) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(authError(error));
    },
    async signup(email: string, password: string) {
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: globalThis.location?.origin } });
      if (error) throw new Error(authError(error));
    },
    async sendRecovery(email: string) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: globalThis.location?.origin });
      if (error) throw new Error(authError(error));
    },
    async updatePassword(password: string) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(authError(error));
      setState((previous) => ({ ...previous, recovery: false }));
    },
    async signInWithOAuth(provider: "google" | "github") {
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: globalThis.location?.origin } });
      if (error) throw new Error(authError(error));
    },
    async signOut() {
      const accessToken = state.session?.access_token;
      const remoteCalls: Promise<unknown>[] = [supabase.auth.signOut({ scope: "global" })];
      if (accessToken) remoteCalls.unshift(revokeSession(toGoTrueAccessToken(accessToken)));
      await Promise.allSettled(remoteCalls);
      clearAuthStorage();
      setState({ session: null, user: null, initializing: false, recovery: false });
    },
  }), [state.session?.access_token]);

  return <AuthContext.Provider value={{ ...state, ...actions }}>{children}</AuthContext.Provider>;
};
