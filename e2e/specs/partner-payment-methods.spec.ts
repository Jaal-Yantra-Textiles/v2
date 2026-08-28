import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * Partner-UI settings/payments: edit + delete payout methods.
 *
 * Drives the REAL screen against the REAL API (partner-ui on :5173, the
 * backend on :9000). The screen's payment-methods table now carries a
 * per-row action menu (Edit / Delete); the edit opens a route drawer and the
 * delete asks for confirmation before removing the method.
 *
 * Both endpoints live at `/partners/:id/payments/methods/:methodId` and were
 * previously missing entirely — a GET-only list meant the UI could display a
 * method but nothing could change it. These cases prove the two write paths
 * the screen now wires to.
 *
 * @partnerui — needs the partner-UI dev server on :5173 and a seeded partner.
 * Run locally with:
 *   (cd apps/partner-ui && pnpm dev) &
 *   pnpm --filter @jyt/backend e2e:test -- partner-payment-methods
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")
const PARTNER_UI = process.env.PARTNER_UI_URL || "http://localhost:5173"

type Seed = {
  paymentsPartnerEmail: string
  paymentsPartnerPassword: string
  paymentsEditMethodId: string
  paymentsEditMethodName: string
  paymentsDeleteMethodId: string
  paymentsDeleteMethodName: string
}

let seed: Seed

test.describe("Partner payment methods (edit/delete) @partnerui", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (
      !seed.paymentsPartnerEmail ||
      !seed.paymentsEditMethodId ||
      !seed.paymentsDeleteMethodId
    ) {
      throw new Error(
        "E2E seed missing the payment-methods fixture — re-run the seed."
      )
    }
  })

  const login = async (page: any) => {
    await page.goto(`${PARTNER_UI}/login`, { waitUntil: "networkidle" })
    await page.locator('input[name="email"]').fill(seed.paymentsPartnerEmail)
    await page
      .locator('input[name="password"]')
      .fill(seed.paymentsPartnerPassword)
    await page.locator('button[type="submit"]').click()
    await page.waitForFunction(
      () => !!localStorage.getItem("partner_ui_auth_token"),
      { timeout: 15_000 }
    )
  }

  /**
   * Locate a table row by the account name it shows, then open that row's
   * action menu. The shared ActionMenu trigger carries
   * `aria-label="Open actions menu"`, so it is addressable per-row via the
   * row's own scope rather than a page-wide query (which would match every
   * row's menu at once).
   */
  const openRowMenu = async (page: any, accountName: string) => {
    const row = page.locator("tr", { hasText: accountName })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.getByRole("button", { name: /open actions menu/i }).click()
  }

  test("edits a payment method from the action menu via the route drawer", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`${PARTNER_UI}/settings/payments`, {
      waitUntil: "networkidle",
    })

    await openRowMenu(page, seed.paymentsEditMethodName)
    await page.getByRole("menuitem", { name: /edit/i }).click()

    await expect(
      page.getByRole("heading", { name: /edit payment method/i })
    ).toBeVisible({ timeout: 10_000 })

    const newName = `${seed.paymentsEditMethodName} (renamed)`
    await page.locator('input[name="account_name"]').fill(newName)

    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) =>
          r.url().includes(`/payments/methods/${seed.paymentsEditMethodId}`) &&
          r.request().method() === "POST"
      ),
      page.getByRole("button", { name: /save/i }).click(),
    ])

    expect(response.status()).toBe(200)

    // The screen's own table reflects the rename — not just a 200 on the wire.
    await expect(
      page.locator("tr", { hasText: newName })
    ).toBeVisible({ timeout: 15_000 })
  })

  test("deletes a payment method from the action menu after confirmation", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`${PARTNER_UI}/settings/payments`, {
      waitUntil: "networkidle",
    })

    await openRowMenu(page, seed.paymentsDeleteMethodName)
    await page.getByRole("menuitem", { name: /delete/i }).click()

    // The confirmation prompt's confirm button is also "Delete" — but the menu
    // item has role `menuitem`, so the button query is unambiguous.
    await expect(
      page.getByRole("button", { name: "Delete", exact: true })
    ).toBeVisible({ timeout: 10_000 })

    const [response] = await Promise.all([
      page.waitForResponse(
        (r: any) =>
          r.url().includes(`/payments/methods/${seed.paymentsDeleteMethodId}`) &&
          r.request().method() === "DELETE"
      ),
      page.getByRole("button", { name: "Delete", exact: true }).click(),
    ])

    expect(response.status()).toBe(200)

    // The row is gone from the list.
    await expect(
      page.locator("tr", { hasText: seed.paymentsDeleteMethodName })
    ).toHaveCount(0)
  })
})