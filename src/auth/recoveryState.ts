import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

/** Retain an early SDK recovery event until React mounts or password update finishes. */
export const createRecoveryState = () => {
  let recoveryUserId: string | null = null;
  return {
    observe(event: AuthChangeEvent, session: Session | null) {
      if (event === "PASSWORD_RECOVERY") recoveryUserId = session?.user.id ?? null;
      if (event === "SIGNED_OUT") recoveryUserId = null;
    },
    isRecoverySession(session: Session | null) {
      return Boolean(session && session.user.id === recoveryUserId);
    },
    clear() { recoveryUserId = null; },
  };
};
