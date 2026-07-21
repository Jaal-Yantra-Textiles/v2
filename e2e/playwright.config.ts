import { defineConfig, devices } from "@playwright/test"
import * as path from "path"

const BACKEND_DIR = path.resolve(__dirname, "../apps/backend")

export default defineConfig({
  testDir: path.resolve(__dirname, "specs"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  // On CI the admin bundle is compiled lazily by `medusa develop` on the first
  // request to /app, so the first navigation can take far longer than a warm
  // local dev server. Give tests (and assertions) generous headroom there.
  timeout: process.env.CI ? 120_000 : 30_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },

  webServer: {
    command: `pnpm exec medusa develop`,
    port: 9000,
    cwd: BACKEND_DIR,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300_000,
  },

  use: {
    baseURL: "http://localhost:9000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-web-security",
      ],
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
