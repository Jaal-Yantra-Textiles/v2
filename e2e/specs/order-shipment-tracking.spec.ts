import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

// #1118 — the admin order-detail "Shipping & Tracking" widget surfaces the
// Shiprocket shipment: auto-selected courier + quoted rate (#1116) and the
// tracking timeline (#1117). Drives it headlessly against the seeded retail
// order so CI does the browser verification.
test.describe("Order shipment tracking widget (#1118)", () => {
  let seed: { email: string; password: string; shipmentOrderId: string }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.shipmentOrderId) {
      throw new Error("E2E seed missing shipmentOrderId — re-run the seed.")
    }
  })

  test("renders the Shipping & Tracking panel with courier, rate and timeline", async ({
    page,
  }) => {
    // Log in via the admin UI.
    await page.goto("/app/login")
    await page.waitForLoadState("networkidle")
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })

    // Open the seeded order's detail page.
    await page.goto(`/app/orders/${seed.shipmentOrderId}`)
    await page.waitForLoadState("networkidle")

    // The widget heading is present.
    await expect(
      page.getByText("Shipping & Tracking", { exact: true }).first()
    ).toBeVisible({ timeout: 15000 })

    // Auto-selected courier + the international badge.
    await expect(page.getByText("Xpressbees Surface").first()).toBeVisible()
    await expect(page.getByText("International", { exact: true }).first()).toBeVisible()

    // Quoted courier rate (#1116). Assert on the amount to stay locale-tolerant.
    await expect(page.getByText(/Rate:/).first()).toBeVisible()
    await expect(page.getByText(/845\.5/).first()).toBeVisible()

    // AWB is shown.
    await expect(page.getByText("E2EAWB1234567").first()).toBeVisible()

    // Tracking timeline (#1117): collapsed toggle shows the event count; expand it.
    const toggle = page.getByText(/Tracking history \(2\)/).first()
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.getByText(/Pickup Scheduled/).first()).toBeVisible()
    await expect(page.getByText(/In Transit/).first()).toBeVisible()
  })
})
