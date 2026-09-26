import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "web/src/**/*.test.{ts,tsx}"],
    setupFiles: [],
    environment: "node",
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts", "web/src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "**/*.test.*", "web/src/main.tsx"],
      reporter: ["text-summary", "json"],
    },
  },
});
