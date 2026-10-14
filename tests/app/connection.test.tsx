import { useState, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ConnectionProvider } from "../../src/features/connection/ConnectionProvider";
import { ConnectionSetup } from "../../src/features/connection/ConnectionSetup";
import { useConnectionSettings } from "../../src/features/connection/useConnectionSettings";
import { WorkspaceProvider } from "../../src/features/workspace/WorkspaceContext";
import { useWorkspace } from "../../src/features/workspace/useWorkspace";
import { readBrowserConnection, CONNECTION_STORAGE_KEY } from "../../src/api/browserConnection";
import { InMemoryWorkspaceRepository } from "../../src/persistence/InMemoryWorkspaceRepository";
import type { InferenceProvider } from "../../src/domain/types";

const server = setupServer();
const modelsUrl = "https://api.openai.com/v1/models";
const anthropicModelsUrl = "https://api.anthropic.com/v1/models";
const devneyaModelsUrl = "https://api.devneya.com/llm/v1/models";
const key = "sk-test-openai-key";

const WorkspaceProbe = () => {
  const workspace = useWorkspace();
  const prompt = workspace.activeFlow.nodes.find((node) => node.data.kind === "generation");
  const [runError, setRunError] = useState("");
  return <>
    <output data-testid="workspace-status">{workspace.loading ? "loading" : "ready"}</output>
    <output data-testid="prompt-text">{prompt?.data.kind === "generation" ? prompt.data.instruction : "missing"}</output>
    <button type="button" onClick={() => prompt && workspace.dispatch({ type: "node/edit-instruction", flowId: workspace.activeFlow.id, nodeId: prompt.id, instruction: "same browser workspace" })}>Edit workspace</button>
    <button type="button" onClick={() => {
      try { if (prompt) void workspace.runGeneration(prompt.id).completed; }
      catch (failure) { setRunError(failure instanceof Error ? failure.message : "Unable to start the run."); }
    }}>Run prompt</button>
    <output data-testid="run-error">{runError}</output>
  </>;
};

const ConnectedProbe = () => {
  const settings = useConnectionSettings();
  if (!settings.connection || settings.changing) return <ConnectionSetup />;
  return <>
    <output data-testid="provider">{settings.provider}</output>
    <output data-testid="models-status">{settings.modelsStatus}</output>
    <output data-testid="models">{settings.models.map((model) => model.id).join(",")}</output>
    <button type="button" onClick={settings.changeConnection}>Change connection</button>
    <button type="button" onClick={settings.disconnect}>Disconnect</button>
  </>;
};

const renderConnectionApp = (children: ReactNode, initialProvider?: InferenceProvider) => render(
  <ConnectionProvider {...(initialProvider ? { initialProvider } : {})}>
    <WorkspaceProvider repository={new InMemoryWorkspaceRepository()}>
      <ConnectedProbe />
      {children}
    </WorkspaceProvider>
  </ConnectionProvider>,
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); window.localStorage.clear(); });
afterAll(() => server.close());

describe("provider setup", () => {
  it("connects through the protected OpenAI catalog, updates the model list, and keeps the same canvas when changing provider", async () => {
    let completionCalls = 0;
    server.use(
      http.get(modelsUrl, ({ request }) => {
        expect(request.headers.get("authorization")).toBe(`Bearer ${key}`);
        return HttpResponse.json({ object: "list", data: [
          { id: "zeta-chat-model", object: "model", created: 2, owned_by: "organization" },
          { id: "alpha-chat-model", object: "model", created: 1, owned_by: "openai" },
        ] });
      }),
      http.get(devneyaModelsUrl, () => HttpResponse.json({ object: "list", data: [{ id: "devneya-model", object: "model", created: 1, owned_by: "devneya" }] })),
      http.post("https://api.openai.com/v1/chat/completions", () => { completionCalls += 1; return HttpResponse.json({ choices: [{ message: { content: "unexpected" } }] }); }),
    );
    const user = userEvent.setup();
    renderConnectionApp(<WorkspaceProbe />);

    expect(document.querySelectorAll(".connection-options button")).toHaveLength(2);
    const choices = document.querySelectorAll<HTMLButtonElement>(".connection-options button");
    expect(choices[0]).toHaveTextContent("Continue with Devneya");
    expect(choices[1]).toHaveTextContent("Use an API key");
    expect(screen.getByRole("button", { name: "Continue with Devneya" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Use an API key" }));
    await user.type(screen.getByLabelText("OpenAI API key"), key);
    await user.click(screen.getByRole("button", { name: "Connect to OpenAI" }));

    await waitFor(() => expect(screen.getByTestId("models-status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("provider")).toHaveTextContent("openai");
    expect(screen.getByTestId("models")).toHaveTextContent("alpha-chat-model,zeta-chat-model");
    expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
    expect(readBrowserConnection()).toEqual({ provider: "openai", apiKey: key });
    expect(screen.getByTestId("workspace-status")).toHaveTextContent("ready");
    await user.click(screen.getByRole("button", { name: "Run prompt" }));
    expect(screen.getByTestId("run-error")).toHaveTextContent(/choose a model from the current catalog/i);
    expect(completionCalls).toBe(0);

    await user.click(screen.getByRole("button", { name: "Edit workspace" }));
    await user.click(screen.getByRole("button", { name: "Change connection" }));
    await user.click(screen.getByRole("button", { name: "Continue with Devneya" }));
    await waitFor(() => expect(screen.getByTestId("provider")).toHaveTextContent("devneya"));
    expect(screen.getByTestId("prompt-text")).toHaveTextContent("same browser workspace");
    expect(readBrowserConnection()).toEqual({ provider: "devneya" });
    expect(completionCalls).toBe(0);
  });

  it("keeps the previous OpenAI connection after a failed replacement key and removes it on disconnect", async () => {
    window.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ provider: "openai", apiKey: "sk-existing-key" }));
    server.use(http.get(modelsUrl, ({ request }) => {
      const authorization = request.headers.get("authorization");
      if (authorization === "Bearer sk-existing-key") return HttpResponse.json({ object: "list", data: [{ id: "existing-model", object: "model", created: 1, owned_by: "openai" }] });
      return HttpResponse.json({ error: { message: "Invalid key sk-rejected-key", code: "invalid_api_key" } }, { status: 401 });
    }));
    const user = userEvent.setup();
    renderConnectionApp(<WorkspaceProbe />, "openai");
    await waitFor(() => expect(screen.getByTestId("models-status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Change connection" }));
    await user.click(screen.getByRole("button", { name: "Use an API key" }));
    await user.type(screen.getByLabelText("OpenAI API key"), "sk-rejected-key");
    await user.click(screen.getByRole("button", { name: "Connect to OpenAI" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("OpenAI rejected the API key."));
    expect((screen.getByLabelText("OpenAI API key") as HTMLInputElement).value).toBe("sk-rejected-key");
    expect(readBrowserConnection()).toEqual({ provider: "openai", apiKey: "sk-existing-key" });
    await user.click(screen.getByRole("button", { name: "Back to OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(readBrowserConnection()).toBeNull();
    expect(screen.getByRole("button", { name: "Use an API key" })).toBeVisible();
  });

  it("connects to a selected provider and restores its saved credential", async () => {
    server.use(http.get(anthropicModelsUrl, ({ request }) => {
      expect(request.headers.get("x-api-key")).toBe("anthropic-test-key");
      expect(request.headers.get("anthropic-version")).toBe("2023-06-01");
      return HttpResponse.json({ data: [{ id: "claude-test" }], has_more: false });
    }));
    const user = userEvent.setup();
    const app = renderConnectionApp(<WorkspaceProbe />);
    await user.click(screen.getByRole("button", { name: "Use an API key" }));
    const providerSelect = screen.getByRole("combobox", { name: "Provider" });
    expect(Array.from((providerSelect as HTMLSelectElement).options, option => option.value)).toEqual([
      "openai", "anthropic", "google", "openrouter", "groq", "mistral", "deepseek", "custom",
    ]);
    await user.selectOptions(providerSelect, "anthropic");
    expect(screen.getByLabelText("Anthropic API key")).toBeVisible();
    await user.type(screen.getByLabelText("Anthropic API key"), "anthropic-test-key");
    await user.click(screen.getByRole("button", { name: "Connect to Anthropic" }));
    await waitFor(() => expect(screen.getByTestId("models-status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("provider")).toHaveTextContent("anthropic");
    expect(screen.getByTestId("models")).toHaveTextContent("claude-test");
    expect(readBrowserConnection()).toEqual({ provider: "anthropic", apiKey: "anthropic-test-key" });

    app.unmount();
    renderConnectionApp(<WorkspaceProbe />, "anthropic");
    await waitFor(() => expect(screen.getByTestId("models-status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("provider")).toHaveTextContent("anthropic");
    expect(screen.getByTestId("models")).toHaveTextContent("claude-test");
  });

  it("clears the API key and error when the selected provider changes", async () => {
    server.use(http.get(modelsUrl, () => HttpResponse.json({ error: { message: "Invalid key", code: "invalid_api_key" } }, { status: 401 })));
    const user = userEvent.setup();
    renderConnectionApp(<WorkspaceProbe />);
    await user.click(screen.getByRole("button", { name: "Use an API key" }));
    await user.type(screen.getByLabelText("OpenAI API key"), "rejected-openai-key");
    await user.click(screen.getByRole("button", { name: "Connect to OpenAI" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("OpenAI rejected the API key."));
    await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "anthropic");
    expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
    expect(screen.getByLabelText("Anthropic API key")).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("aborts a gated catalog request and discards the API key when the provider selection changes", async () => {
    let releaseCatalog!: () => void;
    const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve; });
    let requestStarted = false;
    let requestSignal: AbortSignal | undefined;
    server.use(http.get(anthropicModelsUrl, async ({ request }) => {
      requestStarted = true;
      requestSignal = request.signal;
      await catalogGate;
      return HttpResponse.json({ data: [{ id: "late-model" }], has_more: false });
    }));
    const user = userEvent.setup();
    renderConnectionApp(<WorkspaceProbe />);
    await user.click(screen.getByRole("button", { name: "Use an API key" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "anthropic");
    await user.type(screen.getByLabelText("Anthropic API key"), "anthropic-stale-key");
    await user.click(screen.getByRole("button", { name: "Connect to Anthropic" }));
    await waitFor(() => expect(requestStarted).toBe(true));

    await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "groq");
    expect(requestSignal?.aborted).toBe(true);
    expect(screen.getByLabelText("Groq API key")).toHaveValue("");
    expect(readBrowserConnection()).toBeUndefined();
    releaseCatalog();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(readBrowserConnection()).toBeUndefined();
  });

  it("does not let a pending API key check overwrite Continue with Devneya", async () => {
    let releaseCatalog!: () => void;
    const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve; });
    let requestStarted = false;
    let requestSignal: AbortSignal | undefined;
    server.use(
      http.get(anthropicModelsUrl, async ({ request }) => {
        requestStarted = true;
        requestSignal = request.signal;
        await catalogGate;
        return HttpResponse.json({ data: [{ id: "late-model" }], has_more: false });
      }),
      http.get(devneyaModelsUrl, () => HttpResponse.json({ object: "list", data: [{ id: "devneya-model", object: "model", created: 1, owned_by: "devneya" }] })),
    );
    const user = userEvent.setup();
    renderConnectionApp(<WorkspaceProbe />);
    await user.click(screen.getByRole("button", { name: "Use an API key" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "anthropic");
    await user.type(screen.getByLabelText("Anthropic API key"), "anthropic-stale-key");
    await user.click(screen.getByRole("button", { name: "Connect to Anthropic" }));
    await waitFor(() => expect(requestStarted).toBe(true));

    await user.click(screen.getByRole("button", { name: "Continue with Devneya" }));
    expect(requestSignal?.aborted).toBe(true);
    expect(readBrowserConnection()).toEqual({ provider: "devneya" });
    releaseCatalog();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(screen.getByTestId("provider")).toHaveTextContent("devneya");
    expect(readBrowserConnection()).toEqual({ provider: "devneya" });
  });

  it("does not let a pending provider check replace the connection after Back", async () => {
    window.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ provider: "openai", apiKey: "sk-existing-key" }));
    server.use(
      http.get(modelsUrl, () => HttpResponse.json({ object: "list", data: [{ id: "existing-model", object: "model", created: 1, owned_by: "openai" }] })),
    );
    let releaseCatalog!: () => void;
    const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve; });
    let requestStarted = false;
    server.use(http.get(anthropicModelsUrl, async () => {
      requestStarted = true;
      await catalogGate;
      return HttpResponse.json({ data: [{ id: "late-model" }], has_more: false });
    }));

    const user = userEvent.setup();
    renderConnectionApp(<WorkspaceProbe />, "openai");
    await waitFor(() => expect(screen.getByTestId("models-status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Change connection" }));
    await user.click(screen.getByRole("button", { name: "Use an API key" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "anthropic");
    await user.type(screen.getByLabelText("Anthropic API key"), "anthropic-late-key");
    await user.click(screen.getByRole("button", { name: "Connect to Anthropic" }));
    await waitFor(() => expect(requestStarted).toBe(true));
    await user.click(screen.getByRole("button", { name: "Back to OpenAI" }));
    releaseCatalog();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(screen.getByTestId("provider")).toHaveTextContent("openai");
    expect(readBrowserConnection()).toEqual({ provider: "openai", apiKey: "sk-existing-key" });
  });

  it("keeps the previous saved connection when browser storage rejects the replacement", async () => {
    window.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ provider: "openai", apiKey: "sk-existing-key" }));
    server.use(http.get(modelsUrl, () => HttpResponse.json({ object: "list", data: [{ id: "existing-model", object: "model", created: 1, owned_by: "openai" }] })));
    const user = userEvent.setup();
    renderConnectionApp(<WorkspaceProbe />, "openai");
    await waitFor(() => expect(screen.getByTestId("models-status")).toHaveTextContent("ready"));
    await user.click(screen.getByRole("button", { name: "Change connection" }));
    await user.click(screen.getByRole("button", { name: "Use an API key" }));
    await user.type(screen.getByLabelText("OpenAI API key"), "sk-replacement-key");
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, storageKey: string, value: string) {
      if (storageKey === CONNECTION_STORAGE_KEY) throw new Error("Storage denied");
      return originalSetItem.call(this, storageKey, value);
    });
    await user.click(screen.getByRole("button", { name: "Connect to OpenAI" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to save the connection in this browser."));
    expect(readBrowserConnection()).toEqual({ provider: "openai", apiKey: "sk-existing-key" });
  });
});
