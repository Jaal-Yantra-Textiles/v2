import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

/**
 * Quotes has to be REACHABLE from the partner sidebar (#1389 S3).
 *
 * 🔑 Why this file exists: the quote list has shipped twice. First the route,
 * which nothing in the nav pointed at — a partner could only reach their own
 * quotes by typing the URL. Then a nav entry, which was added to two of the
 * THREE persona branches in `main-layout.tsx` and missed on the third. The one
 * it was missed on is the default branch, i.e. the sidebar most partners
 * actually get. So the feature was "shipped" and still invisible to the people
 * it was built for, twice, and nothing failed either time.
 *
 * A route that renders is not a feature. This asserts the path a partner takes
 * to it, which is the only part that was ever broken.
 *
 * @partnerui — needs the partner-UI dev server, which the e2e config does not
 * boot; skipped on CI, run locally.
 *
 * ⚠️ **Check WHICH checkout is serving that port.** On this machine :5173 was
 * being served by vite from a *different clone of this repo*, so every
 * partner-UI spec was quietly asserting against another working tree — routes
 * that exist here 404'd there, and the fix under test was nowhere in the
 * bundle. `ps -o command= -p $(lsof -ti:5173)` settles it in one line. Point
 * this spec at the right server with `PARTNER_UI_URL=http://localhost:5174`
 * rather than assuming the default port is yours.
 */

type Seed = {
  gatePartnerEmail: string
  gatePartnerPassword: string
}

const seed: Seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))

test.describe("Partner quotes navigation @partnerui", () => {
  test.beforeEach(async ({ page }) => {
    // `networkidle` matters: the submit handler is attached on hydration, and a
    // click that lands before it is silently swallowed.
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.gatePartnerEmail)
    await page.locator('input[name="password"]').fill(seed.gatePartnerPassword)
    await page.locator('button[type="submit"]').click()

    // Wait on the PERSISTED TOKEN, not the URL — a `/\/(?!login)/` match
    // resolves instantly against the "//" in "http://" and races past login.
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )
  })

  test("🔑 Orders lists Quotes beside the other order kinds", async ({
    page,
  }) => {
    // ⚠️ Entered at `/orders/all`, not at `/`. The partner root renders the
    // app's own 404 for a seeded partner that has not been through onboarding,
    // and a spec that starts there fails for a reason that has nothing to do
    // with the nav. Every other partner-UI spec enters on a concrete route for
    // the same reason.
    await page.goto(`${PARTNER_UI}/orders/all`)

    // The group has to be opened before its children exist in the DOM.
    await page.getByRole("link", { name: /^orders$/i }).first().click()

    // Its siblings prove we are looking at the right group and that the item
    // sits WITH the other order kinds rather than somewhere else — a quote
    // becomes an order, so that is where a partner looks for it.
    for (const label of ["All", "Design", "Inventory", "Quotes"]) {
      await expect(
        page.getByRole("link", { name: new RegExp(`^${label}$`, "i") }).first()
      ).toBeVisible({ timeout: 15_000 })
    }
  })

  test("the Quotes entry actually reaches the quote list", async ({ page }) => {
    await page.goto(`${PARTNER_UI}/orders/all`)
    await page.getByRole("link", { name: /^orders$/i }).first().click()
    await page.getByRole("link", { name: /^quotes$/i }).first().click()

    // A nav item that 404s is the same failure wearing a different hat.
    await expect(page).toHaveURL(/\/orders\/quotes$/)
    await expect(page.getByText(/quote/i).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
