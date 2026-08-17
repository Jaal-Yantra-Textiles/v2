import { defineConfig, devices } from "@playwright/test"
import * as path from "path"

/**
 * Storefront layout checks against a LIVE site.
 *
 * Separate from playwright.config.ts because that one boots `medusa develop`
 * on :9000 for the admin specs — pointless here, and a five-minute wait to
 * test a page that is already deployed. No webServer, no local dependencies.
 */
export default defineConfig({
  testDir: path.resolve(__dirname, "specs"),
  grep: /@storefront/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
})
