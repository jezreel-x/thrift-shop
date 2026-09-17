import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Honours the "@/*" alias from tsconfig.json so tests import the same way the app does.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Integration tests need a database and their own config; `npm run
    // test:integration` runs those.
    exclude: ["src/**/*.integration.test.ts"],
    globals: true,
  },
});
