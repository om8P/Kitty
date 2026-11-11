import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    // Database tests run on the Docker Postgres (docker compose up -d db).
    globalSetup: ["./tests/setup/database.ts"],
    testTimeout: 15_000,
  },
});
