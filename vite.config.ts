import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgrPlugin from "vite-plugin-svgr";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths(), svgrPlugin()],

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          mui: ["@mui/material", "@mui/icons-material"],
          xyflow: ["@xyflow/react"],
          openai: ["openai"],
          pdf: ["react-pdf"],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 3001,
    open: true, // this will open directly to your browser
  },
});
