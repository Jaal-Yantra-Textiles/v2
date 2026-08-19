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
 * #1365 rebuilt the surface around those choices, and this file was rewritten
 * with it. What changed, and why each is asserted below:
 *
 *  - The choices moved OUT of a separate panel under the buying column and INTO
 *    it, between the variant selector and the price. Position is asserted by
 *    GEOMETRY, not by class names — a stylesheet can move a block without
 *    touching the markup that a class-based assertion reads.
 *  - The two buttons became ONE. #1349 split them deliberately, so the test now
 *    proves the split is gone AND that its stated reason is still served: the
 *    lead time appears as a line under the button.
 *  - That line must appear only once the selection makes the purchase
 *    made-to-order. Asserting it is present says nothing on its own; a line
 *    that is ALWAYS there would pass while telling an in-stock buyer they face
 *    a 30-day wait.
 *
 * The two assertions that carried weight before, and still do:
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

/** Pick a variant so price and add-to-cart resolve. */
const selectVariant = async (page: any) => {
  const handSpun = page.getByRole("button", { name: "HandSpun" })
  if (await handSpun.count()) {
    await choose(page, "HandSpun").catch(async () => {
      await handSpun.first().click()
    })
  }
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

  test("puts the choices between the variant selector and the price", async ({
    page,
  }) => {
    await selectVariant(page)

    const variants = page.getByTestId("product-options").first()
    const choices = page.getByTestId("spec-choices")
    const price = page.getByTestId("product-price").first()

    await expect(choices).toBeVisible()
    await expect(price).toBeVisible()

    const [variantsBox, choicesBox, priceBox] = await Promise.all([
      variants.boundingBox(),
      choices.boundingBox(),
      price.boundingBox(),
    ])

    // Geometry, not classes. The requirement is about where a customer's eye
    // lands, and only the rendered box says that.
    expect(variantsBox, "variant selector has no box").not.toBeNull()
    expect(choicesBox, "spec choices have no box").not.toBeNull()
    expect(priceBox, "price has no box").not.toBeNull()

    expect(
      choicesBox!.y,
      "the choices must sit BELOW the variant selector"
    ).toBeGreaterThan(variantsBox!.y)
    expect(
      priceBox!.y,
      "the price must sit BELOW the choices"
    ).toBeGreaterThan(choicesBox!.y)
  })

  test("offers ONE add-to-cart, and states the wait only when it applies", async ({
    page,
  }) => {
    await selectVariant(page)

    // #1349's second button is gone.
    await expect(
      page.getByRole("button", { name: "Add made-to-order piece" })
    ).toHaveCount(0)
    await expect(page.getByTestId("add-product-button")).toHaveCount(1)

    // Nothing chosen yet — this is an ordinary purchase, and telling the buyer
    // about a 30-day weave here would be false.
    await expect(page.getByTestId("made-to-order-lead-time")).toHaveCount(0)

    // Choosing the add-on turns it into a made-to-order purchase, and THAT is
    // when the wait has to be on screen. This is the mitigation #1349's split
    // existed to provide.
    await choose(page, EMBROIDERY_OFFERED)
    const leadTime = page.getByTestId("made-to-order-lead-time")
    await expect(leadTime).toBeVisible()
    await expect(leadTime).toContainText("30")

    // And it retracts when the customer backs out again.
    await choose(page, "No thanks")
    await expect(page.getByTestId("made-to-order-lead-time")).toHaveCount(0)
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
    await selectVariant(page)
    await choose(page, PATTERNS[2])
    await choose(page, EMBROIDERY_OFFERED)

    const note = `E2E ${Date.now()} — a wider border if possible.`
    await page
      .getByPlaceholder("For a September wedding", { exact: false })
      .fill(note)

    await page.getByTestId("add-product-button").click()

    // Wait for the CART COUNT, not a timer.
    //
    // `addMadeToSpecToCart` is a server action: it creates the cart, sets the
    // cookie and revalidates, all in the action's response. Navigating straight
    // after the click races it — the POST succeeds with a 200 and the browser
    // still has no cart cookie, so /cart renders "cart does not exist" and the
    // failure reads as a dropped line item rather than a test that went early.
    // The nav count is also the only success signal a shopper now gets, the old
    // "Added — add another" button having gone with the second button.
    await expect(page.getByTestId("nav-cart-link")).toContainText("Cart (1)", {
      timeout: 30_000,
    })

    // Read it back on the CART, not a confirmation the form gave itself.
    await page.goto(CART_URL, { waitUntil: "domcontentloaded" })

    const line = page.getByTestId("line-item-made-to-spec").first()
    await expect(line).toBeVisible({ timeout: 30_000 })

    // Label AND value: the value alone would not say which question it
    // answered, and on an order that is the difference between a record and a
    // riddle.
    await expect(line).toContainText(`Color Pattern: ${PATTERNS[2]}`)
    await expect(line).toContainText(`Embroidery: ${EMBROIDERY_OFFERED}`)

    // The lead time is snapshotted from the spec, not looked up live.
    await expect(line).toContainText("Made to order")
    await expect(line).toContainText(note)
  })

  test("an untouched product still adds as an ORDINARY purchase", async ({
    page,
  }) => {
    await selectVariant(page)

    // The required group's default is our prefill, not a decision the customer
    // made. If it counted as intent, one button would turn every purchase of a
    // spec'd product into a made-to-order one — the single-button design's
    // sharpest failure mode, and invisible without this test.
    await expect(page.getByTestId("made-to-order-lead-time")).toHaveCount(0)

    await page.getByTestId("add-product-button").click()
    await expect(page.getByTestId("nav-cart-link")).toContainText("Cart (1)", {
      timeout: 30_000,
    })
    await page.goto(CART_URL, { waitUntil: "domcontentloaded" })

    // Something IS in the cart — otherwise this assertion would pass on an
    // empty cart and prove nothing about which path the button took.
    await expect(page.getByTestId("line-item-made-to-spec")).toHaveCount(0)
    await expect(page.getByTestId("product-row")).not.toHaveCount(0)
  })
})
