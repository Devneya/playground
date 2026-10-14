import { useEffect, useMemo, useState, type PropsWithChildren } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { revokeSession } from "../api/account";
import { toGoTrueAccessToken } from "../api/credentials";
import { normalizeApiError } from "../api/errors";
import { apiBaseUrl } from "../config";
import { clearAuthStorage, recoveryState, supabase } from "./gotrueClient";
import { rewriteGoTrueAuthUrl } from "./createGoTrueClient";
import { AuthContext, type AuthState } from "./useAuth";

const authError = (error: unknown) => normalizeApiError(error).message;
// GoTrue's domain allowlist includes a path; the root callback needs its slash.
const authRedirectUrl = () => new URL("/", globalThis.location.origin).href;

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<AuthState>({ session: null, user: null, initializing: true, recovery: false });

  useEffect(() => {
    let mounted = true;
    const syncRefresh = () => {
      if (document.visibilityState === "visible") void supabase.auth.startAutoRefresh?.();
      else void supabase.auth.stopAutoRefresh?.();
    };
    document.addEventListener("visibilitychange", syncRefresh);
    syncRefresh();
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        setState({ session: null, user: null, initializing: false, recovery: false });
        return;
      }
      setState((previous) => ({ session: data.session, user: data.session?.user ?? null, initializing: false, recovery: Boolean(data.session) && ((previous.recovery && previous.user?.id === data.session?.user.id) || recoveryState.isRecoverySession(data.session)) }));
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (!mounted) return;
      setState((previous) => ({ session, user: session?.user ?? null, initializing: false, recovery: Boolean(session) && (event === "PASSWORD_RECOVERY" || recoveryState.isRecoverySession(session) || (previous.recovery && previous.user?.id === session?.user.id)) }));
    });
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", syncRefresh);
      void supabase.auth.stopAutoRefresh?.();
      subscription.subscription.unsubscribe();
    };
  }, []);

  const actions = useMemo(() => ({
    async login(email: string, password: string) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(authError(error));
    },
    async signup(email: string, password: string) {
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: authRedirectUrl() } });
      if (error) throw new Error(authError(error));
    },
    async sendRecovery(email: string) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() });
      if (error) throw new Error(authError(error));
    },
    async updatePassword(password: string) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(authError(error));
      recoveryState.clear();
      setState((previous) => ({ ...previous, recovery: false }));
    },
    async signInWithOAuth(provider: "google" | "github") {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: authRedirectUrl(), skipBrowserRedirect: true },
      });
      if (error) throw new Error(authError(error));
      if (!data.url) throw new Error("Could not generate the OAuth sign-in URL.");
      globalThis.location.assign(rewriteGoTrueAuthUrl(data.url, apiBaseUrl));
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
