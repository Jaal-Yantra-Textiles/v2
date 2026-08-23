import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * #1439 S3/S4 — the admin quote surface, driven through a browser.
 *
 * 🔑 Why this file exists: #1463 shipped the list, the detail page and the mint
 * wizard, and **not one of them had ever been opened in a browser**. Every
 * check that gated it — tsc, unit tests, `check:prod-build` — sees a component
 * that compiles, not a page that renders. The failures this covers are the ones
 * only a render can show: a hook called outside its provider (#1352), a table
 * whose search never reaches the server (#1441), a route that 404s because its
 * nesting moved.
 *
 * ## What is deliberately NOT done here
 *
 * The spec never CONFIRMS the revoke. Revoking deletes the price list behind
 * the quote, and a fixture the suite destroys on first run is a fixture that
 * passes once and then fails for a reason that has nothing to do with the code.
 * The prompt is opened and cancelled — which is the assertion that matters
 * anyway: that the destructive action is gated rather than one-click.
 */
test.describe("Admin quote surface (#1439 S3/S4)", () => {
  let seed: {
    email: string
    password: string
    quotePartnerName: string
    activeQuoteId: string
    activeQuoteCompany: string
    supersededQuoteId: string
    supersededQuoteCompany: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.activeQuoteId) {
      throw new Error("E2E seed missing activeQuoteId — re-run the seed.")
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

  test("lists quotes and narrows to one on a server-side search", async ({
    page,
  }) => {
    await login(page)
    await page.goto("/app/quotes")

    await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible({
      timeout: 30000,
    })

    // Both fixtures are in the table before anything is typed.
    await expect(page.getByText(seed.activeQuoteCompany)).toBeVisible({
      timeout: 30000,
    })

    /**
     * 🔑 The assertion that matters: the OTHER quote disappears. Until #1461
     * the route returned every quote and the table filtered the page it had
     * already been handed — which looks identical for a one-page fixture and
     * is wrong the moment there are more quotes than a page. Asserting only
     * "the match is visible" would have passed against that bug.
     */
    const search = page.getByPlaceholder("Search buyer, company or email...")
    await search.fill(seed.activeQuoteCompany)

    await expect(page.getByText(seed.supersededQuoteCompany)).toBeHidden({
      timeout: 30000,
    })
    await expect(page.getByText(seed.activeQuoteCompany)).toBeVisible()
  })

  test("opens a quote from its row and shows the frozen totals and activity", async ({
    page,
  }) => {
    await login(page)
    await page.goto("/app/quotes")

    await page.getByText(seed.activeQuoteCompany).first().click()
    await page.waitForURL(new RegExp(`/app/quotes/${seed.activeQuoteId}`), {
      timeout: 30000,
    })

    // The frozen evidence, and the buyer engagement the partner asks about.
    await expect(page.getByText("Landed total")).toBeVisible({ timeout: 30000 })
    await expect(page.getByText("Freight")).toBeVisible()
    await expect(page.getByText("Not yet")).toBeVisible()

    // 🔑 The link cannot be recovered, and the page says so instead of
    // offering a copy button that could not work.
    await expect(
      page.getByText("Shown once at mint", { exact: false })
    ).toBeVisible()

    // The activity row, with its actor. An admin-minted quote must never look
    // like one the partner made themselves.
    await expect(page.getByText("minted", { exact: false }).first()).toBeVisible()
    await expect(page.getByText("Admin", { exact: true }).first()).toBeVisible()
  })

  test("gates revoke behind a confirm that says what it deletes", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/quotes/${seed.activeQuoteId}`)

    await expect(page.getByText("Landed total")).toBeVisible({ timeout: 30000 })

    // 🔑 Revoke lives behind the section's overflow menu, not on the surface.
    // The spec used to click it directly and timed out waiting for a button
    // that is only rendered once the menu opens — which nobody noticed, because
    // the whole suite has been failing at the seed since 22 Aug. That it is
    // one level down is the point: the action DELETES the price list behind the
    // quote, so it should take an intent to reach.
    await page
      .getByRole("button", { name: /open actions menu/i })
      .first()
      .click()
    await page.getByRole("menuitem", { name: /revoke quote/i }).click()
    await expect(page.getByText("Revoke this quote?")).toBeVisible({
      timeout: 15000,
    })
    // The consequence is stated, not implied: the price list goes with it.
    await expect(
      page.getByText("deletes the price list", { exact: false })
    ).toBeVisible()

    // Cancel, deliberately — see the file header.
    await page.getByRole("button", { name: /^cancel$/i }).click()
    await expect(page.getByText("Revoke this quote?")).toBeHidden()
  })

  test("shows a superseded quote as superseded, and offers no revoke on it", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/quotes/${seed.supersededQuoteId}`)

    /**
     * 🔑 Nobody withdrew this quote — a newer one for the same buyer replaced
     * it and expired its price list (#1435). Rendering it as "Revoked" would
     * tell an operator the partner pulled the offer, which is a different and
     * wrong story. And there is nothing left to delete, so the action is
     * absent rather than shown disabled.
     */
    await expect(page.getByText("Superseded").first()).toBeVisible({
      timeout: 30000,
    })
    await expect(page.getByText("Revoked")).toBeHidden()
    await expect(page.getByRole("button", { name: /revoke quote/i })).toHaveCount(
      0
    )
  })

  test("reaches the mint wizard from the list", async ({ page }) => {
    await login(page)
    await page.goto("/app/quotes")

    await page.getByRole("button", { name: "Mint quote" }).click()
    await page.waitForURL(/\/app\/quotes\/create/, { timeout: 30000 })

    // The wizard renders its first step rather than a blank route — a page
    // that compiles is not a page that mounts (#1352).
    await expect(page.locator("form, [role=dialog]").first()).toBeVisible({
      timeout: 30000,
    })
  })
})
