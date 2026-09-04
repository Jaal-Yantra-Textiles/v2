import { test, expect } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/**
 * Deposit terms, acceptance and the payment schedule, in a browser (#1439 S11).
 *
 * 🔑 Why this file exists: the backend half of S11 is covered by unit tests and
 * a validator spec, and neither can see a screen. The failures that survive
 * those checks are exactly the ones this slice is most exposed to:
 *
 * - a field the wizard renders but the request drops, because `zodValidator`
 *   forces `.strict()` and an unnamed field never reaches the workflow;
 * - a `0` that renders as "no terms" because something on the path used `||`
 *   rather than `?? `— the partner sees the number they typed and the buyer is
 *   asked for a third of the order;
 * - a Payment panel that renders on quotes nobody accepted, which reads as a
 *   buyer who failed to pay rather than one who was never asked.
 *
 * ## What this deliberately does NOT do
 *
 * It never mints and never accepts. A mint needs a partner store with a priced
 * product on a quotable lane; an acceptance needs a cart core will price
 * against a live price list. Both are covered against a real container by the
 * integration suite. What is covered HERE is the half that suite cannot see:
 * whether an operator can enter the terms at all, and whether the screen tells
 * the truth about them afterwards.
 */
test.describe("Quote deposit terms + payment schedule (#1439 S11)", () => {
  let seed: {
    email: string
    password: string
    quotePartnerName: string
    activeQuoteId: string
    acceptedQuoteId: string
    acceptedQuoteCompany: string
    zeroDepositQuoteId: string
    zeroDepositQuoteCompany: string
  }

  test.beforeAll(() => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))
    if (!seed.acceptedQuoteId || !seed.zeroDepositQuoteId) {
      throw new Error(
        "E2E seed missing the S11 quote fixtures — re-run the seed."
      )
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

  test("the mint wizard offers deposit terms on the buyer step", async ({
    page,
  }) => {
    await login(page)
    await page.goto("/app/quotes")
    await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible({
      timeout: 30000,
    })
    await page.getByRole("button", { name: "Mint quote" }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30000 })

    /**
     * The route to this field moved with #1446: the four-step wizard became a
     * small create modal plus a draft page whose edits live in drawers. The
     * deposit is a BUYER term, so it now sits in the buyer drawer — reached
     * through the `…` menu, exactly as a draft order's customer card is
     * edited. The assertions below are unchanged; only the walk to them is.
     */
    await page.getByText("Select a partner").click()
    await page.getByRole("option", { name: seed.quotePartnerName }).click()
    await page.getByText("Select a region").click()
    await page.getByRole("option").first().click()
    await page.getByRole("button", { name: "Save" }).click()
    await page.waitForURL(/\/app\/quotes\/drafts\//, { timeout: 30000 })

    await page.locator('[aria-label="Open actions menu"]').last().click()
    await page.getByRole("menuitem", { name: /Edit buyer/ }).click()
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15000 })

    const deposit = page.locator('input[name="deposit_pct"]')
    await expect(deposit).toBeVisible({ timeout: 15000 })

    // Optional, and empty by default. A pre-filled 30 would be the form
    // asserting terms nobody agreed to, and would then be frozen onto the
    // quote as though the partner had chosen it.
    await expect(deposit).toHaveValue("")

    // 🔑 A zero has to be TYPEABLE and has to survive in the field. If the
    // handler treated falsy as unset, this would clear itself — and the quote
    // would silently take the platform's 30%.
    await deposit.fill("0")
    await expect(deposit).toHaveValue("0")

    await deposit.fill("45")
    await expect(deposit).toHaveValue("45")
  })

  test("🔑 the detail page tells 0% apart from 'no terms named'", async ({
    page,
  }) => {
    await login(page)

    // A quote whose partner agreed to take nothing up front.
    await page.goto(`/app/quotes/${seed.zeroDepositQuoteId}`)
    await expect(page.getByText("Deposit terms")).toBeVisible({ timeout: 30000 })
    await expect(page.getByText("0%", { exact: true })).toBeVisible()

    // A quote where nobody said. Same row, different sentence — the platform
    // default is what will apply at acceptance, and saying "0%" here would be a
    // different and wrong promise.
    await page.goto(`/app/quotes/${seed.activeQuoteId}`)
    await expect(page.getByText("Deposit terms")).toBeVisible({ timeout: 30000 })
    await expect(page.getByText("Default (30%)")).toBeVisible()
  })

  test("an accepted quote shows what is paid and what is still owed", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/quotes/${seed.acceptedQuoteId}`)

    await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible({
      timeout: 30000,
    })

    // 40% of 815,000 — the split comes from the product's own `openForCart`, so
    // this asserts the arithmetic the buyer will actually be charged rather
    // than a number the fixture typed.
    await expect(page.getByText("Deposit (40%)")).toBeVisible()
    await expect(page.getByText("pending", { exact: true })).toBeVisible()

    // The balance is NOT due yet, and the panel has to say so. A balance that
    // reads "due" from acceptance is a demand for money against goods nobody
    // has made.
    await expect(page.getByText("Balance")).toBeVisible()
    await expect(page.getByText("not due")).toBeVisible()

    // Acceptance does not replace the status — an accepted quote is still
    // active until it is paid, and collapsing the two hides which of the
    // states the buyer is actually in.
    await expect(page.getByText("Active · Accepted")).toBeVisible()
  })

  test("a quote nobody accepted has no Payment panel at all", async ({
    page,
  }) => {
    await login(page)
    await page.goto(`/app/quotes/${seed.activeQuoteId}`)

    // Wait for the page proper before asserting an absence — asserting that
    // something is missing on a page that has not rendered passes for the
    // wrong reason, every time.
    await expect(page.getByText("Deposit terms")).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole("heading", { name: "Payment" })).toBeHidden()
  })
})
