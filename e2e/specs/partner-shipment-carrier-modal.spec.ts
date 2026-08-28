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
  /**
   * 🔴 The CARRIER order, not the gate order.
   *
   * This spec used to point at `gateOrderId`, which it shared with
   * `order-shipment-gate.spec.ts` — a spec that marks that fulfillment
   * shipped. Once both suites ran on CI, the backend answered `400 Shipment
   * has already been created` here, three times over (once per Playwright
   * retry), and the modal correctly refused to move. It looks precisely like a
   * broken screen.
   *
   * Shipping is a once-only act, so a fulfillment cannot be shared by two
   * specs that both ship it — and no retry can ever pass on a fixture the
   * first attempt consumed. This fixture is its own.
   */
  carrierOrderId: string
  carrierFulfillmentId: string
  gatePartnerEmail: string
  gatePartnerPassword: string
}

const seed: Seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))

const ORDER_URL = `${PARTNER_UI}/orders/${seed.carrierOrderId}`
const SHIPMENT_URL = `${ORDER_URL}/${seed.carrierFulfillmentId}/create-shipment`

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
  /**
   * 🔑 UN-PARKED, on a fixture that can actually be shipped.
   *
   * These two cases had never passed, and two different things were wrong:
   *
   * 1. `POST /partners/orders/:id/shiprocket-attach-awb` called
   *    `provider.track({ awb })` against the LIVE Shiprocket API. The spec
   *    attaches a synthetic waybill that by construction exists on nobody's
   *    account, so the attach always threw and step 2 never activated. Fixed by
   *    giving the `SHIPROCKET_STUB=1` transport the `/courier/track/awb/:awb`
   *    handler it was missing — it had every other endpoint.
   *
   * 2. 🔴 The fixture could not be shipped. They used the #1195 gate order,
   *    whose own docblock says it "must stay broken for the specs to mean
   *    anything": its line item is title-only, so `requires_shipping` derives
   *    FALSE, and core treats a fulfillment needing no shipping as already
   *    shipped. `POST .../shipment` answered `400 Shipment has already been
   *    created` on the FIRST attempt. A spec asserting "completing step 2 marks
   *    the fulfillment shipped" was asking the one fixture in the repo built to
   *    refuse it — and cloning that seeder inherited the property exactly.
   *
   * `seedShippablePartnerOrder` is the answer to (2): a real variant, its
   * product linked to the SAME shipping profile the fulfillment's option
   * carries, and `requires_shipping: true` asserted on the fulfillment before
   * any spec runs. It is also separate from the gate order, so these no longer
   * collide with `order-shipment-gate.spec.ts`, which ships what it touches.
   *
   * ⚠️ If these go red again, read the SEED's assertions first. It fails loudly
   * with the cause; the specs fail 15 minutes later looking like a broken
   * screen.
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

    /**
     * Leave WITHOUT confirming the shipment.
     *
     * 🔑 A full navigation, not the Cancel button, and that is deliberate.
     *
     * The tracking number typed above makes the form dirty, so
     * `RouteFocusModal.Form` blocks the path change and raises an
     * unsaved-changes dialog. Answering it is a real partner-UI behaviour —
     * and it is also an animated Radix `AlertDialog` whose confirm button is
     * NOT STABLE: Playwright resolved the right element every time and still
     * could not click it ("element is not stable", then "element was detached
     * from the DOM"), burning the full 120s test timeout.
     *
     * That dialog deserves its own test. It is not what THIS case is about:
     * the assertion below is that attaching an AWB does not ship the
     * fulfillment, and how the partner happens to leave the modal is
     * incidental to it. Driving an unstable animation here buys no coverage
     * and costs the whole case.
     */
    await page.goto(ORDER_URL)
    await expect(page).toHaveURL(new RegExp(`orders/${seed.carrierOrderId}$`))

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
  /**
   * This is the case the shippable fixture exists for: before it, the shipment
   * POST was refused as already created before a retry ever happened.
   *
   * 🔴 Red on main for three consecutive runs, and the cause was NOT here.
   *
   * The CI log says the shipment POST returned **200** — the fulfillment really
   * was shipped. The failure was the assertion below finding no "Shipped",
   * because the page it landed on was the app's own *"404 - There is no page at
   * this address"*. Every order request had returned 200; what 404'd was
   * `GET /partners/stores`, which the order-detail page requests and the route
   * error boundary turns into a whole-page 404.
   *
   * `/partners/stores` throws NOT_FOUND when the store has no
   * `default_sales_channel_id` / `default_location_id` / `default_region_id`,
   * and `seedShipmentGatePartner` created its dedicated store with a name and
   * nothing else. A seed defect wearing the costume of a broken screen — the
   * same shape as the four stacked defects #1576 already worked through here.
   *
   * ⚠️ And it could never self-heal: attempt 1 ships the fulfillment, so both
   * Playwright retries then get `400 Shipment has already been created` and
   * fail at the URL assertion instead. A red retry here says nothing about the
   * cause; read attempt 1.
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

    await expect(page).toHaveURL(new RegExp(`orders/${seed.carrierOrderId}$`))
    await expect(page.getByText(/^shipped$/i).first()).toBeVisible({
      timeout: 30_000,
    })
  })
})
