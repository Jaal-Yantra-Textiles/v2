import { defineConfig, devices } from "@playwright/test"
import * as path from "path"

const BACKEND_DIR = path.resolve(__dirname, "../apps/backend")

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 9000)
const BACKEND_URL =
  process.env.E2E_BACKEND_URL || `http://localhost:${BACKEND_PORT}`

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
  // This config only boots the admin (`medusa develop` on :9000). Specs that
  // need the partner-ui (:5173) or a live LLM are tagged `@partnerui` and run
  // only locally — skip them on CI so a shared admin e2e stays deterministic.
  //
  // `@localstack` is the same idea for the other direction: a spec that needs a
  // storefront on :8000 AND a seeded product. Note this is NOT implied by
  // `@storefront` — the other storefront specs hit LIVE deployed sites and run
  // here quite happily, which is exactly why the new tag was needed rather than
  // widening the existing one.
  //
  // 🔑 `PARTNER_UI=1` opts @partnerui specs BACK IN — the e2e job now boots the
  // partner UI on :5173, so they can run on CI too. Without this the job went
  // green while collecting ZERO partner specs: 44 tests ran and the new
  // #1571 spec was not among them, so `e2e: pass` certified everything except
  // the thing the PR changed. A green check that never loaded your file is not
  // evidence about your file.
  //
  // ⚠️ `@llm` is excluded even when the partner UI IS up. It marks a spec that
  // talks to a live model — a requirement CI cannot meet at all, and one that
  // used to hide inside `@partnerui`. Opting the partner specs back in dragged
  // it along and it failed for a reason no partner-UI fix could address.
  grepInvert: process.env.CI
    ? process.env.PARTNER_UI
      ? /@localstack|@llm/
      : /@partnerui|@localstack|@llm/
    : undefined,

  /**
   * The backend the admin specs drive.
   *
   * 🔴 Overridable because `reuseExistingServer` cannot tell WHOSE server is on
   * :9000. A second checkout of this repo running its own `medusa develop`
   * satisfies the port check, and the whole suite then grades the current
   * branch against somebody else's build — which has already happened: a run
   * reported `Unrecognized fields: 'rate_breakdown'` against a stale tree while
   * the branch under test accepted it perfectly. Set `E2E_BACKEND_PORT` (and
   * `MEDUSA_BACKEND_URL` on the server, so the admin bundle calls itself) to
   * take a port nobody else holds.
   */
  webServer: {
    command: `pnpm exec medusa develop`,
    port: BACKEND_PORT,
    cwd: BACKEND_DIR,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 300_000,
  },

  use: {
    baseURL: BACKEND_URL,
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
