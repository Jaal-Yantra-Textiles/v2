import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * The admin mint wizard, driven through a browser (#1439 S4 / #1446).
 *
 * 🔑 Why this file exists: the wizard shipped in #1463 and had never been
 * opened in a browser. tsc sees a component that compiles; only a render shows
 * a step that will not advance, a hook called outside its provider (#1352), or
 * a modal body that does not scroll.
 *
 * ## What this deliberately does NOT do
 *
 * It never completes a mint. A mint needs a partner whose store has a priced
 * product on a quotable freight lane — the preflight refuses anything less,
 * correctly — and standing that world up in the e2e seed would duplicate
 * `integration-tests/helpers/setup-quote-fixture.ts`, which already mints for
 * real against a container on every run. The arithmetic, the price-list rows
 * and the refusals are covered there.
 *
 * What is covered HERE is the half that suite cannot see: that it opens as a
 * modal at all, that the steps gate, and that picking a region INFERS the
 * currency instead of leaving two free-text boxes that can contradict each
 * other.
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

  const openWizard = async (page: any) => {
    await page.goto("/app/quotes")
    await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible({
      timeout: 30000,
    })
    await page.getByRole("button", { name: "Mint quote" }).click()
    // 🔑 A dialog, not a page. It shipped as a plain Container — the one
    // create flow that navigated away from wherever the operator was.
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30000 })
  }

  test("opens as a focus modal with all four steps", async ({ page }) => {
    await login(page)
    await openWizard(page)

    for (const step of ["Partner", "Buyer", "Products", "Quantities"]) {
      await expect(page.getByRole("tab", { name: step })).toBeVisible()
    }
  })

  test("will not leave the Partner step until a partner is chosen", async ({
    page,
  }) => {
    await login(page)
    await openWizard(page)

    // Every quote is partner-scoped: the partner decides which catalogue the
    // variants come from and which location freight is quoted from, so
    // choosing products first would build a basket rejected wholesale.
    await page.getByRole("button", { name: "Continue" }).click()
    await expect(page.getByRole("tab", { name: "Partner" })).toHaveAttribute(
      "aria-selected",
      "true"
    )

    await page.getByText("Select a partner").click()
    await page.getByRole("option", { name: seed.parkedRunFreshPartnerName }).click()
    await page.getByRole("button", { name: "Continue" }).click()

    await expect(page.getByRole("tab", { name: "Buyer" })).toHaveAttribute(
      "aria-selected",
      "true",
      { timeout: 15000 }
    )
  })

  test("🔑 picking a region infers the currency and narrows the destinations", async ({
    page,
  }) => {
    await login(page)
    await openWizard(page)

    await page.getByText("Select a partner").click()
    await page.getByRole("option", { name: seed.parkedRunFreshPartnerName }).click()
    await page.getByRole("button", { name: "Continue" }).click()
    await expect(page.getByText("Buyer", { exact: true }).first()).toBeVisible({
      timeout: 15000,
    })

    // Currency and destination used to be two free-text boxes, which let an
    // operator quote INR to a GB address — a combination no region supports.
    const currency = page.locator('input[name="currency_code"]')
    await expect(currency).toBeDisabled()
    await expect(currency).toHaveValue("")

    // The country list is dead until a region says which countries exist.
    await expect(page.getByText("Pick a region first")).toBeVisible()

    await page.getByText("Select a region").click()
    await page.getByRole("option").first().click()

    // The region wrote the currency; nobody typed it.
    await expect(currency).not.toHaveValue("")
    await expect(page.getByText("Pick a region first")).toBeHidden()
  })
})
