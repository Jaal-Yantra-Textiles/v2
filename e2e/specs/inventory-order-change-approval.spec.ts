import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #1752 — the admin approves a partner's proposed inventory-order change.
 *
 * What this proves that the API test cannot: the STRIPED BANNER renders on the
 * inventory-order detail page, shows the proposed diff, and its Approve button
 * drives the real approval — after which the banner clears (the proposal is no
 * longer pending). The seeded fixture already carries a pending change, so the
 * spec only has to approve it.
 *
 * SINGLE-USE fixture: an approved change cannot be approved again. Re-seed
 * between runs (which `pnpm e2e` does).
 */

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

type Seed = {
  email: string
  password: string
  invChangeAdminOrderId: string
  invChangeAdminTaxAmount: number
  invChangeAdminEditedLineLabel: string
  invChangeAdminRemovedLineLabel: string
}

let seed: Seed

test.describe("Inventory-order change: admin approves the proposal", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.invChangeAdminOrderId) {
      throw new Error(
        "E2E seed missing the #1752 inventory-order change fixture — re-run the seed."
      )
    }
  })

  const login = async (page: import("@playwright/test").Page) => {
    await page.goto("/app/login")
    await page.locator('input[name="email"]').waitFor({ timeout: 60000 })
    await page.locator('input[name="email"]').fill(seed.email)
    await page.locator('input[name="password"]').fill(seed.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/app\/(?!login)/, { timeout: 15000 })
  }

  test("shows the pending proposal and approves it (banner clears)", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/orders/inventory/${seed.invChangeAdminOrderId}`)

    // The striped banner names the proposal and lists the diff — the edited
    // line AND the removed line, both seeded to be unambiguous.
    await expect(
      page.getByRole("heading", { name: "Partner proposed changes" })
    ).toBeVisible({ timeout: 20000 })

    await expect(
      page.getByText(seed.invChangeAdminEditedLineLabel, { exact: false }).first()
    ).toBeVisible()

    await expect(
      page.getByText(seed.invChangeAdminRemovedLineLabel, { exact: false }).first()
    ).toBeVisible()

    // Approve: the banner's button, then the confirmation dialog's button.
    await page.getByRole("button", { name: /^Approve$/ }).first().click()
    await expect(
      page.getByRole("heading", { name: "Approve partner changes?" })
    ).toBeVisible({ timeout: 10000 })
    await page.getByRole("button", { name: /^Approve$/ }).last().click()

    // Approved ⇒ no longer pending ⇒ the banner clears.
    await expect(
      page.getByRole("heading", { name: "Partner proposed changes" })
    ).toHaveCount(0)
  })
})