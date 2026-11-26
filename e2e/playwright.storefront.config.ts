import { defineConfig, devices } from "@playwright/test"
import * as path from "path"

const BACKEND_DIR = path.resolve(__dirname, "../apps/backend")
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 9000)

/**
 * Storefront specs (`@storefront`).
 *
 * Separate from playwright.config.ts because that one boots only the admin.
 *
 * Two ways to run it:
 *
 *  - Against servers you already have (the default): a storefront on :8000
 *    and its backend, or a deployed site via the specs' URL env vars. No
 *    webServer is started.
 *
 *  - `E2E_LOCAL_STACK=1`: Playwright boots the whole stack itself, the backend
 *    (`medusa develop` on :9000) and then the storefront-starter submodule
 *    built and started on :8000 (e2e/helpers/start-storefront.sh). Run
 *    `pnpm e2e:seed:storefront` first: it creates the tenant the storefront is
 *    built for. This is what CI does since the live-site specs went red on
 *    Vercel's Bot Protection (2026-11-22).
 *
 * Playwright starts webServers in order, so the backend is up before the
 * storefront build begins; the build reads regions from it.
 */
const LOCAL_STACK = !!process.env.E2E_LOCAL_STACK

export default defineConfig({
  testDir: path.resolve(__dirname, "specs"),
  grep: /@storefront/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Its own folder: the admin run before it in CI writes `test-results/`, and
  // Playwright empties its outputDir at start, which would delete that run's
  // failure screenshots before they are uploaded.
  outputDir: path.resolve(__dirname, "../test-results-storefront"),
  webServer: LOCAL_STACK
    ? [
        {
          command: "pnpm exec medusa develop",
          port: BACKEND_PORT,
          cwd: BACKEND_DIR,
          reuseExistingServer: !process.env.CI,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 300_000,
        },
        {
          command: path.resolve(__dirname, "helpers/start-storefront.sh"),
          url: "http://localhost:8000/in",
          reuseExistingServer: !process.env.CI,
          stdout: "pipe",
          stderr: "pipe",
          // A cold Next 16 production build on a CI runner.
          timeout: 600_000,
        },
      ]
    : undefined,
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
})
