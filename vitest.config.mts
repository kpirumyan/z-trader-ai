import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "src/modules/*/tests/**/*.test.{ts,tsx}",
      "src/shared/**/tests/**/*.test.{ts,tsx}",
      "src/composition/**/tests/**/*.test.{ts,tsx}",
    ],
    exclude: ["tests/e2e/**", "**/node_modules/**"],
  },
});
