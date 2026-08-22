import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * The admin mint wizard, driven through a browser (#1439 S4 / #1446).
 *
 * 🔑 Why this file exists: the wizard shipped in #1463 and had never been
 * opened in a browser, and #1446 has just added two fields to it that decide
 * what a buyer is charged. tsc sees a component that compiles; only a render
 * shows a step that will not advance, a hook called outside its provider
 * (#1352), or a disabled-state that never actually disables.
 *
 * ## What this deliberately does NOT do
 *
 * It never completes a mint. A mint needs a partner whose store has a priced
 * product on a quotable freight lane — the preflight (#1462) refuses anything
 * less, correctly — and standing that world up in the e2e seed would duplicate
 * `integration-tests/helpers/setup-quote-fixture.ts`, which already mints for
 * real against a container on every run. The arithmetic, the price-list rows
 * and the refusals are covered there.
 *
 * What is covered HERE is the half that suite cannot see: the form. Whether
 * the steps gate, whether the two trade-price fields exclude each other, and
 * whether clearing one leaves it EMPTY rather than zero.
 */
test.describe("Admin mint-quote wizard (#1446)", () => {
  let seed: { email: string; password: string; parkedRunFreshPartnerName: string }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.parkedRunFreshPartnerName) {
      throw new Error("E2E seed missing parkedRunFreshPartnerName — re-run the seed.")
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

  /** Partner → Buyer → Lines, which is the only way to reach the fields. */
  const openLinesStep = async (page: any) => {
    await page.goto("/app/quotes/create")
    await expect(page.getByRole("heading", { name: "Mint a quote" })).toBeVisible({
      timeout: 30000,
    })

    const cont = page.getByRole("button", { name: "Continue" })

    // 🔑 Step one gates step two. Choosing variants before a partner would let
    // an admin build a basket that is then rejected wholesale, so Continue is
    // dead until a partner is picked.
    await expect(cont).toBeDisabled()

    await page.getByText("Select a partner").click()
    await page.getByRole("option", { name: seed.parkedRunFreshPartnerName }).click()
    await expect(cont).toBeEnabled()
    await cont.click()

    await page.getByPlaceholder("procurement@example.com").fill("e2e-buyer@jyt.test")
    await expect(cont).toBeEnabled()
    await cont.click()

    await expect(page.getByRole("button", { name: "Add line" })).toBeVisible({
      timeout: 15000,
    })
  }

  test("gates each step, and the trade-price fields appear on a line", async ({
    page,
  }) => {
    await login(page)
    await openLinesStep(page)

    // An empty basket cannot advance: a quote with no lines has nothing to price.
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled()

    await page.getByRole("button", { name: "Add line" }).click()

    await expect(page.getByPlaceholder("Qty")).toBeVisible()
    await expect(page.getByPlaceholder("Disc %")).toBeVisible()
    await expect(page.getByPlaceholder("Unit price")).toBeVisible()

    // 🔴 The copy must name whose currency the unit price is in. A number typed
    // into a USD quote means the partner store's currency, and a field that did
    // not say so would be read as the buyer's.
    await expect(
      page.getByText("read in the partner store's own currency", { exact: false })
    ).toBeVisible()
  })

  test("🔑 the two trade-price forms exclude each other", async ({ page }) => {
    await login(page)
    await openLinesStep(page)
    await page.getByRole("button", { name: "Add line" }).click()

    const discount = page.getByPlaceholder("Disc %")
    const unitPrice = page.getByPlaceholder("Unit price")

    // Both live until one is used — "which wins" is a question that must never
    // arise, so the UI removes the choice rather than ranking the answers.
    await expect(discount).toBeEnabled()
    await expect(unitPrice).toBeEnabled()

    await discount.fill("15")
    await expect(unitPrice).toBeDisabled()

    // 🔴 Clearing returns the field to EMPTY, not 0. `Number("")` is 0, and a
    // zero is a request to mint a free line — the backend refuses it, but the
    // refusal would arrive as a failed mint rather than the no-op intended.
    await discount.fill("")
    await expect(discount).toHaveValue("")
    await expect(unitPrice).toBeEnabled()

    // And the same in the other direction.
    await unitPrice.fill("19000")
    await expect(discount).toBeDisabled()
    await unitPrice.fill("")
    await expect(unitPrice).toHaveValue("")
    await expect(discount).toBeEnabled()
  })
})
