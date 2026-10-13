import { useState, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

const server = setupServer();
const modelsUrl = "https://api.openai.com/v1/models";
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

const renderConnectionApp = (children: ReactNode, initialProvider?: "openai") => render(
  <ConnectionProvider {...(initialProvider ? { initialProvider } : {})}>
    <WorkspaceProvider repository={new InMemoryWorkspaceRepository()}>
      <ConnectedProbe />
      {children}
    </WorkspaceProvider>
  </ConnectionProvider>,
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); window.localStorage.clear(); });
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
    expect(screen.getByRole("button", { name: "Use OpenAI API key" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue with Devneya" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Use OpenAI API key" }));
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
    await user.click(screen.getByRole("button", { name: "Use OpenAI API key" }));
    await user.type(screen.getByLabelText("OpenAI API key"), "sk-rejected-key");
    await user.click(screen.getByRole("button", { name: "Connect to OpenAI" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("OpenAI rejected the API key."));
    expect((screen.getByLabelText("OpenAI API key") as HTMLInputElement).value).toBe("sk-rejected-key");
    expect(readBrowserConnection()).toEqual({ provider: "openai", apiKey: "sk-existing-key" });
    await user.click(screen.getByRole("button", { name: "Back to OpenAI" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(readBrowserConnection()).toBeNull();
    expect(screen.getByRole("button", { name: "Use OpenAI API key" })).toBeVisible();
  });
});
