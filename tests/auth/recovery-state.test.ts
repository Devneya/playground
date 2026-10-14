import type { Session } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { createRecoveryState } from "../../src/auth/recoveryState";

it("retains recovery for the validated user through initial/refresh events and clears on update or logout", () => {
  const state = createRecoveryState();
  const session = { user: { id: "synthetic-user" } } as Session;
  expect(state.isRecoverySession(session)).toBe(false);
  state.observe("PASSWORD_RECOVERY", session);
  state.observe("INITIAL_SESSION", session);
  state.observe("TOKEN_REFRESHED", session);
  expect(state.isRecoverySession(session)).toBe(true);
  expect(state.isRecoverySession({ user: { id: "other-synthetic-user" } } as Session)).toBe(false);
  expect(state.isRecoverySession(null)).toBe(false);
  state.clear();
  expect(state.isRecoverySession(session)).toBe(false);
  state.observe("PASSWORD_RECOVERY", session);
  state.observe("SIGNED_OUT", null);
  expect(state.isRecoverySession(session)).toBe(false);
  state.observe("PASSWORD_RECOVERY", null);
  expect(state.isRecoverySession(session)).toBe(false);
});
