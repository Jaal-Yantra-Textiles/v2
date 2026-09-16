import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    // ⚠️ `.tsx` is listed deliberately. The glob was `*.test.ts` only, which
    // silently skips any component test written as `.test.tsx` — a spec that
    // exists, is committed, and never runs. There are none today; this is here
    // so the first one that lands is not discovered by a customer.
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@lib": path.resolve(__dirname, "src/lib"),
      "@modules": path.resolve(__dirname, "src/modules"),
    },
  },
})
