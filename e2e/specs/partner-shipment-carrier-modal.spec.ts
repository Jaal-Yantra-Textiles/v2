import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * The two-step "Mark as shipped" modal in the partner UI.
 *
 * The carrier actions (provider select / Attach AWB / Generate Label) used to be
 * a loose button row on the fulfillment card. Folding them into step 1 of this
 * modal risks one specific regression, and that regression is what this spec
 * exists to catch: **labelling must not imply shipping.** Every fulfillment goes
 * out through the manual shipping side-channel, so attaching an AWB or minting a
 * label leaves `shipped_at` null until the partner confirms handover in step 2.
 *
 * @partnerui — needs the partner-UI dev server on :5173, which the e2e config
 * does not boot (admin on :9000 only), so this is excluded on CI via
 * `grepInvert`. It also needs the deterministic Shiprocket transport, or
 * "Generate label" hits the live API. Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   SHIPROCKET_STUB=1 pnpm --filter @jyt/backend e2e:test -- partner-shipment-carrier-modal
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

const ORDER_URL = `${PARTNER_UI}/orders/${seed.gateOrderId}`
const SHIPMENT_URL = `${ORDER_URL}/${seed.gateFulfillmentId}/create-shipment`

test.describe("Partner shipment carrier modal @partnerui", () => {
  test.beforeEach(async ({ page }) => {
    // `networkidle` matters: the login form's submit handler is attached on
    // hydration and a click landing before it is silently swallowed.
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

  /**
   * ⚠️ Parked in #1576. Failed on the FIRST-EVER CI run of the @partnerui
   * specs — this file was written against a partner UI that had never actually
   * executed here, so the case has to be opened in a browser before anyone can
   * say whether the selector is stale or the screen is broken. `fixme` rather
   * than a silent skip: the report names it every run.
   *
   * 🔴 #1576 — un-parked. The original diagnosis ("tab stays inactive,
   * selector may be stale") was wrong on both counts. The real cause:
   *
   * `POST /partners/orders/:id/shiprocket-attach-awb` calls
   * `provider.track({ awb })` against the LIVE Shiprocket API, and throws twice
   * over — once if the lookup fails, again if Shiprocket returns no shipment
   * for the waybill. This spec attaches `E2E${Date.now()}`, a synthetic AWB
   * that by construction exists on nobody's Shiprocket account. So the attach
   * always throws, `onCarrierResolved` is never called, and step 2 never
   * activates. The tab is found; it is simply never made active.
   *
   * ⚠️ The selector is FINE. `ProgressTabs.Trigger` renders a status icon that
   * carries no aria-label or <title>, so the accessible name really is
   * "Shipment" and `/^shipment$/i` matches — checked in @medusajs/ui, not
   * assumed. Do not "fix" this by loosening the regex.
   *
   * Fixed by giving the existing `SHIPROCKET_STUB=1` transport a
   * `/courier/track/awb/:awb` handler — it had every other endpoint but that
   * one, so it 404'd the lookup and the client threw exactly as the live API
   * would. The e2e job now sets it. The stub echoes back the AWB it was asked
   * about, so this really does test the round-trip.
   *
   * ⚠️ What this no longer covers: a waybill Shiprocket REJECTS. The stub
   * models success only, so "foreign AWB refused" has no test.
   */
  test("attaching an AWB in step 1 does not mark the fulfillment shipped", async ({
    page,
  }) => {
    await page.goto(SHIPMENT_URL)

    // Step 1 is the landing step while no waybill exists.
    const carrierTab = page.getByRole("tab", { name: /^carrier$/i })
    await expect(carrierTab).toBeVisible({ timeout: 30_000 })

    // The provider picker that used to live on the card.
    await expect(page.getByText(/^provider$/i).first()).toBeVisible()

    // Attach an AWB, then LEAVE without submitting step 2.
    const awb = `E2E${Date.now()}`
    await page.getByPlaceholder(/14112363690867/).fill(awb)
    await page.getByRole("button", { name: /^attach awb$/i }).click()

    // The attach succeeded and carried us to step 2 with the AWB prefilled —
    // the partner shouldn't have to retype a waybill we just stamped on.
    await expect(page.getByRole("tab", { name: /^shipment$/i })).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 30_000 }
    )
    await expect(page.getByLabel(/tracking number/i).first()).toHaveValue(awb)

    // Bail out of the modal WITHOUT confirming the shipment.
    await page.getByRole("button", { name: /^cancel$/i }).click()
    await expect(page).toHaveURL(new RegExp(`orders/${seed.gateOrderId}$`))

    // The whole point: still un-shipped. Assert on the status badge AND on the
    // action still being offered — a fulfillment that had been marked shipped
    // would lose the button (`showShippingButton` gates on `shipped_at`).
    await expect(page.getByText(/awaiting shipping/i).first()).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByRole("button", { name: /mark as shipped/i }).first()
    ).toBeVisible()
  })

  /**
   * ⚠️ Parked in #1576. Failed on the FIRST-EVER CI run of the @partnerui
   * specs — this file was written against a partner UI that had never actually
   * executed here, so the case has to be opened in a browser before anyone can
   * say whether the selector is stale or the screen is broken. `fixme` rather
   * than a silent skip: the report names it every run.
   *
   * 🔴 #1576 — un-parked. The original diagnosis ("tab stays inactive,
   * selector may be stale") was wrong on both counts. The real cause:
   *
   * `POST /partners/orders/:id/shiprocket-attach-awb` calls
   * `provider.track({ awb })` against the LIVE Shiprocket API, and throws twice
   * over — once if the lookup fails, again if Shiprocket returns no shipment
   * for the waybill. This spec attaches `E2E${Date.now()}`, a synthetic AWB
   * that by construction exists on nobody's Shiprocket account. So the attach
   * always throws, `onCarrierResolved` is never called, and step 2 never
   * activates. The tab is found; it is simply never made active.
   *
   * ⚠️ The selector is FINE. `ProgressTabs.Trigger` renders a status icon that
   * carries no aria-label or <title>, so the accessible name really is
   * "Shipment" and `/^shipment$/i` matches — checked in @medusajs/ui, not
   * assumed. Do not "fix" this by loosening the regex.
   *
   * Fixed by giving the existing `SHIPROCKET_STUB=1` transport a
   * `/courier/track/awb/:awb` handler — it had every other endpoint but that
   * one, so it 404'd the lookup and the client threw exactly as the live API
   * would. The e2e job now sets it. The stub echoes back the AWB it was asked
   * about, so this really does test the round-trip.
   *
   * ⚠️ What this no longer covers: a waybill Shiprocket REJECTS. The stub
   * models success only, so "foreign AWB refused" has no test.
   */
  test("completing step 2 marks the fulfillment shipped", async ({ page }) => {
    await page.goto(SHIPMENT_URL)

    // Skip the carrier step — a partner shipping on their own account never
    // touches our carrier, so Continue must always be available.
    const carrierTab = page.getByRole("tab", { name: /^carrier$/i })
    if (await carrierTab.getAttribute("data-state") === "active") {
      await page.getByRole("button", { name: /^continue$/i }).click()
    }

    await expect(page.getByRole("tab", { name: /^shipment$/i })).toHaveAttribute(
      "data-state",
      "active",
      { timeout: 30_000 }
    )

    // Ensure there's at least one tracking row to submit.
    const trackingInput = page.getByLabel(/tracking number/i).first()
    if (!(await trackingInput.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /add tracking number/i }).click()
    }
    await page.getByLabel(/tracking number/i).first().fill(`E2E-SHIP-${Date.now()}`)

    await page.getByRole("button", { name: /mark as shipped/i }).click()

    await expect(page).toHaveURL(new RegExp(`orders/${seed.gateOrderId}$`))
    await expect(page.getByText(/^shipped$/i).first()).toBeVisible({
      timeout: 30_000,
    })
  })
})
