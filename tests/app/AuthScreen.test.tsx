import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthScreen } from "../../src/auth/AuthScreen";
import { AuthContext, type AuthActions, type AuthState } from "../../src/auth/useAuth";

const actions: AuthActions = {
  login: vi.fn(async () => {}),
  signup: vi.fn(async () => {}),
  sendRecovery: vi.fn(async () => {}),
  updatePassword: vi.fn(async () => {}),
  signInWithOAuth: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
};
const state: AuthState = { session: null, user: null, initializing: false, recovery: false };

const renderAuth = () => render(<AuthContext.Provider value={{ ...state, ...actions }}><AuthScreen /></AuthContext.Provider>);

describe("AuthScreen", () => {
  it("renders password login and supports account creation mode", async () => {
    const user = userEvent.setup();
    renderAuth();
    expect(screen.getByRole("heading", { name: /build and compare/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create an account/i }));
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("submits recovery without exposing a password field", async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole("button", { name: /forgot password/i }));
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.click(screen.getByRole("button", { name: /send recovery link/i }));
    expect(actions.sendRecovery).toHaveBeenCalledWith("person@example.com");
  });

  it("exposes both OAuth providers", async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole("button", { name: /continue with github/i }));
    expect(actions.signInWithOAuth).toHaveBeenCalledWith("github");
  });
});
