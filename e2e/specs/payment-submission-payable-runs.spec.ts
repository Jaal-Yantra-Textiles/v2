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

  /**
   * Open the create modal, pick the fixture partner, and advance to the grid.
   *
   * The screen is TWO steps now: choosing who is paid, then choosing what they
   * are paid for. Step 1 is a partner and a notes box; the runs are a
   * full-width spreadsheet on step 2, which is why they no longer share a page.
   */
  const openCreateForPartner = async (page: any) => {
    await page.goto("/app/payment-submissions/create")
    await expect(
      page.getByRole("heading", { name: "New Payment Submission" })
    ).toBeVisible({ timeout: 30000 })

    await page.getByRole("combobox").first().click()
    await page.getByRole("option", { name: seed.payoutPartnerName }).click()

    await page.getByRole("button", { name: "Continue" }).click()

    // The runs list is fetched only once a partner is chosen.
    await expect(
      page.getByText("billable of", { exact: false }).first()
    ).toBeVisible({ timeout: 20000 })
  }

  /**
   * One grid row.
   *
   * ⚠️ Addressed by the FULL run id, not a truncated prefix. The seed's two
   * runs are created in the same millisecond, so their ULIDs share a 16-char
   * prefix and a `hasText` filter on it matches both rows.
   *
   * 🔑 The id lives on the DESIGN cell — the grid renders its own rows and
   * offers no hook for a per-row attribute — so the row is reached by asking
   * which row contains that cell.
   */
  const runRow = (page: any, runId: string) =>
    page
      .locator('[role="row"]')
      .filter({
        has: page.locator(
          `[data-testid="payable-run-row"][data-run-id="${runId}"]`
        ),
      })

  /**
   * The editable boxes, addressed by POSITION within the row: Qty then Rate.
   *
   * A grid cell has no label of its own — the column header is the label, and
   * it is not associated with the input. Position is the contract a spreadsheet
   * actually offers, so it is stated here once rather than guessed at each use.
   */
  const qtyBox = (row: any) => row.getByRole("spinbutton").nth(0)
  const rateBox = (row: any) => row.getByRole("spinbutton").nth(1)

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
    // checked for which of the two it was actually billing — the Output column
    // carries produced-of-ordered, and Qty carries what is being billed.
    await expect(row).toContainText("4 of 9")
    await expect(qtyBox(row)).toHaveValue("4")

    // Priced from the RUN (1200/unit), not from the design's own
    // estimated_cost of 5000 — which would have read 5000 here and billed
    // 45,000 for work worth 4,800.
    await expect(rateBox(row)).toHaveValue("1200")
    await expect(
      row.getByTestId(`run-amount-${seed.payableRunId}`)
    ).toHaveText("4,800")
  })

  test("still lets an unpriced run be paid, by typing the rate", async ({
    page,
  }) => {
    await login(page)
    await openCreateForPartner(page)

    /**
     * 🔑 A missing rate is a gap in the RECORD, not a statement that the work
     * was free. On prod 15 of 27 completed runs carry no rate — the partner
     * finished the job and never entered a price. Blocking those would make
     * real completed work permanently unpayable through the only screen that
     * can pay it.
     *
     * So the row says a rate is needed, shows no amount until one is given,
     * and is still selectable.
     */
    const row = runRow(page, seed.unpricedRunId)
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row).toContainText("no rate")
    await expect(row.getByRole("checkbox")).toBeEnabled()

    // No amount asserted until someone supplies a rate — a "0" here would read
    // as an agreed price of zero.
    await expect(
      row.getByTestId(`run-amount-${seed.unpricedRunId}`)
    ).toHaveText("—")

    await row.getByRole("checkbox").click()
    // ⚠️ The grid commits a cell on BLUR, as a spreadsheet does. Without the
    // blur the box reads 400 and nothing downstream has heard about it, which
    // is a passing-looking test asserting an uncommitted edit.
    await rateBox(row).fill("400")
    await rateBox(row).blur()

    // 2 produced x 400 typed by hand.
    await expect(
      row.getByTestId(`run-amount-${seed.unpricedRunId}`)
    ).toHaveText("800")
    await expect(page.getByTestId("submission-total")).toHaveText("INR 800")
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
    await qtyBox(row).fill("7")
    await qtyBox(row).blur()

    await expect(
      row.getByTestId(`run-amount-${seed.billableRunId}`)
    ).toHaveText("8,400")
    await expect(total).toHaveText("INR 8,400")

    // 🔴 Assert the POST itself, not just where the browser ends up. This case
    // passed for months while the request came back 400: the create page IS
    // `/app/payment-submissions/create`, which the detail-page regex below
    // used to match (`create` is `[^/]+`), so `waitForURL` resolved without a
    // navigation — and the header total still read 8,400 on the page the test
    // had never left. It certified the screen's arithmetic and nothing else.
    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) =>
          r.url().includes("/admin/payment-submissions") &&
          r.request().method() === "POST"
      ),
      page.getByRole("button", { name: "Create Submission" }).click(),
    ])
    expect(response.status()).toBe(201)

    // The request the SCREEN built: the runs it is paying for must be named on
    // it, or the next submission cannot refuse to pay for them again.
    const sent = JSON.parse(response.request().postData() || "{}")
    expect(Object.values(sent.production_run_ids || {}).flat()).toContain(
      seed.billableRunId
    )

    // Lands on the submission detail page — never `/create`, which is what the
    // old pattern could not tell apart.
    await page.waitForURL(
      /\/app\/payment-submissions\/(?!create$)[^/]+$/,
      { timeout: 20000 }
    )
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

  /**
   * 🔴 This case used to assert that billing a run ONCE retired it — "refuses to
   * offer a run that has already been paid for", expecting the row to read
   * "paid" with a disabled checkbox.
   *
   * That was true, and it was the bug. The screen hid a run behind `!r.billed`
   * in three places, so a run billed for SOME of its quantity vanished and its
   * REMAINDER could never be claimed — #1596's own case was unreachable from
   * the screen payouts are made on. #1682 fixed it, and this assertion went red
   * the first time these specs actually ran.
   *
   * The previous case bills 7 of 9. So the run is PARTLY billed, and the right
   * assertion is the opposite of the old one: it is still offered, with 2 left.
   * Then billing those 2 is what retires it — which is the behaviour worth
   * covering, and the half the old spec could never reach.
   */
  test("offers a partly-billed run's REMAINDER, and retires it once that is billed", async ({
    page,
  }) => {
    await login(page)
    await openCreateForPartner(page)

    // Depends on the previous case having billed 7 of this run's 9.
    const row = runRow(page, seed.billableRunId)
    await expect(row).toBeVisible({ timeout: 15000 })

    // Still offered, and it says how much is left rather than hiding the run.
    await expect(row).toContainText("2 left")
    await expect(row.getByRole("checkbox")).toBeEnabled()

    await row.getByRole("checkbox").click()

    /**
     * The quantity box opens on the REMAINDER, not on the produced quantity —
     * offering 4 again on a run with 2 left is how a double-bill starts.
     */
    await expect(qtyBox(row)).toHaveValue("2", { timeout: 10000 })

    const total = page.getByTestId("submission-total")
    await expect(total).toHaveText("INR 2,400", { timeout: 10000 })

    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) =>
          r.url().includes("/admin/payment-submissions") &&
          r.request().method() === "POST"
      ),
      page.getByRole("button", { name: /Create Submission/i }).click(),
    ])
    expect(response.status()).toBeLessThan(400)

    await page.waitForURL(
      /\/app\/payment-submissions\/(?!create$)[^/]+$/,
      { timeout: 20000 }
    )

    /**
     * NOW it is wholly billed, and only now does the original assertion hold.
     * "paid" and "N left" are different badges on different statuses — `billed`
     * renders the first, `partly_billed` the second — so this asserts the state
     * positively rather than by the absence of the other.
     */
    await openCreateForPartner(page)
    const settled = runRow(page, seed.billableRunId)
    await expect(settled).toBeVisible({ timeout: 15000 })
    await expect(settled).toContainText("paid")
    await expect(settled.getByRole("checkbox")).toBeDisabled()
  })
})
