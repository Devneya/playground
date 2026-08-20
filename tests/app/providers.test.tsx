import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { Session, User } from "@supabase/supabase-js";
import type * as AccountApi from "../../src/api/account";
import { AuthProvider } from "../../src/auth/AuthProvider";
import { AuthContext, useAuth, type AuthActions } from "../../src/auth/useAuth";
import { WorkspaceProvider } from "../../src/features/workspace/WorkspaceContext";
import { useWorkspace } from "../../src/features/workspace/useWorkspace";
import { InMemoryWorkspaceRepository } from "../../src/persistence/InMemoryWorkspaceRepository";
import type { PlaygroundNode } from "../../src/domain/types";
import { createStarterWorkspace } from "../../src/domain/workspaceFactory";

const authMocks = vi.hoisted(() => {
  let authListener: ((event: string, session: Session | null) => void) | undefined;
  const session = { access_token: "jwt-test", user: { id: "user-a", email: "user-a@example.test" } } as Session;
  const supabaseAuth = {
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    onAuthStateChange: vi.fn((listener: (event: string, session: Session | null) => void) => {
      authListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithPassword: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
    signInWithOAuth: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  return { authListener: () => authListener, session, supabaseAuth, clearAuthStorage: vi.fn() };
});

vi.mock("../../src/auth/gotrueClient", () => ({ supabase: { auth: authMocks.supabaseAuth }, clearAuthStorage: authMocks.clearAuthStorage }));
vi.mock("../../src/api/account", async (importOriginal) => { const actual = await importOriginal() as typeof AccountApi; return { ...actual, revokeSession: vi.fn(async () => {}) }; });

const apiServer = setupServer(
  http.get("https://api.devneya.com/llm/v1/models", () => HttpResponse.json({ object: "list", data: [{ id: "model-a", object: "model", created: 1, owned_by: "devneya" }] })),
  http.get("https://api.devneya.com/account/key", () => HttpResponse.json({ key: "sk-bf-provider-test" })),
  http.post("https://api.devneya.com/llm/v1/chat/completions", () => HttpResponse.json({ choices: [{ message: { content: "component result" } }] })),
);

const makeUser = (id = "user-a"): User => ({ id, email: `${id}@example.test` } as User);
const makeSession = (id = "user-a"): Session => ({ access_token: `jwt-${id}`, user: makeUser(id) } as Session);

const AuthProbe = () => {
  const auth = useAuth();
  return <>
    <output data-testid="auth-state">{auth.initializing ? "initializing" : auth.user ? "signed-in" : "signed-out"}</output>
    <button type="button" onClick={() => void auth.login("person@example.test", "password123")}>login</button>
    <button type="button" onClick={() => void auth.signup("person@example.test", "password123")}>signup</button>
    <button type="button" onClick={() => void auth.sendRecovery("person@example.test")}>recovery</button>
    <button type="button" onClick={() => void auth.updatePassword("password123")}>update</button>
    <button type="button" onClick={() => void auth.signInWithOAuth("google")}>oauth</button>
    <button type="button" onClick={() => void auth.signOut()}>logout</button>
  </>;
};

const AuthErrorProbe = () => {
  const auth = useAuth();
  const [errors, setErrors] = useState<string[]>([]);
  const invoke = (label: string, action: () => Promise<void>) => {
    void action().catch((error: unknown) => setErrors((previous) => [...previous, `${label}:${error instanceof Error ? error.message : "unknown"}`]));
  };
  return <>
    <output data-testid="auth-errors">{errors.join("|")}</output>
    <button type="button" onClick={() => invoke("login", () => auth.login("person@example.test", "password123"))}>login-error</button>
    <button type="button" onClick={() => invoke("signup", () => auth.signup("person@example.test", "password123"))}>signup-error</button>
    <button type="button" onClick={() => invoke("recovery", () => auth.sendRecovery("person@example.test"))}>recovery-error</button>
    <button type="button" onClick={() => invoke("update", () => auth.updatePassword("password123"))}>update-error</button>
    <button type="button" onClick={() => invoke("oauth", () => auth.signInWithOAuth("google"))}>oauth-error</button>
    <button type="button" onClick={() => void auth.signOut()}>logout-no-session</button>
  </>;
};

const staticAuthActions: AuthActions = {
  login: vi.fn(async () => {}),
  signup: vi.fn(async () => {}),
  sendRecovery: vi.fn(async () => {}),
  updatePassword: vi.fn(async () => {}),
  signInWithOAuth: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
};

const WorkspaceProbe = () => {
  const workspace = useWorkspace();
  const flow = workspace.activeFlow;
  const text = flow.nodes.find((node) => node.data.kind === "text");
  const generation = flow.nodes.find((node) => node.data.kind === "generation");
  const addNode: PlaygroundNode = {
    id: "component-text",
    position: { x: 900, y: 120 },
    data: { kind: "text", origin: "manual", title: "Component text", text: "" },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  const invoke = (action: () => unknown) => {
    try {
      const result = action();
      if (result instanceof Promise) void result.catch((error: unknown) => setActionError(error instanceof Error ? error.message : "unknown"));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "unknown");
    }
  };
  const [actionError, setActionError] = useState("");
  return <>
    <output data-testid="workspace-status">{workspace.loading ? "loading" : "ready"}</output>
    <output data-testid="models-status">{workspace.modelsStatus}</output>
    <output data-testid="key-status">{workspace.keyStatus}</output>
    <output data-testid="save-status">{workspace.saving ? "saving" : workspace.lastSavedAt ? "saved" : "unsaved"}</output>
    <output data-testid="flow-count">{workspace.workspace.flows.length}</output>
    <output data-testid="batch-count">{flow.batches.length}</output>
    <output data-testid="text-value">{text?.data.kind === "text" ? text.data.text : "missing"}</output>
    <output data-testid="error">{workspace.error || workspace.modelsError || workspace.keyError || ""}</output>
    <button type="button" onClick={() => text && workspace.dispatch({ type: "node/edit-text", flowId: flow.id, nodeId: text.id, text: "component text" })}>edit</button>
    <button type="button" onClick={() => generation && workspace.dispatch({ type: "node/set-models", flowId: flow.id, nodeId: generation.id, modelIds: ["model-a"] })}>select</button>
    <button type="button" onClick={() => generation && void workspace.runGeneration(generation.id).completed}>run</button>
    <button type="button" onClick={() => workspace.addNode(addNode)}>add</button>
    <button type="button" onClick={workspace.undo}>undo</button>
    <button type="button" onClick={workspace.redo}>redo</button>
    <button type="button" onClick={workspace.createFlow}>create-flow</button>
    <button type="button" onClick={() => workspace.duplicateFlow(flow.id)}>duplicate-flow</button>
    <button type="button" onClick={() => workspace.renameFlow(flow.id, "Renamed flow")}>rename-flow</button>
    <button type="button" onClick={() => void workspace.clearLocalWorkspace()}>clear</button>
    <button type="button" onClick={() => workspace.reloadModels()}>reload-models</button>
    <button type="button" onClick={() => workspace.reloadKey()}>reload-key</button>
    <button type="button" onClick={() => workspace.duplicateFlow("missing-flow")}>duplicate-missing</button>
    <button type="button" onClick={() => workspace.activateFlow("missing-flow")}>activate-missing</button>
    <button type="button" onClick={() => workspace.deleteFlow("missing-flow")}>delete-missing</button>
    <button type="button" onClick={() => invoke(() => workspace.runGeneration("missing-generation"))}>run-invalid</button>
    <button type="button" onClick={() => workspace.cancelRun("missing-run")}>cancel-missing</button>
    <button type="button" onClick={() => invoke(() => workspace.exportWorkspace())}>export</button>
    <button type="button" onClick={() => invoke(() => workspace.importWorkspace(new File(["not-json"], "bad.json", { type: "application/json" })))}>import-invalid</button>
    <button type="button" onClick={() => invoke(() => workspace.importWorkspace(new File(["x".repeat(10 * 1024 * 1024 + 1)], "large.json")))}>import-large</button>
    <output data-testid="action-error">{actionError}</output>
  </>;
};

const signedInValue = (session: Session) => ({ session, user: session.user, initializing: false, recovery: false, ...staticAuthActions });

beforeAll(() => apiServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => { apiServer.resetHandlers(); vi.clearAllMocks(); });
afterAll(() => apiServer.close());

describe("AuthProvider", () => {
  it("restores a session, forwards auth actions, enters recovery, and cleans up logout", async () => {
    authMocks.supabaseAuth.getSession.mockResolvedValueOnce({ data: { session: authMocks.session }, error: null } as never);
    const user = userEvent.setup();
    render(<AuthProvider><AuthProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("signed-in"));
    await user.click(screen.getByRole("button", { name: "login" }));
    await user.click(screen.getByRole("button", { name: "signup" }));
    await user.click(screen.getByRole("button", { name: "recovery" }));
    await user.click(screen.getByRole("button", { name: "oauth" }));
    expect(authMocks.supabaseAuth.signInWithPassword).toHaveBeenCalledWith({ email: "person@example.test", password: "password123" });
    expect(authMocks.supabaseAuth.signUp).toHaveBeenCalled();
    expect(authMocks.supabaseAuth.resetPasswordForEmail).toHaveBeenCalled();
    expect(authMocks.supabaseAuth.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: "google" }));
    authMocks.authListener()?.("SIGNED_OUT", null);
    authMocks.authListener()?.("SIGNED_IN", authMocks.session);
    authMocks.authListener()?.("PASSWORD_RECOVERY", authMocks.session);
    authMocks.authListener()?.("SIGNED_IN", authMocks.session);
    await user.click(screen.getByRole("button", { name: "update" }));
    await user.click(screen.getByRole("button", { name: "logout" }));
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("signed-out"));
    expect(authMocks.clearAuthStorage).toHaveBeenCalled();
    expect(authMocks.supabaseAuth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("clears state when initial session loading reports an error and unsubscribes", async () => {
    const unsubscribe = vi.fn();
    authMocks.supabaseAuth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error("offline") } as never);
    authMocks.supabaseAuth.onAuthStateChange.mockImplementationOnce(() => ({ data: { subscription: { unsubscribe } } }));
    const rendered = render(<AuthProvider><AuthProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("auth-state")).toHaveTextContent("signed-out"));
    rendered.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("ignores late session results and auth events after unmount", async () => {
    let resolveSession: (() => void) | undefined;
    authMocks.supabaseAuth.getSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSession = () => resolve({ data: { session: null }, error: null });
    }));
    const rendered = render(<AuthProvider><AuthProbe /></AuthProvider>);
    rendered.unmount();
    authMocks.authListener()?.("SIGNED_OUT", null);
    resolveSession?.();
    await Promise.resolve();
  });

  it("turns every GoTrue action error into a safe user-facing error", async () => {
    authMocks.supabaseAuth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null } as never);
    authMocks.supabaseAuth.signInWithPassword.mockResolvedValueOnce({ error: new Error("login failed") } as never);
    authMocks.supabaseAuth.signUp.mockResolvedValueOnce({ error: new Error("signup failed") } as never);
    authMocks.supabaseAuth.resetPasswordForEmail.mockResolvedValueOnce({ error: new Error("recovery failed") } as never);
    authMocks.supabaseAuth.updateUser.mockResolvedValueOnce({ error: new Error("update failed") } as never);
    authMocks.supabaseAuth.signInWithOAuth.mockResolvedValueOnce({ error: new Error("oauth failed") } as never);
    const user = userEvent.setup();
    render(<AuthProvider><AuthErrorProbe /></AuthProvider>);
    await user.click(screen.getByRole("button", { name: "login-error" }));
    await user.click(screen.getByRole("button", { name: "signup-error" }));
    await user.click(screen.getByRole("button", { name: "recovery-error" }));
    await user.click(screen.getByRole("button", { name: "update-error" }));
    await user.click(screen.getByRole("button", { name: "oauth-error" }));
    await user.click(screen.getByRole("button", { name: "logout-no-session" }));
    await waitFor(() => expect(screen.getByTestId("auth-errors")).toHaveTextContent("login:Unexpected network error."));
    expect(screen.getByTestId("auth-errors").textContent?.split("|")).toHaveLength(5);
  });
});

describe("WorkspaceProvider", () => {
  it("loads the catalog and key, edits and saves, runs, creates flows, and clears safely", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const user = userEvent.setup();
    render(<AuthContext.Provider value={signedInValue(makeSession())}><WorkspaceProvider repository={repository}><WorkspaceProbe /></WorkspaceProvider></AuthContext.Provider>);
    await waitFor(() => expect(screen.getByTestId("workspace-status")).toHaveTextContent("ready"));
    await waitFor(() => expect(screen.getByTestId("models-status")).toHaveTextContent("ready"));
    await waitFor(() => expect(screen.getByTestId("key-status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: "select" }));
    await waitFor(() => expect(screen.getByTestId("save-status")).toHaveTextContent("saved"));
    await waitFor(async () => {
      const saved = await repository.load("user-a");
      expect(saved?.flows[0]?.nodes.some((node) => node.data.kind === "text" && node.data.text === "component text")).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "run" }));
    await waitFor(() => expect(screen.getByTestId("batch-count")).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: "add" }));
    await user.click(screen.getByRole("button", { name: "create-flow" }));
    await waitFor(() => expect(screen.getByTestId("flow-count")).toHaveTextContent("2"));
    await user.click(screen.getByRole("button", { name: "duplicate-flow" }));
    await waitFor(() => expect(screen.getByTestId("flow-count")).toHaveTextContent("3"));
    await user.click(screen.getByRole("button", { name: "rename-flow" }));
    await user.click(screen.getByRole("button", { name: "clear" }));
    await waitFor(() => expect(screen.getByTestId("text-value")).toHaveTextContent(""));
    expect(await repository.load("user-a")).toBeNull();
  });

  it("surfaces catalog and account-key failures without claiming readiness", async () => {
    apiServer.use(
      http.get("https://api.devneya.com/llm/v1/models", () => HttpResponse.json({ error: "catalog down" }, { status: 503 })),
      http.get("https://api.devneya.com/account/key", () => HttpResponse.json({ error: "key down" }, { status: 403 })),
    );
    render(<AuthContext.Provider value={signedInValue(makeSession("user-b"))}><WorkspaceProvider repository={new InMemoryWorkspaceRepository()}><WorkspaceProbe /></WorkspaceProvider></AuthContext.Provider>);
    await waitFor(() => expect(screen.getByTestId("models-status")).toHaveTextContent("error"));
    await waitFor(() => expect(screen.getByTestId("key-status")).toHaveTextContent("error"));
    expect(screen.getByTestId("error")).toHaveTextContent(/catalog down|key down|Request failed/);
  });

  it("supports a signed-out provider without loading a user workspace", async () => {
    render(<AuthContext.Provider value={{ session: null, user: null, initializing: false, recovery: false, ...staticAuthActions }}><WorkspaceProvider repository={new InMemoryWorkspaceRepository()}><WorkspaceProbe /></WorkspaceProvider></AuthContext.Provider>);
    await waitFor(() => expect(screen.getByTestId("workspace-status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("key-status")).toHaveTextContent("idle");
  });


  it("covers signed-out command guards and workspace action no-ops", async () => {
    const user = userEvent.setup();
    render(<AuthContext.Provider value={{ session: null, user: null, initializing: false, recovery: false, ...staticAuthActions }}><WorkspaceProvider repository={new InMemoryWorkspaceRepository()}><WorkspaceProbe /></WorkspaceProvider></AuthContext.Provider>);
    await waitFor(() => expect(screen.getByTestId("workspace-status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "reload-key" }));
    await user.click(screen.getByRole("button", { name: "duplicate-missing" }));
    await user.click(screen.getByRole("button", { name: "activate-missing" }));
    await user.click(screen.getByRole("button", { name: "delete-missing" }));
    await user.click(screen.getByRole("button", { name: "run-invalid" }));
    await user.click(screen.getByRole("button", { name: "cancel-missing" }));
    await user.click(screen.getByRole("button", { name: "clear" }));
    await user.click(screen.getByRole("button", { name: "undo" }));
    await user.click(screen.getByRole("button", { name: "redo" }));
    expect(screen.getByTestId("key-status")).toHaveTextContent("idle");
    expect(screen.getByTestId("action-error")).toHaveTextContent(/account key is not ready/i);
  });

  it("covers reload, export, import errors, and guarded invalid runs", async () => {
    const createObjectUrl = vi.fn(() => "blob:test");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    const user = userEvent.setup();
    render(<AuthContext.Provider value={signedInValue(makeSession("user-controls"))}><WorkspaceProvider repository={new InMemoryWorkspaceRepository()}><WorkspaceProbe /></WorkspaceProvider></AuthContext.Provider>);
    await waitFor(() => expect(screen.getByTestId("workspace-status")).toHaveTextContent("ready"));
    await waitFor(() => expect(screen.getByTestId("models-status")).toHaveTextContent("ready"));
    await waitFor(() => expect(screen.getByTestId("key-status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "reload-models" }));
    await user.click(screen.getByRole("button", { name: "reload-key" }));
    await waitFor(() => expect(screen.getByTestId("models-status")).toHaveTextContent("ready"));
    await waitFor(() => expect(screen.getByTestId("key-status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "export" }));
    expect(createObjectUrl).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:test");
    await user.click(screen.getByRole("button", { name: "import-invalid" }));
    await waitFor(() => expect(screen.getByTestId("action-error")).toHaveTextContent(/invalid|workspace|unexpected token/i));
    await user.click(screen.getByRole("button", { name: "import-large" }));
    await waitFor(() => expect(screen.getByTestId("action-error")).toHaveTextContent(/too large/i));
    await user.click(screen.getByRole("button", { name: "run-invalid" }));
    await waitFor(() => expect(screen.getByTestId("action-error")).toHaveTextContent(/Generation node/i));
  });

  it("restores an existing workspace and reports a failed save", async () => {
    const repository = new InMemoryWorkspaceRepository();
    const saved = createStarterWorkspace(() => crypto.randomUUID());
    const firstText = saved.flows[0]?.nodes.find((node) => node.data.kind === "text");
    if (firstText?.data.kind === "text") firstText.data.text = "restored text";
    await repository.save("user-a", saved);
    render(<AuthContext.Provider value={signedInValue(makeSession())}><WorkspaceProvider repository={repository}><WorkspaceProbe /></WorkspaceProvider></AuthContext.Provider>);
    await waitFor(() => expect(screen.getByTestId("text-value")).toHaveTextContent("restored text"));

    const failingRepository = {
      load: vi.fn(async () => null),
      save: vi.fn(async () => { throw new Error("quota exceeded"); }),
      delete: vi.fn(async () => {}),
    };
    render(<AuthContext.Provider value={signedInValue(makeSession("user-b"))}><WorkspaceProvider repository={failingRepository}><WorkspaceProbe /></WorkspaceProvider></AuthContext.Provider>);
    await waitFor(() => expect(screen.getAllByTestId("workspace-status")[1]).toHaveTextContent("ready"));
    await userEvent.setup().click(screen.getAllByRole("button", { name: "edit" })[1]!);
    await waitFor(() => expect(screen.getAllByTestId("error")[1]).toHaveTextContent("quota exceeded"));
  });

  it("resets to a starter workspace when loading fails", async () => {
    const repository = {
      load: vi.fn(async () => { throw new Error("saved record unreadable"); }),
      save: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    render(<AuthContext.Provider value={signedInValue(makeSession("user-b"))}><WorkspaceProvider repository={repository}><WorkspaceProbe /></WorkspaceProvider></AuthContext.Provider>);
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("saved record unreadable"));
    expect(screen.getByTestId("workspace-status")).toHaveTextContent("ready");
  });
});
