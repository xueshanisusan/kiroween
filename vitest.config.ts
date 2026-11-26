import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/helpers/no-network.ts"],
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
