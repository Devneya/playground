import { useMemo, useState, type PropsWithChildren } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { AuthContext, type AuthState } from "./useAuth";

type MockIdentity = { id: string; email: string };

const identityForEmail = (email: string): MockIdentity => ({
  id: email.toLowerCase().includes("user-b") ? "mock-user-b" : "mock-user-a",
  email,
});

const makeUser = (identity: MockIdentity): User => ({
  id: identity.id,
  aud: "authenticated",
  role: "authenticated",
  email: identity.email,
  email_confirmed_at: new Date(0).toISOString(),
  phone: "",
  confirmed_at: new Date(0).toISOString(),
  last_sign_in_at: new Date(0).toISOString(),
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
  is_anonymous: false,
} as User);

const makeSession = (identity: MockIdentity): Session => ({
  access_token: `mock-jwt-${identity.id}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `mock-refresh-${identity.id}`,
  user: makeUser(identity),
} as Session);

export const MockAuthProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<AuthState>(() => {
    const storedEmail = globalThis.sessionStorage?.getItem("devneya-mock-auth-email");
    if (!storedEmail) return { session: null, user: null, initializing: false, recovery: false };
    const session = makeSession(identityForEmail(storedEmail));
    return { session, user: session.user, initializing: false, recovery: false };
  });
  const actions = useMemo(() => ({
    async login(email: string, password: string) {
      if (!email || password.length < 8) throw new Error("Invalid credentials.");
      const identity = identityForEmail(email);
      const session = makeSession(identity);
      globalThis.sessionStorage?.setItem("devneya-mock-auth-email", email);
      setState({ session, user: session.user, initializing: false, recovery: false });
    },
    async signup() {},
    async sendRecovery() {},
    async updatePassword() {
      setState((previous) => ({ ...previous, recovery: false }));
    },
    async signInWithOAuth(provider: "google" | "github") {
      const identity = identityForEmail(`${provider}@mock.devneya.test`);
      const session = makeSession(identity);
      globalThis.sessionStorage?.setItem("devneya-mock-auth-email", identity.email);
      setState({ session, user: session.user, initializing: false, recovery: false });
    },
    async signOut() {
      globalThis.sessionStorage?.removeItem("devneya-mock-auth-email");
      setState({ session: null, user: null, initializing: false, recovery: false });
    },
  }), []);

  return <AuthContext.Provider value={{ ...state, ...actions }}>{children}</AuthContext.Provider>;
};
