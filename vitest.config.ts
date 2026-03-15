import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@lib": path.resolve(__dirname, "src/lib"),
      "@modules": path.resolve(__dirname, "src/modules"),
    },
  },
})
