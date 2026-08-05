import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * "Your payout" in the partner order summary.
 *
 * Two things come off an order total before a partner is paid: the platform
 * commission, and — when they generated the label on OUR carrier account
 * instead of shipping themselves — what that shipping actually cost. The second
 * one was recorded nowhere until now, so a partner could not tell why their
 * payout differed from the order total.
 *
 * This asserts the rendered arithmetic against the API that produced it, and
 * that the standalone commission card is gone (it now duplicates the summary).
 *
 * @partnerui — needs the partner-UI dev server on :5173, which the e2e config
 * does not boot, so this is excluded on CI via `grepInvert`. Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- partner-order-payout-summary
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

type Seed = {
  gateOrderId: string
  gatePartnerEmail: string
  gatePartnerPassword: string
  gateFee: {
    orderTotal: number
    commission: number
    shipping: number
    net: number
  }
}

const seed: Seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))

/** Digits only, so the assertions don't depend on currency symbol or locale. */
const digits = (s: string | null) => (s || "").replace(/[^0-9]/g, "")

test.describe("Partner order payout summary @partnerui", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.gatePartnerEmail)
    await page.locator('input[name="password"]').fill(seed.gatePartnerPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )
  })

  test("shows commission, platform shipping and the net payout", async ({
    page,
  }) => {
    await page.goto(`${PARTNER_UI}/orders/${seed.gateOrderId}`)

    const payout = page.getByText(/your payout/i).first()
    await expect(payout).toBeVisible({ timeout: 30_000 })

    // The three lines, in the order they're deducted.
    await expect(page.getByText(/platform commission/i).first()).toBeVisible()
    await expect(page.getByText(/platform shipping/i).first()).toBeVisible()

    const receive = page.getByText(/you will receive/i).first()
    await expect(receive).toBeVisible()

    // The rendered net must equal the seeded arithmetic:
    // 1500 − 45 commission − 120 shipping = 1335. Those numbers are chosen so
    // no pair of them coincidentally sums to another.
    const row = page.locator("div", { has: receive }).last()
    expect(digits(await row.innerText())).toContain(
      String(seed.gateFee.net)
    )
  })

  test("the rendered numbers match the partner-fee API", async ({ page }) => {
    // Guards against the UI quietly re-deriving the payout instead of showing
    // what the server computed — the two would drift the moment the fee shape
    // changes.
    const token = await page.evaluate(() =>
      localStorage.getItem("partner_ui_auth_token")
    )
    const res = await page.request.get(
      `http://localhost:9000/partners/orders/${seed.gateOrderId}/partner-fee`,
      { headers: { authorization: `Bearer ${token}` } }
    )
    expect(res.status()).toBe(200)
    const { display } = await res.json()

    expect(display.fee_amount).toBe(seed.gateFee.commission)
    expect(display.shipping).toMatchObject({
      amount: seed.gateFee.shipping,
      carrier: "shiprocket",
      is_foreign_currency: false,
    })
    expect(display.net_payout).toBe(seed.gateFee.net)
  })

  test("the standalone commission card is gone", async ({ page }) => {
    await page.goto(`${PARTNER_UI}/orders/${seed.gateOrderId}`)
    await expect(page.getByText(/your payout/i).first()).toBeVisible({
      timeout: 30_000,
    })

    // The old sidebar card was a heading; the payout block is a summary row.
    // Leaving both would show the same deduction twice on one page.
    await expect(
      page.getByRole("heading", { name: /platform commission/i })
    ).toHaveCount(0)
  })
})
