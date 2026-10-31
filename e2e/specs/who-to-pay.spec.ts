import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #2480 S1 — "Who to pay", driven through the admin UI.
 *
 * The fixture partner (see `seedWhoToPay`) made 4 of 9 ordered at ₹1,100 and
 * has a second run with no rate. So the row must say:
 *
 *   - ₹4,400 owed — the PRODUCED figure; ₹9,900 would mean it summed ordered.
 *   - "1 need a price" — shown, and NOT inside the ₹4,400.
 *
 * And "Create payout" must land on the create screen already on that partner's
 * items, offering the same ₹4,400 run — the whole point of the summary using
 * the create screen's own numbers.
 *
 * Read-only: nothing is billed, so a re-run or CI retry sees the same row.
 */
test.describe("Who to pay (#2480)", () => {
  let seed: {
    email: string
    password: string
    whoToPayPartnerId: string
    whoToPayPartnerName: string
    whoToPayRunId: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    // A stale seed would make every assertion below compare against undefined.
    if (!seed.whoToPayPartnerId || !seed.whoToPayRunId) {
      throw new Error("E2E seed missing the #2480 who-to-pay fixture — re-run the seed.")
    }
  })

  const login = async (page: any) => {
    await page.goto("/app/login")
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  const partnerRow = (page: any) =>
    page.locator(
      `[data-testid="who-to-pay-row"][data-partner-id="${seed.whoToPayPartnerId}"]`
    )

  test("lists the partner with what is owed, and flags the unpriced run outside the total", async ({
    page,
  }) => {
    await login(page)
    await page.goto("/app/payment-submissions?tab=who-to-pay")

    await expect(page.getByRole("heading", { name: "Who to pay" })).toBeVisible({
      timeout: 30000,
    })

    // The route reads every partner's payout screens, so give it time.
    const row = partnerRow(page)
    await expect(row).toBeVisible({ timeout: 60000 })

    await expect(row).toContainText(seed.whoToPayPartnerName)
    await expect(row.getByTestId("who-to-pay-total")).toHaveText("₹4,400")
    await expect(row).toContainText("1 run")
    await expect(row).toContainText("1 need a price")
    // Nothing raised yet, so the "Billed, not paid" cell (4th) is empty.
    await expect(row.getByRole("cell").nth(3)).toHaveText("—")
  })

  test("Create payout opens the create screen on that partner, offering the same ₹4,400", async ({
    page,
  }) => {
    await login(page)
    await page.goto("/app/payment-submissions?tab=who-to-pay")

    const row = partnerRow(page)
    await expect(row).toBeVisible({ timeout: 60000 })
    await row.getByRole("button", { name: "Create payout" }).click()

    await expect(page).toHaveURL(
      new RegExp(`/payment-submissions/create\\?partner_id=${seed.whoToPayPartnerId}`)
    )

    // Straight to the items step — no partner picker to click through.
    await expect(
      page.getByRole("tab", { name: /Production runs/i })
    ).toHaveAttribute("data-state", "active", { timeout: 30000 })

    const amount = page.getByTestId(`run-amount-${seed.whoToPayRunId}`)
    await expect(amount).toBeVisible({ timeout: 20000 })
    await expect(amount).toHaveText("4,400")
  })

  test("the Operations hub links to it", async ({ page }) => {
    await login(page)
    await page.goto("/app/operations")
    await page.getByRole("link", { name: /Who to pay/ }).click()
    await expect(page).toHaveURL(/\/payment-submissions\?tab=who-to-pay/)
    await expect(page.getByRole("heading", { name: "Who to pay" })).toBeVisible({
      timeout: 30000,
    })
  })
})
