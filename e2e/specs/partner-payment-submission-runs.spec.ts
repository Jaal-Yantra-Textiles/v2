import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #1571 (B half) — a partner billing for the RUNS they finished.
 *
 * The partner submission screen used to list DESIGNS. Two consequences, both
 * live on production until this change:
 *
 *  - it never sent `production_run_ids`, so EVERY partner-created payout was
 *    `run_provenance: "not_recorded"` and the double-pay guard (#1556/#1565)
 *    was structurally blind to it; and
 *  - a `cost_override` is a line TOTAL, so a partner who made nine garments
 *    typed one number — #1554's shape, on the partner side.
 *
 * ## Why this spec exists at all, and not just the API tests
 *
 * 🔴 The backend suite was green at 74/74 while the route this screen calls
 * `401`d on every single request: `authenticate("partner", …)` is registered
 * per-route in `middlewares.ts`, the new route had no entry, and nothing in the
 * suite called it. Three further defects — `design_ids` never sent, per-design
 * quantities overwritten instead of summed, and the design-status gate
 * rejecting the `Technical_Review` that run completion itself sets — were all
 * invisible to a passing backend suite for the same reason: no test drove the
 * screen that builds the request.
 *
 * These cases drive the real screen against the real API. Each one fails on the
 * pre-fix tree, and each fails for its OWN reason rather than all four dying at
 * the same 401.
 *
 * @partnerui — needs the partner-UI dev server on :5173, which the e2e config
 * does not boot, so this is excluded on CI via `grepInvert`. Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- partner-payment-submission-runs
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

type Seed = {
  payoutPartnerEmail: string
  payoutPartnerPassword: string
  payoutDesignName: string
  payableRunId: string
  unpricedRunId: string
  partnerBillableRunId: string
  partnerSumRunAId: string
  partnerSumRunBId: string
}

let seed: Seed

/** Digits only, so assertions don't depend on currency symbol or locale. */
const digits = (s: string | null) => (s || "").replace(/[^0-9]/g, "")

/**
 * The card for one run.
 *
 * 🔴 The first version filtered divs by `runId.slice(0, 12)`, which identifies
 * NOTHING: `prod_run_` is 9 characters and a ULID's leading digits are a
 * timestamp, so every run on the page rendered the same string. The locator
 * matched all of them and `.last()` then resolved to whichever inner `<div>`
 * happened to be last — the metadata row, not the card — so an assertion about
 * the quantity badge could never pass no matter what the screen showed.
 *
 * The card now carries `data-run-id` with the FULL id. Exact, and it does not
 * depend on how the id is formatted for humans.
 */
const runCard = (page: any, runId: string) =>
  page.locator(`[data-run-id="${runId}"]`)

test.describe("Partner payment submission from runs @partnerui (#1571)", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    // Fail loudly on a stale seed rather than passing against `undefined`,
    // which every `toContain` would happily do.
    if (!seed.payoutPartnerEmail || !seed.partnerBillableRunId) {
      throw new Error(
        "E2E seed missing the #1571 partner payout fixture — re-run the seed."
      )
    }
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.payoutPartnerEmail)
    await page
      .locator('input[name="password"]')
      .fill(seed.payoutPartnerPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )
    await page.goto(`${PARTNER_UI}/payment-submissions/create`, {
      waitUntil: "networkidle",
    })
  })

  /**
   * The 401 case. If `middlewares.ts` does not register the payable-runs route,
   * the list is empty and the screen shows its empty state — so this fails on
   * emptiness, which is exactly the symptom the missing middleware produces.
   */
  test("lists completed RUNS with their produced quantity and agreed rate", async ({
    page,
  }) => {
    const tab = page.getByRole("tab", { name: /production runs/i })
    await expect(tab).toBeVisible({ timeout: 30_000 })
    await tab.click()

    // The design sits in Technical_Review — where run completion leaves it.
    // A screen that filtered on Approved/Commerce_Ready would show nothing.
    await expect(page.getByText(seed.payoutDesignName).first()).toBeVisible({
      timeout: 30_000,
    })

    const card = runCard(page, seed.payableRunId)
    await expect(card).toBeVisible()
    // Produced 4 of an ordered 9 — the founder rule is pay for what was MADE.
    await expect(card).toContainText("4 made")
    // 4 x 1200. Pricing off the design (5000) would read 45000 here.
    await expect(card).toContainText(/4,?800/)
  })

  /**
   * A run with no agreed rate must be visible and unpayable, never silently
   * billed at zero.
   */
  test("shows a run with no agreed rate rather than hiding or zero-billing it", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: /production runs/i }).click()
    const card = runCard(page, seed.unpricedRunId)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toContainText("2 made")
  })

  /**
   * The end-to-end money assertion, and the one that catches BOTH the missing
   * `design_ids` (the request 400s) and the design-status gate (the design is
   * in Technical_Review, which the hand-submission gate rejects unless a
   * verified completed run stands in for it).
   *
   * ⚠️ Consumes `partnerBillableRunId` permanently — that is the double-pay
   * guard working. It is a dedicated run for exactly that reason; see the seed.
   */
  test("submits a payout that records the run and bills quantity x rate", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: /production runs/i }).click()
    const card = runCard(page, seed.partnerBillableRunId)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.getByRole("checkbox").click()

    // The header total is the screen's own arithmetic: 4 x 1200.
    await expect(page.getByText(/INR\s*4,?800/)).toBeVisible()

    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) =>
          r.url().includes("/partners/payment-submissions") &&
          r.request().method() === "POST"
      ),
      page.getByRole("button", { name: /submit for payment/i }).click(),
    ])

    // 🔴 A 400 here is the missing `design_ids` or the status gate. Assert the
    // status before the body so the failure names which.
    expect(response.status()).toBe(201)

    const body = await response.json()
    expect(Number(body.payment_submission.total_amount)).toBe(4800)

    // The request the SCREEN built — not one a test hand-wrote.
    const sent = JSON.parse(response.request().postData() || "{}")
    expect(sent.design_ids?.length).toBeGreaterThan(0)
    expect(Object.values(sent.production_run_ids || {}).flat()).toContain(
      seed.partnerBillableRunId
    )
  })

  /**
   * Two runs of ONE design collapse into a single payment line, so the line's
   * quantity must be their SUM.
   *
   * 🔴 The first implementation assigned `quantities[designId]` per run inside
   * the loop, so the last run overwrote every earlier one: picking runs of 3
   * and 5 pieces billed 5. Units a partner made, going missing between the
   * screen and the money — #1554's shape once more.
   */
  test("sums the quantity when two runs of one design are billed together", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: /production runs/i }).click()

    const a = runCard(page, seed.partnerSumRunAId)
    await expect(a).toBeVisible({ timeout: 30_000 })
    await a.getByRole("checkbox").click()
    await runCard(page, seed.partnerSumRunBId).getByRole("checkbox").click()

    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) =>
          r.url().includes("/partners/payment-submissions") &&
          r.request().method() === "POST"
      ),
      page.getByRole("button", { name: /submit for payment/i }).click(),
    ])

    expect(response.status()).toBe(201)

    const sent = JSON.parse(response.request().postData() || "{}")
    const designId = Object.keys(sent.production_run_ids || {})[0]
    // 3 + 5, not 5 and not 3.
    expect(sent.quantities[designId]).toBe(8)
    expect(Object.values(sent.production_run_ids).flat()).toHaveLength(2)

    const body = await response.json()
    // 8 x 1200 — one line, both runs.
    expect(Number(body.payment_submission.total_amount)).toBe(9600)
  })
})
