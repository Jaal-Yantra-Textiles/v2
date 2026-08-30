import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #1596 — per-piece prices, from the screen that has to produce them to the
 * screen that has to explain them.
 *
 * ## What was missing
 *
 * The `rate_breakdown` column, its validator, the fold, and both renderers all
 * shipped — and **nothing in any UI could create one**. Every writer was a
 * curl. Both create screens hit the mixed-rate case and sent a typed line
 * TOTAL instead: two runs of one design at ₹850 and ₹1,200 became "₹3,750, no
 * rate", the money right and every account of how it was reached discarded.
 * That is the shape #1552 closed for opportunities — a field that renders and
 * nothing can produce.
 *
 * And the partner detail screen that renders bands had never been opened in a
 * browser. It is the screen a partner uses to check what they were paid for,
 * and the one place the rates they themselves quoted have to read back.
 *
 * ## Why a browser spec and not another API case
 *
 * The API case for `rate_breakdown` has been green since the column landed. It
 * proves the route accepts bands; it says nothing about whether a human can
 * send any. The defect lives entirely in the request the screen builds, so only
 * a spec that drives the screen can see it.
 *
 * ⚠️ CONSUMES `partnerMixedRunAId` / `partnerMixedRunBId` permanently — the
 * double-pay guard working as designed. A Playwright RETRY therefore fails with
 * "already recorded on a live payout" whatever went wrong the first time.
 * **Read attempt #1, never the retries.**
 *
 * @partnerui — needs the partner-UI dev server on :5173. Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- partner-mixed-rate-payout
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"
/**
 * The admin app is served by the backend, so it normally rides the config's
 * `baseURL` and this stays empty. Set it when the backend is not on the default
 * port — e.g. when another checkout already holds :9000, which is how the first
 * run of this spec came to be graded against a stale build of somebody else's
 * branch and reported a defect that did not exist.
 */
const ADMIN = process.env.ADMIN_URL || ""

type Seed = {
  payoutPartnerEmail: string
  payoutPartnerPassword: string
  partnerMixedRunAId: string
  partnerMixedRunBId: string
  mixedDesignName: string
  /** Admin login. */
  email: string
  password: string
  adminPartnerName: string
  adminMixedRunAId: string
  adminMixedRunBId: string
  adminMixedDesignName: string
}

let seed: Seed

const runCard = (page: any, runId: string) =>
  page.locator(`[data-run-id="${runId}"]`)

test.describe("Partner per-piece prices @partnerui (#1596)", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    // A stale seed must fail loudly here rather than as an assertion against
    // `undefined`, which a `toContain` would happily pass.
    if (!seed.partnerMixedRunAId || !seed.partnerMixedRunBId) {
      throw new Error(
        "E2E seed missing the #1596 mixed-rate fixture — re-run the seed."
      )
    }
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.payoutPartnerEmail)
    await page.locator('input[name="password"]').fill(seed.payoutPartnerPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )
  })

  /**
   * The whole of #1596 in one pass: bill two runs of one design at different
   * rates, then read the resulting line back on the screen the partner opens.
   *
   * It is one test rather than two because the second half needs a submission
   * the first half creates, and the runs behind it can only be billed once.
   * Splitting them would mean either a second fixture pair or a spec whose two
   * halves must run in order — both worse than asserting twice here.
   */
  test("bills two rates as BANDS and reads them back on the detail screen", async ({
    page,
  }) => {
    await page.goto(`${PARTNER_UI}/payment-submissions/create`, {
      waitUntil: "networkidle",
    })
    await page.getByTestId("work-filter-runs").click()

    const a = runCard(page, seed.partnerMixedRunAId)
    await expect(a).toBeVisible({ timeout: 30_000 })
    await a.getByRole("checkbox").click()
    await runCard(page, seed.partnerMixedRunBId).getByRole("checkbox").click()

    // 3 × 850 + 1 × 1200. Averaging the two rates over 4 pieces reaches the
    // same 3,750, so the total alone cannot tell a breakdown from an average —
    // which is exactly why the request body is asserted below.
    await expect(page.getByTestId("submission-total")).toContainText(/3,?750/)

    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) =>
          r.url().includes("/partners/payment-submissions") &&
          r.request().method() === "POST"
      ),
      page.getByRole("button", { name: /submit for payment/i }).click(),
    ])

    if (response.status() !== 201) {
      // The message names which guard refused it; a bare status does not.
      console.log("[#1596] refused:", await response.text())
    }
    expect(response.status()).toBe(201)

    // ── The request the SCREEN built ──────────────────────────────────────
    const sent = JSON.parse(response.request().postData() || "{}")
    const designId = Object.keys(sent.production_run_ids || {})[0]
    expect(designId).toBeTruthy()

    // 🔴 The bands, sent by a human clicking two checkboxes. Before this, this
    // key was absent from every request any UI has ever made.
    expect(sent.rate_breakdown?.[designId]).toEqual([
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])

    // 🔴 And NOT also a typed total for the same line. Two spellings of one
    // figure must agree or the workflow refuses the request outright, so a
    // screen that sends both is one rounding cent away from a 400 nobody can
    // explain.
    expect(sent.cost_overrides?.[designId]).toBeUndefined()

    // ── What the line records ─────────────────────────────────────────────
    const body = await response.json()
    const submissionId = body.payment_submission.id
    // The bands fold to exactly what the collapsed typed total used to send.
    expect(Number(body.payment_submission.total_amount)).toBe(3750)

    // ── The screen a partner opens to check it ────────────────────────────
    await page.goto(`${PARTNER_UI}/payment-submissions/${submissionId}`, {
      waitUntil: "networkidle",
    })
    await expect(page.getByText(seed.mixedDesignName).first()).toBeVisible({
      timeout: 30_000,
    })

    /**
     * "3 × ₹850.00 + 1 × ₹1,200.00", not "4 × ₹937.50".
     *
     * Scoped to the line's OWN row — a page-wide search would also see the
     * submission total and could pass on text that never reached this line.
     *
     * The pattern is deliberately loose about the currency symbol, the decimals
     * and the grouping (`money()` renders through `Intl`, so all three depend
     * on the runner's locale) and strict about everything that matters: both
     * bands present, each with its own quantity, joined by "+", in that order.
     * A screen that renders one band and drops the other cannot match it.
     */
    const row = page.locator("tr", { hasText: seed.mixedDesignName })
    await expect(row).toContainText(/3\s*×[^+]*850[^+]*\+\s*1\s*×[^0-9]*1,?200/)

    /**
     * 🔴 And the average must be absent, not merely un-asserted. A mixed line's
     * `unit_amount` is null by design — inventing 937.5 would present a rate
     * nobody agreed to as one the partner had quoted.
     */
    await expect(page.getByText(/937\.5/)).toHaveCount(0)
  })

  /**
   * The ADMIN create screen, which collapsed the same case the same way.
   *
   * 🔴 Verified in a browser rather than trusted to the shared helper's unit
   * cases, because this screen is the one that has already gone down once for a
   * reason no unit or integration case could see: it imported the display
   * helpers from the module that pulls in `MedusaError`, dragging Node built-ins
   * into the Vite bundle and killing the whole dashboard — login included — on
   * `util.inherits is not a function`. Everything was green throughout.
   *
   * ⚠️ Its own runs, for the same single-use reason as the partner case.
   */
  test("the admin screen sends bands too, not a collapsed total", async ({
    page,
  }) => {
    await page.goto(`${ADMIN}/app/login`)
    // `networkidle` never settles against `medusa develop` (it holds long-lived
    // connections open), so wait on the form itself.
    await page.locator('input[name="email"]').waitFor({ timeout: 60_000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15_000 })

    await page.goto(`${ADMIN}/app/payment-submissions/create`)
    await expect(
      page.getByRole("heading", { name: "New Payment Submission" })
    ).toBeVisible({ timeout: 30_000 })

    await page.getByRole("combobox").first().click()
    await page.getByRole("option", { name: seed.adminPartnerName }).click()

    // The screen is two steps now: who is paid, then what for. The runs are a
    // full-width grid on the second.
    await page.getByRole("button", { name: "Continue" }).click()

    /**
     * One grid row. The run id lives on the DESIGN cell — the grid renders its
     * own rows and offers no hook for a per-row attribute — so the row is
     * reached by asking which row contains that cell.
     */
    const row = (runId: string) =>
      page
        .locator('[role="row"]')
        .filter({
          has: page.locator(
            `[data-testid="payable-run-row"][data-run-id="${runId}"]`
          ),
        })

    await expect(row(seed.adminMixedRunAId)).toBeVisible({ timeout: 30_000 })
    await row(seed.adminMixedRunAId).getByRole("checkbox").click()
    await row(seed.adminMixedRunBId).getByRole("checkbox").click()

    // 3 × 850 + 1 × 1200 = 3,750 — the same figure an average would reach, so
    // the request body below is what actually distinguishes them.
    await expect(page.getByTestId("submission-total")).toHaveText("INR 3,750", {
      timeout: 10_000,
    })

    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) =>
          r.url().includes("/admin/payment-submissions") &&
          r.request().method() === "POST"
      ),
      page.getByRole("button", { name: "Create Submission" }).click(),
    ])
    if (response.status() !== 201) {
      console.log("[#1596][admin] refused:", await response.text())
    }
    expect(response.status()).toBe(201)

    const sent = JSON.parse(response.request().postData() || "{}")
    const designId = Object.keys(sent.production_run_ids || {})[0]
    expect(sent.rate_breakdown?.[designId]).toEqual([
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])
    // Not also a typed total for the same line — see the partner case.
    expect(sent.cost_overrides?.[designId]).toBeUndefined()
    expect(Number(response.json ? (await response.json()).payment_submission.total_amount : 0)).toBe(3750)
  })
})
