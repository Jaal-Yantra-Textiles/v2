import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #1612 — the partner page shows BOTH money records in one list.
 *
 * 🔴 The defect was not a wrong number, it was a complete-looking half. Two
 * adjacent panels each read one record: `Payments` read `internal_payments`,
 * `Payouts` read the submissions, and since #1638 those stopped being two views
 * of the same money — approval writes no payment row, so every payout since is
 * invisible to the first while the historical rows are invisible to the second.
 * A reader seeing a full-looking panel concludes they have seen all of it.
 *
 * These cases assert the thing only a browser can: that ONE panel renders BOTH
 * kinds, that each says which record it came from, and that the totals line
 * separates what is owed from what has moved. The fixture partner deliberately
 * carries one of each, with different amounts, so a panel that renders one kind
 * twice reads visibly wrong rather than coincidentally right.
 */
test.describe("Partner ledger panel (#1612)", () => {
  let seed: {
    email: string
    password: string
    ledgerPartnerId: string
    ledgerPartnerName: string
    ledgerDesignName: string
    ledgerSubmissionId: string
    ledgerPayoutAmount: number
    ledgerPaymentAmount: number
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.ledgerPartnerId) {
      throw new Error("E2E seed missing ledgerPartnerId — re-run the seed.")
    }
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    // `networkidle` never settles against `medusa develop` (the dev server holds
    // long-lived connections open), so wait on the form itself.
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  /**
   * The panel, scoped by the id it stamps on itself. Anchoring on the heading
   * text instead would be fragile in both directions — the partner page carries
   * several `Container`s, and the heading sits beside a count badge that an
   * accessible-name match would swallow.
   */
  const ledgerPanel = (page: any) =>
    page.locator(`[data-partner-id="${seed.ledgerPartnerId}"]`)

  const openPartner = async (page: any) => {
    await login(page)
    await page.goto(`/app/partners/${seed.ledgerPartnerId}`)
    await expect(ledgerPanel(page)).toBeVisible({ timeout: 20000 })
  }

  test("renders the payout and the payment as entries of ONE list", async ({
    page,
  }) => {
    await openPartner(page)
    const panel = ledgerPanel(page)

    // The payout half — a submission with a line behind it. It exists only as a
    // submission: no `internal_payments` row was ever written for it, which is
    // every payout since #1638.
    await expect(
      panel.getByRole("link", { name: seed.ledgerSubmissionId })
    ).toBeVisible()
    // …and it names the work it bills, in the shared vocabulary rather than a
    // per-screen guess.
    await expect(panel.getByText("Design", { exact: true })).toBeVisible()

    // The payment half — money that moved, with no statement of what it was
    // for. The panel says so rather than leaving a blank that reads as
    // "nothing was billed".
    await expect(
      panel.getByText("recorded payment — no payout attached")
    ).toBeVisible()

    // Both, and only both: the count badge is the entry count, so a panel that
    // dropped one record or double-rendered the other disagrees here.
    await expect(panel.getByText("2", { exact: true }).first()).toBeVisible()
  })

  test("separates what is owed from what has moved, and does not merge the two records into one total", async ({
    page,
  }) => {
    await openPartner(page)
    const panel = ledgerPanel(page)

    /**
     * The fixture's payout is Approved, not Paid — approval is exactly the
     * state that writes no payment row, so it is outstanding. The payment is a
     * separate ₹1,200 that no payout points at.
     *
     * ⚠️ Asserted as three distinct figures, deliberately. A totals line that
     * summed the two records into one number would still render *a* total, and
     * only a fixture whose halves differ can tell the two apart.
     */
    const totals = panel.getByText(/paid ·/)
    await expect(totals).toBeVisible()
    await expect(totals).toContainText("4,500")
    await expect(totals).toContainText("outstanding")
    await expect(totals).toContainText("1,200")
    await expect(totals).toContainText("recorded separately")
  })

  test("links the payout to its submission page", async ({ page }) => {
    await openPartner(page)

    // A payout is a claim with lines behind it; the panel has to be a way IN to
    // them, not a dead end.
    await ledgerPanel(page)
      .getByRole("link", { name: seed.ledgerSubmissionId })
      .click()

    await page.waitForURL(
      new RegExp(`/app/payment-submissions/${seed.ledgerSubmissionId}`),
      { timeout: 15000 }
    )
  })
})
