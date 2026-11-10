import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: [
      { find: /^@\/config\/(.*)$/, replacement: fileURLToPath(new URL("./config/$1", import.meta.url)) },
      { find: /^@\/(.*)$/, replacement: fileURLToPath(new URL("./src/$1", import.meta.url)) },
      { find: "server-only", replacement: fileURLToPath(new URL("./tests/helpers/server-only.ts", import.meta.url)) },
    ],
  },
});
