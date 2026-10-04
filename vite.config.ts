import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { localCodexPlugin } from "./src/api/local-codex.mjs";

const validateProductionEnv = (mode: string): Plugin => ({
  name: "validate-production-env",
  configResolved(resolved) {
    const anonKey = resolved.env.VITE_GOTRUE_ANON_KEY;
    if ((mode === "production" || mode === "validation") && !anonKey) throw new Error("VITE_GOTRUE_ANON_KEY is required for a production build.");
    if ((mode === "production" || mode === "validation") && resolved.env.VITE_API_BASE_URL !== "https://api.devneya.com") throw new Error("Production and validation builds require VITE_API_BASE_URL=https://api.devneya.com.");
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
  plugins: [...(mode === "codex" ? [localCodexPlugin()] : []), react(), validateProductionEnv(mode), excludeMockWorker(mode)],
  define: mode === "codex" ? { "import.meta.env.VITE_LOCAL_CODEX": JSON.stringify("true") } : {},
  server: {
    host: "127.0.0.1",
    port: mode === "codex" ? 3002 : 3001,
    open: false,
    watch: { ignored: ["**/coverage/**", "**/test-results/**", "**/playwright-report/**", "**/release-evidence/**"] },
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@xyflow")) return "editor-vendor";
          if (id.includes("node_modules/@supabase")) return "auth-vendor";
          if (id.includes("node_modules/react")) return "react-vendor";
          return undefined;
        },
      },
    },
  },
}));
