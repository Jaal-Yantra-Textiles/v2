import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #1556 — paying a partner for a production RUN, driven through the admin UI.
 *
 * The screen this covers used to list DESIGNS and had no quantity input
 * anywhere on it. A design is a recipe carrying a per-unit cost, so the
 * submission billed that per-unit figure exactly once: ₹850 for nine finished
 * garments (#1554). The API half was fixed first — it has accepted `quantities`
 * and `unit_amounts` since #1557 — but nothing in the UI could send them, so
 * every admin-created payout still went out at one piece.
 *
 * These cases assert the UI half: that the screen lists runs, shows what it is
 * billing and on what basis, bills the PRODUCED quantity rather than the
 * ordered one, and refuses to pay for the same finished run twice.
 *
 * ⚠️ The seed carries THREE runs on purpose. Creating a submission consumes a
 * run permanently — that is the guard working — so the case that bills one uses
 * a dedicated `billableRunId` rather than the run the read-only cases assert
 * against. Without that split, one pass would poison every re-run AND every CI
 * retry, and a retry failing for that reason looks exactly like a real defect.
 */
test.describe("Payment submission from production runs (#1556)", () => {
  let seed: {
    email: string
    password: string
    payoutPartnerName: string
    payoutDesignName: string
    payableRunId: string
    billableRunId: string
    unpricedRunId: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    // Fail loudly on a stale seed rather than passing against `undefined`,
    // which every `toContain` would happily do.
    if (!seed.payableRunId || !seed.billableRunId || !seed.payoutPartnerName) {
      throw new Error(
        "E2E seed missing the #1556 payable-run fixture — re-run the seed."
      )
    }
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    // `networkidle` never settles against `medusa develop` (the dev server
    // holds long-lived connections open), so wait on the form itself.
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  /** Open the create modal and pick the fixture partner. */
  const openCreateForPartner = async (page: any) => {
    await page.goto("/app/payment-submissions/create")
    await expect(
      page.getByRole("heading", { name: "New Payment Submission" })
    ).toBeVisible({ timeout: 30000 })

    await page.getByRole("combobox").first().click()
    await page.getByRole("option", { name: seed.payoutPartnerName }).click()

    // The runs list is fetched only once a partner is chosen.
    await expect(page.getByText("payable", { exact: false }).first()).toBeVisible(
      { timeout: 20000 }
    )
  }

  /**
   * ⚠️ Addressed by the FULL run id, not a truncated prefix. The seed's two
   * runs are created in the same millisecond, so their ULIDs share a 16-char
   * prefix and a `hasText` filter on it matches both rows — which is also why
   * the row now renders a longer id.
   */
  const runRow = (page: any, runId: string) =>
    page.locator(`[data-testid="payable-run-row"][data-run-id="${runId}"]`)

  test("lists runs with the produced quantity and prices them from the run", async ({
    page,
  }) => {
    await login(page)
    await openCreateForPartner(page)

    // The tab that opens is Production runs, not Designs.
    await expect(
      page.getByRole("tab", { name: /Production runs/i })
    ).toHaveAttribute("data-state", "active")

    const row = runRow(page, seed.payableRunId)
    await expect(row).toBeVisible({ timeout: 15000 })

    // 🔑 Both figures, stated. A screen that showed only one could not be
    // checked for which of the two it was actually billing.
    await expect(row).toContainText("Produced")
    await expect(row).toContainText("4")
    await expect(row).toContainText("of 9 ordered")

    // Priced from the RUN (1200/unit), not from the design's own
    // estimated_cost of 5000 — which would have read 5000 here and billed
    // 45,000 for work worth 4,800.
    await expect(
      row.getByTestId(`run-amount-${seed.payableRunId}`)
    ).toContainText("4 × 1,200 = 4,800")
  })

  test("shows an unpriced run as unpayable instead of billing zero for it", async ({
    page,
  }) => {
    await login(page)
    await openCreateForPartner(page)

    // A run with no agreed rate is not a zero-value payout — it is a run whose
    // price has not been settled. It has to be visible (an admin looking for it
    // needs to see WHY it can't be billed) and not selectable.
    const row = runRow(page, seed.unpricedRunId)
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row).toContainText("No agreed rate")
    await expect(row.getByRole("checkbox")).toBeDisabled()
  })

  test("bills the quantity an admin types, and creates the submission for it", async ({
    page,
  }) => {
    await login(page)
    await openCreateForPartner(page)

    // The sacrificial run — see the THREE-runs note at the top.
    const row = runRow(page, seed.billableRunId)
    await row.getByRole("checkbox").click()

    // The header total tracks the selection — 4 produced x 1200.
    //
    // Addressed by testid, not by text: the same amount can legitimately appear
    // in the row AND the header, and a bare `getByText` then resolves to two
    // elements. Widening it with `.first()` would hide which one was asserted.
    const total = page.getByTestId("submission-total")
    await expect(total).toHaveText("INR 4,800", { timeout: 10000 })

    // The live correction this mirrors: a partner reported more output after
    // the fact, so the payable quantity is retyped. Before #1556 there was no
    // box to type it into at all.
    const qty = row.getByRole("spinbutton", {
      name: `Quantity for ${seed.payoutDesignName}`,
    })
    await qty.fill("7")

    await expect(
      row.getByTestId(`run-amount-${seed.billableRunId}`)
    ).toContainText("7 × 1,200 = 8,400")
    await expect(total).toHaveText("INR 8,400")

    await page.getByRole("button", { name: "Create Submission" }).click()

    // Lands on the submission detail page for the row it just created.
    await page.waitForURL(/\/app\/payment-submissions\/[^/]+$/, {
      timeout: 20000,
    })
    await expect(page.getByText("8,400").first()).toBeVisible({
      timeout: 15000,
    })

    /**
     * 🔑 The design behind this fixture sits in `Technical_Review` — where run
     * completion leaves it, and NOT one of the statuses the hand-submission
     * gate accepts. A submission existing at all proves the screen waives that
     * gate for a run-sourced payout, rather than requiring someone to edit a
     * design's review status in order to release a payment.
     */
  })

  test("refuses to offer a run that has already been paid for", async ({
    page,
  }) => {
    await login(page)
    await openCreateForPartner(page)

    // Depends on the previous case having created the payout against it.
    const row = runRow(page, seed.billableRunId)
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row).toContainText("Already paid")
    await expect(row.getByRole("checkbox")).toBeDisabled()
  })
})
