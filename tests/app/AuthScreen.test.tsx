import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const renderAuth = (overrides: Partial<AuthState> = {}) => render(<AuthContext.Provider value={{ ...state, ...overrides, ...actions }}><AuthScreen /></AuthContext.Provider>);

describe("AuthScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(actions.login).mockResolvedValue(undefined);
    vi.mocked(actions.signup).mockResolvedValue(undefined);
    vi.mocked(actions.sendRecovery).mockResolvedValue(undefined);
    vi.mocked(actions.updatePassword).mockResolvedValue(undefined);
    vi.mocked(actions.signInWithOAuth).mockResolvedValue(undefined);
  });
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
  it("confirms a successful signup and recovery request", async () => {
    const user = userEvent.setup();
    renderAuth();
    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(actions.signup).toHaveBeenCalledWith("new@example.com", "password123");
    expect(screen.getByRole("status")).toHaveTextContent(/check your email/i);

    await user.click(screen.getByRole("button", { name: /forgot password/i }));
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.click(screen.getByRole("button", { name: /send recovery link/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/recovery link/i);
  });

  it("supports password recovery mode and reports non-Error failures", async () => {
    const user = userEvent.setup();
    renderAuth({ recovery: true });
    expect(screen.getByRole("button", { name: /update password/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "newpassword123");
    await user.click(screen.getByRole("button", { name: /update password/i }));
    expect(actions.updatePassword).toHaveBeenCalledWith("newpassword123");
    expect(screen.getByRole("status")).toHaveTextContent(/updated/i);
    await user.click(screen.getByRole("button", { name: /forgot password/i }));
    expect(screen.getByRole("button", { name: /send recovery link/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /back to sign in/i }));

    vi.mocked(actions.login).mockRejectedValueOnce(new Error("typed failure"));
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("typed failure");

    vi.mocked(actions.login).mockRejectedValueOnce("not-an-error");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/unable to complete/i);
  });

  it("disables the form while an action is pending", async () => {
    let resolve: (() => void) | undefined;
    vi.mocked(actions.login).mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    const user = userEvent.setup();
    renderAuth();
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    const submit = screen.getByRole("button", { name: /sign in/i });
    await user.click(submit);
    expect(screen.getByRole("button", { name: /working/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeDisabled();
    resolve?.();
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled());
  });

});
