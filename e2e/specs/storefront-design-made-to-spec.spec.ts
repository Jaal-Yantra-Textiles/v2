import { test, expect } from "@playwright/test"

/**
 * A design's sizes, chosen by the customer at the storefront (#1970).
 *
 * Sibling of `storefront-made-to-spec.spec.ts`, and the distinction is the
 * point. That file seeds a product and a spec BY HAND and proves the storefront
 * renders option groups. This one seeds neither: it seeds a DESIGN with four
 * sizes and runs the real mint, so what it proves is that the mint ATTACHES the
 * spec — the half that did not exist.
 *
 * ## What was broken
 *
 * `create-product-from-design` wrote no spec at all. A design reached the
 * storefront as one variant whose option axis was the design's own NAME, so
 * there was no size on the page and nothing to choose. The customer-facing
 * surface had been built and tested for months; the design door was never wired
 * to it.
 *
 * ## Why sizes are not variants
 *
 * The obvious repair is one variant per size. `product-spec-option.ts` records
 * this platform reversing exactly that: 3 patterns × 2 spins gave "6 phantom
 * variants where 2 real ones will do" for cloth woven to order and never
 * stocked. Four sizes of a made-to-order shawl is the same shape. It would also
 * make the design UNQUOTABLE — `design-lines.ts:140` resolves a design's
 * variant only when exactly one backs it.
 *
 * So the last test here is the one that would catch a regression to variants:
 * the size must NOT appear in the variant picker.
 *
 * @storefront @localstack — `@storefront` alone would not keep this out of the
 * CI admin run; `@localstack` is what excludes it. Run it with the storefront
 * config:
 *
 *   # 1. seed the design and mint its product
 *   cd apps/backend && npx medusa exec src/scripts/seed-design-spec-local.ts
 *   # 2. backend. The seed's events never reach the index engine (its bus dies
 *   #    with the process), so /store/products returns [] — disable the index.
 *   MEDUSA_FF_INDEX_ENGINE=false npx medusa develop
 *   # 3. storefront on :8000, then:
 *   pnpm exec playwright test -c e2e/playwright.storefront.config.ts \
 *     storefront-design-made-to-spec
 *
 * The seed logs the handle it minted; pass it in if it differs:
 *   DESIGN_SPEC_URL=http://localhost:8000/in/products/<handle> pnpm exec …
 */

const PRODUCT_URL =
  process.env.DESIGN_SPEC_URL ??
  "http://localhost:8000/in/products/e2e-kashida-shawl-made-to-size"

const CART_URL = new URL("../cart", PRODUCT_URL).toString()

/** Mirrors SIZES in src/scripts/seed-design-spec-local.ts. */
const SIZES = ["S", "M", "L", "XL"]

/**
 * A size button, SCOPED and EXACT — both matter, and neither was true when this
 * file was first written (it had never been run).
 *
 * Playwright's `name` is a case-insensitive SUBSTRING match by default, so a
 * bare `getByRole("button", { name: "S" })` resolved to eight elements on this
 * page: "Design score info", "Story info", "Select variant", "Subscribe", both
 * variant buttons — and, somewhere in there, the actual size. Every assertion
 * either failed on strict mode or would have passed against the wrong button.
 */
const sizeButton = (page: any, label: string) =>
  page.getByTestId("spec-choice-size").getByRole("button", {
    name: label,
    exact: true,
  })

/**
 * Click a choice and confirm it took.
 *
 * Copied deliberately from `storefront-made-to-spec.spec.ts` rather than
 * shared: the note it carries is the reason it exists, and a helper imported
 * from another spec would arrive here without it. The buttons are
 * server-rendered but only respond once React has hydrated, so a bare click can
 * land on markup with no handler and vanish silently — the page still looks
 * right and the wrong value reaches the cart.
 */
const choose = async (page: any, name: string, pressed = true) => {
  const button = sizeButton(page, name)
  await expect(async () => {
    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", String(pressed))
  }).toPass({ timeout: 20_000 })
}

test.describe("Design sizes as a customer choice @storefront @localstack", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const response = await page.goto(PRODUCT_URL, {
      waitUntil: "domcontentloaded",
    })
    // A 404 means the design was never minted or the product is not on the
    // storefront's sales channel. Failing loudly beats a skip that reads as a
    // pass.
    expect(
      response?.status(),
      `${PRODUCT_URL} did not load — run the seed and start the stack ` +
        `(see the header of this file)`
    ).toBeLessThan(400)
  })

  test("offers every size the design states", async ({ page }) => {
    await expect(page.getByText("Size", { exact: true })).toBeVisible()
    for (const size of SIZES) {
      await expect(sizeButton(page, size)).toBeVisible()
    }
  })

  test("🔴 requires a size — it does not pick one for the customer", async ({
    page,
  }) => {
    /*
     * A garment has no "usual" size. Defaulting one would ship whatever
     * happened to be first to a customer who never looked at the control —
     * which is the failure the variants-by-size design would have had too,
     * just moved.
     */
    for (const size of SIZES) {
      await expect(sizeButton(page, size)).toHaveAttribute(
        "aria-pressed",
        "false"
      )
    }
  })

  test("carries the chosen size onto the cart line", async ({ page }) => {
    await choose(page, "L")

    await page.getByTestId("add-product-button").click()

    // Wait for the CART COUNT, not a timer: add-to-cart is a server action that
    // sets the cookie in its own response, so navigating straight after the
    // click races it and /cart renders "cart does not exist".
    await expect(page.getByTestId("nav-cart-link")).toContainText("Cart (1)", {
      timeout: 30_000,
    })

    // Read it back on the CART, not a confirmation the form gave itself.
    await page.goto(CART_URL, { waitUntil: "domcontentloaded" })

    const line = page.getByTestId("line-item-made-to-spec").first()
    await expect(line).toBeVisible({ timeout: 30_000 })

    // Label AND value. The value alone would not say which question it
    // answered, and on an order that is the difference between a record and a
    // riddle.
    await expect(line).toContainText("Size: L")
  })

  test("🔴 the size is NOT a product variant", async ({ page }) => {
    /*
     * The regression guard for the whole approach. If a size shows up in the
     * variant picker, the mint went back to one variant per size: four SKUs
     * for a shawl woven to order and never stocked, four inventory items, four
     * price rows to fan out — and a design that can no longer be quoted,
     * because design-lines.ts resolves a variant only when exactly one backs
     * the design.
     */
    const variantPicker = page.getByTestId("product-options")
    for (const size of SIZES) {
      await expect(
        // `exact` is the whole assertion here: without it "S" matches the
        // variant button titled "E2E — Kashida Shawl, made to size" and this
        // guard fails on a product that is behaving perfectly.
        variantPicker.getByRole("button", { name: size, exact: true })
      ).toHaveCount(0)
    }
  })
})
