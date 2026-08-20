import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element.");

const start = async () => {
  const appModule = import.meta.env.VITE_USE_MOCKS === "true"
    ? await import("./mocks/MockApp")
    : await import("./app/App");
  if (import.meta.env.VITE_USE_MOCKS === "true") {
    const { installMockControls, worker } = await import("./mocks/browser");
    await worker.start({ onUnhandledRequest: "error" });
    installMockControls();
  }
  const AppComponent = appModule.App;
  createRoot(root).render(<StrictMode><AppComponent /></StrictMode>);
};

void start();
