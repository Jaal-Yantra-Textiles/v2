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

test.describe("Inventory-order change: partner proposes and the payment locks @partnerui", () => {
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

  test("proposes a DECIMAL quantity + tax through the grid, then the PAYMENT locks", async ({
    page,
  }) => {
    await openOrder(page)

    // Open the `…` menu and choose the proposal action.
    await page.getByRole("button", { name: "Open actions menu" }).first().click()
    await page.getByRole("menuitem", { name: "Edit lines & tax" }).click()

    /**
     * The edit screen is a DataGrid in a focus modal, not the old drawer, so
     * the quantity is a grid cell rather than a labelled field. The cell writes
     * to the form ON BLUR — filling without blurring leaves the form holding
     * the seeded value, and the proposal would go out unchanged while the
     * screen showed the new number.
     */
    const quantity = page.getByTestId("inv-change-quantity").first()
    await expect(quantity).toBeVisible({ timeout: 10_000 })

    /**
     * 6.5, not 6. These lines are metres of cloth on a Postgres `real`, and the
     * validators used to floor the quantity at 1 whole unit on both ends. A
     * whole number here would pass against the old rule too and prove nothing.
     */
    await quantity.fill("6.5")
    await quantity.blur()

    const taxPercent = page.getByTestId("inv-change-tax-percent")
    await taxPercent.fill("5")
    await taxPercent.blur()

    await page.getByTestId("inv-change-submit").click()

    // The striped banner renders, announcing the pending proposal + the lock.
    await expect(
      page.getByRole("heading", { name: "Your changes are pending" })
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByText(
        "Payment is paused until your changes are approved or rejected.",
        { exact: false }
      ).first()
    ).toBeVisible()

    /**
     * What a pending proposal locks: the MONEY, and only the money.
     *
     * 🔴 This used to assert `start` was hidden, which encoded a lock on the
     * whole lifecycle. That contradicted the API underneath:
     * `approve-inventory-order-change.ts` states approval is "deliberately
     * post-ship" and guards against a proposal contradicting goods already
     * ARRIVED — a guard that only has meaning while a proposal is open AND
     * goods ship. Locking the work made that state unreachable.
     *
     * The chain is why it mattered: ready-for-delivery is gated on
     * `Partial`, which needs completion recorded, so locking `complete`
     * locked the shipment too.
     */
    await page.getByRole("button", { name: "Open actions menu" }).first().click()

    // The proposal stays revisable.
    await expect(
      page.getByRole("menuitem", { name: "Edit lines & tax" })
    ).toBeVisible()

    // Work keeps moving — the partner can still start.
    await expect(
      page.getByRole("menuitem", { name: /start/i })
    ).toHaveCount(1)

    // The payment claim is the one thing that waits for the decision.
    await expect(
      page.getByRole("menuitem", { name: /submit payment/i })
    ).toHaveCount(0)
  })
})