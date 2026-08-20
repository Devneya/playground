import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const validateProductionEnv = (mode: string): Plugin => ({
  name: "validate-production-env",
  configResolved(resolved) {
    const anonKey = resolved.env.VITE_GOTRUE_ANON_KEY;
    if ((mode === "production" || mode === "validation") && !anonKey) throw new Error("VITE_GOTRUE_ANON_KEY is required for a production build.");
    if (mode === "production" && (anonKey === "validation-public-anon-key" || anonKey === "mock-public-anon-key" || resolved.env.VITE_USE_MOCKS === "true")) throw new Error("A protected production build requires the real public GoTrue anonymous key with mocks disabled.");
  },
});

const excludeMockWorker = (mode: string): Plugin => ({
  name: "exclude-mock-worker",
  generateBundle(_options, bundle: Record<string, unknown>) {
    if (mode !== "mock") delete bundle["mockServiceWorker.js"];
  },
  closeBundle() {
    if (mode !== "mock") {
      const workerPath = resolve(process.cwd(), "dist/mockServiceWorker.js");
      if (existsSync(workerPath)) rmSync(workerPath);
    }
  },
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), validateProductionEnv(mode), excludeMockWorker(mode)],
  server: {
    port: 3001,
    open: false,
  },
}));
