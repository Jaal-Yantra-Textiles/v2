import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * The admin mint page, driven through a browser (#1439 S4 / #1446).
 *
 * 🔑 Why this file exists: the wizard shipped in #1463 and had never been
 * opened in a browser. tsc sees a component that compiles; only a render shows
 * a step that will not advance, a hook called outside its provider (#1352), or
 * a modal body that does not scroll.
 *
 * ## It is no longer a wizard
 *
 * Minting was four `ProgressTabs` steps inside a `RouteFocusModal`. At 2,420
 * lines across its steps that had outgrown a modal — one answer visible at a
 * time, no way to glance at the basket while typing a destination, and the
 * readiness verdict scrolling away above a grid. It is now the same four
 * questions as SECTIONS on a page, in the layout of the quote detail route it
 * produces.
 *
 * So the assertions that made sense against a wizard — a dialog, `tab` roles,
 * `aria-selected`, a `Continue` button that gates — are gone, because the
 * things they described are gone. What replaced them is the property that
 * actually matters now: **every question is on screen at once**, and the
 * button that mints stays reachable while you work further down the page.
 *
 * ## What this deliberately does NOT do
 *
 * It never completes a mint. A mint needs a partner whose store has a priced
 * product on a quotable freight lane — the preflight refuses anything less,
 * correctly — and standing that world up in the e2e seed would duplicate
 * `integration-tests/helpers/setup-quote-fixture.ts`, which already mints for
 * real against a container on every run. The arithmetic, the price-list rows
 * and the refusals are covered there.
 */
test.describe("Admin mint-quote page (#1446)", () => {
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

  const openMintPage = async (page: any) => {
    await page.goto("/app/quotes")
    await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible({
      timeout: 30000,
    })
    await page.getByRole("button", { name: "Mint quote" }).click()
    await page.waitForURL(/\/app\/quotes\/create/, { timeout: 30000 })
  }

  test("🔑 every question is on the page at once, and it is not a dialog", async ({
    page,
  }) => {
    await login(page)
    await openMintPage(page)

    /**
     * All four at the same time — the property the wizard could not have. A
     * `toBeVisible` per heading with no navigation between them IS the
     * assertion; if any one of these still lived behind a step, the others
     * would not be on screen with it.
     */
    for (const section of [
      "Partner",
      "Buyer",
      "Products",
      "Quantities & pricing",
    ]) {
      await expect(
        page.getByRole("heading", { name: section, exact: true })
      ).toBeVisible({ timeout: 30000 })
    }

    // It used to open as a focus modal over the list.
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })

  test("🔴 the buyer section is not duplicated by its own container", async ({
    page,
  }) => {
    await login(page)
    await openMintPage(page)

    /**
     * The steps were written for a modal that supplied no chrome, so they
     * carry their own headings — `BuyerStep` in fact carries three. Wrapping
     * each one in a titled section rendered "Buyer" twice and put "Items"
     * directly above the step's own "Products". Every test passed with the
     * duplicate on screen; only a render caught it.
     */
    await expect(
      page.getByRole("heading", { name: "Buyer", exact: true })
    ).toHaveCount(1)
    await expect(
      page.getByRole("heading", { name: "Products", exact: true })
    ).toHaveCount(1)
  })

  test("the mint button stays reachable from the bottom of the page", async ({
    page,
  }) => {
    await login(page)
    await openMintPage(page)

    const products = page.getByRole("heading", { name: "Products", exact: true })
    await products.scrollIntoViewIfNeeded()

    /**
     * The sidebar is sticky. In the modal the footer button was always there
     * too — but the readiness verdict was NOT, and a refusal scrolled off
     * above the grid the operator had to fix. Both now stay put together.
     */
    await expect(page.getByRole("button", { name: "Mint quote" })).toBeVisible()
  })

  test("🔑 picking a region infers the currency and narrows the destinations", async ({
    page,
  }) => {
    await login(page)
    await openMintPage(page)

    await page.getByText("Select a partner").click()
    await page.getByRole("option", { name: seed.parkedRunFreshPartnerName }).click()

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
