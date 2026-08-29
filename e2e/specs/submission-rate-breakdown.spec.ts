import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #1596 — a payout line that bills more than one price per piece.
 *
 * 🔴 A mixed-price line's `unit_amount` is null by design: an average would be
 * a rate nobody agreed to, and re-deriving a total from one underpaid a partner
 * by 22% (#1637). But the Rate cell read that null as "typed total" — a
 * sentence that says the rates were never recorded, when in truth they were
 * recorded and there is more than one of them.
 *
 * The fixture submission carries a mixed line AND an ordinary one, because
 * either alone proves too little: a mixed-only fixture cannot show the common
 * path still reads a single rate, and an ordinary-only fixture never reaches
 * the bands.
 */
test.describe("Per-piece rate breakdown on a payout line (#1596)", () => {
  let seed: {
    email: string
    password: string
    rateSubmissionId: string
    rateMixedDesignName: string
    rateFlatDesignName: string
    rateMixedBreakdownText: string
    rateFlatUnitAmount: number
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.rateSubmissionId) {
      throw new Error("E2E seed missing rateSubmissionId — re-run the seed.")
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

  /** A line's row, found by the design it bills rather than by position. */
  const row = (page: any, designName: string) =>
    page.getByRole("row").filter({ hasText: designName })

  const openSubmission = async (page: any) => {
    await login(page)
    await page.goto(`/app/payment-submissions/${seed.rateSubmissionId}`)
    await expect(row(page, seed.rateMixedDesignName)).toBeVisible({
      timeout: 20000,
    })
  }

  test("states the bands on the mixed line instead of calling it a typed total", async ({
    page,
  }) => {
    await openSubmission(page)
    const mixed = row(page, seed.rateMixedDesignName)

    await expect(mixed).toContainText(seed.rateMixedBreakdownText)

    /**
     * The sentence being replaced, asserted as ABSENT on this row. Without it
     * the case would pass on a screen that rendered both — which is how a
     * reader ends up with two contradictory answers to "what rate was agreed".
     */
    await expect(mixed).not.toContainText("typed total")

    // 3 × 850 + 1 × 1200 = 3750, and `amount` stays authoritative. An average
    // (937.50 × 4) reaches the same total, so the TOTAL cannot distinguish the
    // two — only the bands can, which is why they are asserted verbatim above.
    await expect(mixed).toContainText("3,750")
  })

  test("leaves an ordinary line reading a single rate", async ({ page }) => {
    await openSubmission(page)
    const flat = row(page, seed.rateFlatDesignName)

    // The common case is byte-for-byte unchanged: one rate, shown as money.
    await expect(flat).toContainText("850")
    await expect(flat).not.toContainText("×")
    await expect(flat).not.toContainText("typed total")
  })

  test("does not offer a single rate input over a breakdown", async ({
    page,
  }) => {
    await openSubmission(page)

    /**
     * The submission is Pending, so lines ARE editable — the only state in
     * which this is assertable at all. Typing one rate over the bands beside it
     * would leave the line contradicting itself; correcting a mixed line goes
     * through reject-and-replace like any other claimed run.
     */
    /**
     * ⚠️ The edit control is an icon-only `Button` with no accessible name, so
     * it cannot be addressed by role+name — one button per row is the only
     * handle there is. Worth fixing, but not here.
     */
    const flat = row(page, seed.rateFlatDesignName)
    await flat.getByRole("button").first().click()
    await expect(flat.getByPlaceholder("rate")).toBeVisible()

    const mixed = row(page, seed.rateMixedDesignName)
    await mixed.getByRole("button").first().click()
    // The row goes into edit mode — units and amount are still correctable —
    // but the rate cell keeps stating the bands rather than offering one box.
    await expect(mixed.getByPlaceholder("rate")).toHaveCount(0)
    await expect(mixed).toContainText(seed.rateMixedBreakdownText)
  })
})
