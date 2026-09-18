import { test, expect, Page } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #1752 — the partner proposes inventory-order line edits + tax, and the order
 * locks until the admin resolves it.
 *
 * What this proves that the API test cannot: the "Edit lines & tax" drawer
 * STAGES a proposal through the partner UI, the striped banner renders on the
 * order detail, and the order's other actions are disabled while the proposal
 * is pending. The seeded partner order is editable (Pending) with no change, so
 * the spec drives the real proposal.
 *
 * @partnerui — needs the partner-UI dev server on :5173 and a seeded partner.
 * Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- inventory-order-change-propose
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

type Seed = {
  invChangePartnerUnifiedOrderId: string
  invChangePartnerEmail: string
  invChangePartnerPassword: string
  invChangePartnerLineLabel: string
}

let seed: Seed

test.describe("Inventory-order change: partner proposes and the order locks @partnerui", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.invChangePartnerUnifiedOrderId) {
      throw new Error(
        "E2E seed missing the #1752 partner inventory-order fixture — re-run the seed."
      )
    }
  })

  const login = async (page: Page) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.invChangePartnerEmail)
    await page.locator('input[name="password"]').fill(seed.invChangePartnerPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )
  }

  const openOrder = async (page: Page) => {
    await login(page)
    await page.goto(`${PARTNER_UI}/orders/${seed.invChangePartnerUnifiedOrderId}`, {
      waitUntil: "domcontentloaded",
    })
    // The header action menu is the `…` button; it carries the lifecycle actions.
    await page
      .getByRole("button", { name: "Open actions menu" })
      .first()
      .waitFor({ timeout: 30_000 })
  }

  test("proposes edits + tax through the drawer, then the order locks", async ({
    page,
  }) => {
    await openOrder(page)

    // Open the `…` menu and choose the proposal action.
    await page.getByRole("button", { name: "Open actions menu" }).first().click()
    await page.getByRole("menuitem", { name: "Edit lines & tax" }).click()

    // The drawer: change the quantity and add tax.
    await expect(page.getByTestId("inv-change-quantity")).toBeVisible({
      timeout: 10_000,
    })
    await page.getByTestId("inv-change-quantity").fill("6")
    await page.getByTestId("inv-change-tax-amount").fill("25")
    await page.getByRole("button", { name: "Propose changes" }).click()

    // The striped banner renders, announcing the pending proposal + the lock.
    await expect(
      page.getByRole("heading", { name: "Your changes are pending" })
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByText(
        "Actions are paused until your changes are approved or rejected.",
        { exact: false }
      ).first()
    ).toBeVisible()

    // The lifecycle actions are gone; the proposal remains revisable.
    await page.getByRole("button", { name: "Open actions menu" }).first().click()
    await expect(
      page.getByRole("menuitem", { name: "Edit lines & tax" })
    ).toBeVisible()
    await expect(page.getByRole("menuitem", { name: /start/i })).toHaveCount(0)
  })
})