import { test, expect } from "@playwright/test"

/**
 * Ordering a piece made to the partner's spec, where the CHOICES are the
 * partner's own axes rather than product variants.
 *
 * `ikat-grid-patterns-blue-yellow` carried "Color Pattern" as a product option:
 * 3 patterns × 2 spin types = six variants for a cloth that is woven after the
 * order and never stocked. The pattern is now a spec option group, and
 * "Embroidery" — which fits neither the colour palette nor the fixed spec
 * fields — is a second one. This spec walks the customer's half of that.
 *
 * The two assertions that carry weight:
 *
 *  1. A value the partner switched OFF is not offered. It is still in the
 *     database, so a storefront that rendered everything it was given would
 *     show it and take the order.
 *  2. The choice reaches the CART LINE. A configurator that collects choices
 *     and drops them before the line item is worse than one that never asked.
 *
 * @storefront @localstack — the other `@storefront` specs hit LIVE deployed
 * sites, so that tag alone would NOT have kept this out of the CI admin run;
 * `@localstack` is what excludes it (see playwright.config.ts). Run it with the
 * storefront config:
 *
 *   # 1. seed the product + spec
 *   cd apps/backend && npx medusa exec src/scripts/seed-ikat-spec-local.ts
 *   # 2. backend. The seed's events never reach the index engine (its bus dies
 *   #    with the process), so /store/products returns [] with count: 1 —
 *   #    disable the index for a local render.
 *   MEDUSA_FF_INDEX_ENGINE=false npx medusa develop
 *   # 3. storefront on :8000, then:
 *   pnpm exec playwright test -c e2e/playwright.storefront.config.ts \
 *     storefront-made-to-spec
 *
 * Point it at a deployed storefront once the spec is live there:
 *   MADE_TO_SPEC_URL=https://…/in/products/… pnpm exec playwright test …
 */

const PRODUCT_URL =
  process.env.MADE_TO_SPEC_URL ??
  "http://localhost:8000/in/products/ikat-grid-patterns-blue-yellow"

const CART_URL = new URL("../cart", PRODUCT_URL).toString()

// Mirrors src/scripts/seed-ikat-spec-local.ts.
const PATTERNS = [
  "Pattern 1 - Blue/Mustard/Cream/Grey",
  "Pattern 2 - Mustard/Dusty Blue/Grey",
  "Pattern 3 - Blue/Yellow/Grey/Cream",
]
const EMBROIDERY_OFFERED = "Kashida — border and pallu"
const EMBROIDERY_WITHDRAWN = "Sozni — fine, all over"

/**
 * Click a choice and confirm it took.
 *
 * The buttons are server-rendered but only respond once React has hydrated, so
 * a bare `click()` can land on markup with no handler attached and vanish
 * silently — the page still looks right, and the wrong value reaches the cart.
 * It showed up as the FIRST click of a test being lost while later ones worked,
 * and only under parallel workers.
 *
 * `toPass` re-clicks until the pressed state agrees. Making the suite serial
 * would have hidden it instead of fixing it.
 */
const choose = async (page: any, name: string, pressed = true) => {
  const button = page.getByRole("button", { name })
  await expect(async () => {
    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", String(pressed))
  }).toPass({ timeout: 20_000 })
}

test.describe("Made-to-spec option groups @storefront @localstack", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const response = await page.goto(PRODUCT_URL, {
      waitUntil: "domcontentloaded",
    })
    // A 404 here means the product is not seeded or not on the storefront's
    // sales channel. Failing loudly beats a skip that reads as a pass.
    expect(
      response?.status(),
      `${PRODUCT_URL} did not load — seed the product and start the stack ` +
        `(see the header of this file)`
    ).toBeLessThan(400)
  })

  test("offers the partner's axes, and not the value they withdrew", async ({
    page,
  }) => {
    await expect(page.getByText("Have it made for you")).toBeVisible()

    // The required axis, with every published value.
    await expect(page.getByText("Color Pattern", { exact: true })).toBeVisible()
    for (const pattern of PATTERNS) {
      await expect(page.getByRole("button", { name: pattern })).toBeVisible()
    }

    // The optional one, marked as optional so it does not read as a decision
    // the customer must make.
    await expect(page.getByText("Embroidery (optional)")).toBeVisible()
    await expect(
      page.getByRole("button", { name: EMBROIDERY_OFFERED })
    ).toBeVisible()

    // The withdrawn value is in the database and MUST NOT be on the page.
    await expect(page.getByText(EMBROIDERY_WITHDRAWN)).toHaveCount(0)

    // "Color Pattern" is no longer a variant axis — the variant picker offers
    // only the spin type. If a pattern shows up here, the product still has the
    // option and the six phantom variants came back.
    const variantPicker = page.getByText("Select Spin Type")
    await expect(variantPicker).toBeVisible()
    await expect(page.getByRole("button", { name: "HandSpun" })).toBeVisible()
  })

  test("defaults the required axis and leaves the add-on unchosen", async ({
    page,
  }) => {
    // A required group defaults to its first value so the common path is one
    // click…
    await expect(
      page.getByRole("button", { name: PATTERNS[0] })
    ).toHaveAttribute("aria-pressed", "true")

    // …and an optional one starts UNSET, which is how a customer avoids paying
    // for embroidery they never chose.
    await expect(
      page.getByRole("button", { name: EMBROIDERY_OFFERED })
    ).toHaveAttribute("aria-pressed", "false")
    await expect(page.getByRole("button", { name: "No thanks" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    // The optional group can be un-chosen again — without "No thanks" the first
    // tap would be irreversible.
    await choose(page, EMBROIDERY_OFFERED)
    await choose(page, "No thanks")
    await expect(
      page.getByRole("button", { name: EMBROIDERY_OFFERED })
    ).toHaveAttribute("aria-pressed", "false")
  })

  test("carries both choices and the note onto the cart line", async ({
    page,
  }) => {
    await choose(page, PATTERNS[2])
    await choose(page, EMBROIDERY_OFFERED)

    const note = `E2E ${Date.now()} — a wider border if possible.`
    await page.getByPlaceholder("For a September wedding", { exact: false }).fill(note)

    await page.getByRole("button", { name: "Add made-to-order piece" }).click()
    await expect(
      page.getByRole("button", { name: "Added — add another" })
    ).toBeVisible({ timeout: 30_000 })

    // Read it back on the CART, not the confirmation the form gave itself.
    await page.goto(CART_URL, { waitUntil: "domcontentloaded" })

    const line = page.getByTestId("line-item-made-to-spec").first()
    await expect(line).toBeVisible({ timeout: 20_000 })

    // Label AND value: the value alone would not say which question it
    // answered, and on an order that is the difference between a record and a
    // riddle.
    await expect(line).toContainText(`Color Pattern: ${PATTERNS[2]}`)
    await expect(line).toContainText(`Embroidery: ${EMBROIDERY_OFFERED}`)

    // The lead time is snapshotted from the spec, not looked up live.
    await expect(line).toContainText("Made to order")
    await expect(line).toContainText(note)
  })
})
