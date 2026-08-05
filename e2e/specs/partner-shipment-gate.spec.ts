import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #1195 — the partner-UI half of the "Mark as shipped" gate.
 *
 * Unlike admin (see `order-shipment-gate.spec.ts`, which can only repair the
 * DATA because its gate is inside the shipped `@medusajs/dashboard` bundle), the
 * partner UI is ours: the fix removes `requires_shipping` from the gate
 * entirely, leaving the pickup rule — the only restriction Medusa documents —
 * as the sole condition.
 *
 * So this spec asserts the OPPOSITE of the admin one on the SAME fixture: an
 * untouched `requires_shipping: false` fulfillment must still offer the action.
 * It also walks the route the button navigates to, which was independently
 * broken: the map had `shipment/:fulfillmentId` while the screen reads `f_id`
 * and the section navigates to `./<id>/create-shipment`, so it resolved from
 * neither direction.
 *
 * @partnerui — needs the partner-UI dev server on :5173, which the e2e config
 * does not boot (it serves admin on :9000 only), so this is excluded on CI via
 * `grepInvert`. Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- partner-shipment-gate
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

type Seed = {
  gateOrderId: string
  gateFulfillmentId: string
  gatePartnerEmail: string
  gatePartnerPassword: string
}

const seed: Seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))

const MARK_AS_SHIPPED = /mark as shipped/i

test.describe("#1195 requires_shipping gate — partner UI @partnerui", () => {
  test.beforeEach(async ({ page }) => {
    // `networkidle` matters: the form's submit handler is attached on hydration,
    // and a click that lands before it is silently swallowed — the page just
    // sits on /login until the test times out.
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.gatePartnerEmail)
    await page.locator('input[name="password"]').fill(seed.gatePartnerPassword)
    await page.locator('button[type="submit"]').click()

    // Wait on the PERSISTED TOKEN, not the URL. A `/\/(?!login)/` URL match
    // resolves instantly against the "//" in "http://" and races past the
    // login, producing 401s that look like an auth bug.
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      // Under the 30s per-test budget, so a failed login reports as a login
      // failure rather than eating the whole test timeout in beforeEach.
      { timeout: 15_000 }
    )
  })

  test("offers the shipment action on a requires_shipping=false fulfillment", async ({
    page,
  }) => {
    await page.goto(`${PARTNER_UI}/orders/${seed.gateOrderId}`)

    // The fulfillment section renders (a partner with no linked store 400s the
    // whole route on `/partners/stores/undefined/locations/...` — the seed
    // links one for exactly this reason).
    await expect(page.getByText(/fulfillment/i).first()).toBeVisible({
      timeout: 30_000,
    })

    // Status is keyed off the fulfillment set type now, not the flag — it used
    // to read "Awaiting delivery" next to a shipment action.
    await expect(page.getByText(/awaiting shipping/i).first()).toBeVisible()

    // The fix itself: visible despite requires_shipping === false.
    const button = page.getByRole("button", { name: MARK_AS_SHIPPED })
    await expect(button.first()).toBeVisible()

    // ...and the route it navigates to resolves (`:f_id/create-shipment`).
    await button.first().click()
    await expect(page).toHaveURL(
      new RegExp(`${seed.gateFulfillmentId}/create-shipment`)
    )

    // The route now opens the two-step carrier → shipment modal rather than a
    // bare tracking form, so assert on the step tabs. Both must exist: a
    // regression that drops the carrier step would silently take the provider
    // picker away again.
    await expect(
      page.getByRole("tab", { name: /^carrier$/i })
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("tab", { name: /^shipment$/i })).toBeVisible()
  })
})
