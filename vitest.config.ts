import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/testSetup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      include: ["src/domain/**/*.ts", "src/api/**/*.ts", "src/persistence/**/*.ts", "src/auth/**/*.ts", "src/features/execution/**/*.ts", "src/features/workspace/**/*.tsx"],
      exclude: ["src/persistence/WorkspaceRepository.ts"],
    },
  },
});
