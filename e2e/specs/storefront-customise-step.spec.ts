import { test, expect } from "@playwright/test"

/**
 * #1365 — the configurator's SECOND STEP.
 *
 * A product whose choices are too many for the buying column does not cram them
 * in and does not hide them behind a disclosure: it shows a summary and a real
 * link to `/products/<handle>/customise`, where the image stays pinned and the
 * choices scroll.
 *
 * The fixture crosses BOTH overflow thresholds (8 colours > 6 values, and
 * colours + 2 groups > 2 groups) because `needsSecondStep` is an OR of two
 * conditions — a fixture tripping only one would let a regression in the other
 * half through.
 *
 * What each test is really guarding:
 *
 *  - The narrow product must NOT overflow. Without this, a threshold accidentally
 *    set to zero would send every product to the second step and every test
 *    below would still pass.
 *  - The second step must be a ROUTE. A modal passes "the choices are visible"
 *    while failing the reason the route exists: a shareable URL and a working
 *    back button.
 *  - The image must still be on screen after scrolling to the last choice.
 *    Someone choosing a colour is looking at the cloth; a layout that scrolls it
 *    away makes them choose from memory.
 *
 * @storefront @localstack
 *
 *   cd apps/backend && npx medusa exec src/scripts/seed-wide-spec-local.ts
 *   MEDUSA_FF_INDEX_ENGINE=false npx medusa develop
 *   # storefront on :8000, then:
 *   pnpm exec playwright test -c e2e/playwright.storefront.config.ts \
 *     storefront-customise-step
 */

const BASE = process.env.STOREFRONT_URL ?? "http://localhost:8000/in"
const WIDE_URL = `${BASE}/products/wide-choice-pashmina-local`
const NARROW_URL = `${BASE}/products/ikat-grid-patterns-blue-yellow`
const CART_URL = `${BASE}/cart`

const choose = async (page: any, name: string, pressed = true) => {
  const button = page.getByRole("button", { name })
  await expect(async () => {
    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", String(pressed))
  }).toPass({ timeout: 20_000 })
}

test.describe("Made-to-order second step @storefront @localstack", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test("a WIDE product links out instead of inlining the choices", async ({
    page,
  }) => {
    const response = await page.goto(WIDE_URL, { waitUntil: "domcontentloaded" })
    expect(
      response?.status(),
      `${WIDE_URL} did not load — run seed-wide-spec-local.ts`
    ).toBeLessThan(400)

    // The summary says what is waiting, so the link is not a blind click.
    const summary = page.getByTestId("customise-summary")
    await expect(summary).toBeVisible()
    await expect(summary).toContainText("8 colours")
    await expect(summary).toContainText("Border")

    // …and the choices themselves are NOT in the column.
    await expect(page.getByTestId("spec-choices")).toHaveCount(0)

    // The summary and link sit between the variant selector and the price, in
    // the same slot the inline choices would have occupied.
    const variants = page.getByTestId("product-options").first()
    const price = page.getByTestId("product-price").first()
    const [variantsBox, summaryBox, priceBox] = await Promise.all([
      variants.boundingBox(),
      summary.boundingBox(),
      price.boundingBox(),
    ])
    expect(summaryBox!.y).toBeGreaterThan(variantsBox!.y)
    expect(priceBox!.y).toBeGreaterThan(summaryBox!.y)
  })

  test("a NARROW product does not overflow", async ({ page }) => {
    const response = await page.goto(NARROW_URL, {
      waitUntil: "domcontentloaded",
    })
    expect(response?.status()).toBeLessThan(400)

    // The control that stops "everything overflows" from passing as a feature.
    await expect(page.getByTestId("customise-summary")).toHaveCount(0)
    await expect(page.getByTestId("spec-choices")).toBeVisible()
  })

  test("the link goes to a real route that survives a reload and back", async ({
    page,
  }) => {
    await page.goto(WIDE_URL, { waitUntil: "domcontentloaded" })
    await page.getByTestId("customise-link").click()

    await expect(page).toHaveURL(/\/products\/wide-choice-pashmina-local\/customise$/)
    await expect(page.getByTestId("customise-container")).toBeVisible()

    // A modal would fail from here down. Reload: the configurator is still
    // there, so the URL genuinely addresses it.
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("customise-container")).toBeVisible()

    // Back returns to the product rather than leaving the site.
    await page.goBack({ waitUntil: "domcontentloaded" })
    await expect(page).toHaveURL(/\/products\/wide-choice-pashmina-local$/)
  })

  test("keeps the image on screen while the choices scroll", async ({
    page,
  }) => {
    await page.goto(`${WIDE_URL}/customise`, { waitUntil: "domcontentloaded" })

    const image = page.getByTestId("customise-container").locator("img").first()
    await expect(image).toBeVisible()
    const before = await image.boundingBox()

    // Scroll to the last thing a customer fills in.
    await page.getByTestId("customise-add-button").scrollIntoViewIfNeeded()
    await expect(page.getByTestId("customise-add-button")).toBeVisible()

    // Pinned means STILL IN THE VIEWPORT, not "unmoved" — a sticky element
    // does move until it reaches its offset, so asserting equal coordinates
    // would fail for the right behaviour.
    const after = await image.boundingBox()
    const viewport = page.viewportSize()!
    expect(before, "image had no box before scrolling").not.toBeNull()
    expect(after, "the image scrolled out of the viewport").not.toBeNull()
    expect(after!.y).toBeLessThan(viewport.height)
    expect(after!.y + after!.height).toBeGreaterThan(0)
  })

  test("a choice made on the second step reaches the cart line", async ({
    page,
  }) => {
    await page.goto(`${WIDE_URL}/customise`, { waitUntil: "domcontentloaded" })

    await choose(page, "Indigo")
    await choose(page, "Wide contrast")

    const note = `E2E ${Date.now()} — for a winter wedding.`
    await page
      .getByPlaceholder("For a September wedding", { exact: false })
      .fill(note)

    // The wait is stated here too — the second step is where most made-to-order
    // purchases will actually be committed.
    await expect(page.getByTestId("customise-lead-time")).toContainText("21")

    await page.getByTestId("customise-add-button").click()

    // The add is a server action that creates the cart, sets its cookie and
    // revalidates inside the action's response, then routes back to the
    // product. Navigating on the click races all of that: the POST returns 200
    // and the browser still has no cart cookie, so /cart renders "cart does not
    // exist" — a failure that reads as a dropped line item rather than a test
    // that went early. Wait for the count the shopper actually sees.
    await expect(page).toHaveURL(
      /\/products\/wide-choice-pashmina-local$/,
      { timeout: 30_000 }
    )
    await expect(page.getByTestId("nav-cart-link")).toContainText("Cart (1)", {
      timeout: 30_000,
    })

    await page.goto(CART_URL, { waitUntil: "domcontentloaded" })
    const line = page.getByTestId("line-item-made-to-spec").first()
    await expect(line).toBeVisible({ timeout: 30_000 })
    await expect(line).toContainText("Indigo")
    await expect(line).toContainText("Border: Wide contrast")
    await expect(line).toContainText(note)
  })

  test("a product with no spec has no configurator route", async ({ page }) => {
    // The route must not exist for a product it makes no sense for — an empty
    // configurator would be a live page advertising a service the partner does
    // not offer.
    const response = await page.goto(`${NARROW_URL.replace(
      "ikat-grid-patterns-blue-yellow",
      "a-product-that-does-not-exist"
    )}/customise`, { waitUntil: "domcontentloaded" })
    expect(response?.status()).toBe(404)
  })
})
