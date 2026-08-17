import { test, expect } from "@playwright/test"

/**
 * Product page layout on a LIVE partner storefront.
 *
 * The product page is three columns — description | gallery | buy box — and the
 * `product_page.gallery_position` theme setting moves the gallery with
 * `order-first` / `order-last`. That does not merely move the images: pushing
 * the gallery to an edge pulls the two narrow (max-w-[300px]) columns together,
 * so the description ends up directly beside Add to cart and the variant
 * picker. Reported from a real storefront stuck on `gallery_position: "left"`.
 *
 * The assertion is GEOMETRIC on purpose. Checking for the `order-first` class
 * would pass the moment someone renamed a utility class while the page still
 * rendered wrongly — and the complaint was about what the page looks like, not
 * what its markup says. Comparing rendered x-positions tests the thing the
 * partner actually sees.
 *
 * @storefront — hits a live external site, so it is excluded from the CI admin
 * e2e run (see playwright.config.ts). Run it locally, or point it elsewhere:
 *
 *   STOREFRONT_PRODUCT_URL=https://…/products/handle \
 *     pnpm exec playwright test -c e2e/playwright.storefront.config.ts
 */

const PRODUCT_URL =
  process.env.STOREFRONT_PRODUCT_URL ??
  "https://www.uniquepashmina.com/in/products/ikat-grid-patterns-blue-yellow"

test.describe("Storefront product page layout @storefront", () => {
  test.beforeEach(async ({ page }) => {
    // The three-column layout only applies at Medusa's `small` breakpoint and
    // up; below it everything stacks and the bug cannot manifest.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded" })
  })

  test("gallery sits between the description and the buy box", async ({
    page,
  }) => {
    const container = page.getByTestId("product-container")
    await expect(container).toBeVisible()

    const title = container.getByRole("heading").first()
    const gallery = container.locator("[data-image-layout]").first()
    // Scoped to the container: the page also renders a MOBILE sticky
    // add-to-cart bar with the same testid, so an unscoped locator matches two
    // elements. It resolved intermittently depending on whether hydration had
    // mounted the sticky bar yet — a locator that passes by winning a race is
    // worse than one that fails.
    const addToCart = container.getByTestId("add-product-button")

    await expect(title).toBeVisible()
    await expect(gallery).toBeVisible()
    await expect(addToCart).toBeVisible()

    const [titleBox, galleryBox, cartBox] = await Promise.all([
      title.boundingBox(),
      gallery.boundingBox(),
      addToCart.boundingBox(),
    ])

    if (!titleBox || !galleryBox || !cartBox) {
      throw new Error("Could not measure the product page columns")
    }

    // The description column must start left of the gallery, and the gallery
    // left of the buy box. Any other order means two text columns have been
    // pushed together.
    expect(
      titleBox.x,
      `description column (x=${titleBox.x}) should be left of the gallery (x=${galleryBox.x}) — ` +
        `if the gallery is leftmost, gallery_position is "left" and the description ` +
        `is rendering beside Add to cart`
    ).toBeLessThan(galleryBox.x)

    expect(
      galleryBox.x,
      `gallery (x=${galleryBox.x}) should be left of the buy box (x=${cartBox.x}) — ` +
        `if the gallery is rightmost, gallery_position is "right" and the same ` +
        `collapse happens on the other side`
    ).toBeLessThan(cartBox.x)
  })

  test("description is not rendered adjacent to the add-to-cart column", async ({
    page,
  }) => {
    // The symptom as a partner describes it: two narrow text columns side by
    // side. Stated separately from the ordering check so a failure report says
    // which of the two things went wrong.
    const container = page.getByTestId("product-container")
    const title = container.getByRole("heading").first()
    const addToCart = container.getByTestId("add-product-button")

    const [titleBox, cartBox] = await Promise.all([
      title.boundingBox(),
      addToCart.boundingBox(),
    ])
    if (!titleBox || !cartBox) {
      throw new Error("Could not measure the product page columns")
    }

    // Same row vertically, and nothing of substance between them horizontally,
    // is the shape of the bug. The gallery is wide, so a healthy page leaves a
    // large gap; the collapsed layout leaves roughly one column width.
    const sameRow = Math.abs(titleBox.y - cartBox.y) < 400
    const gap = cartBox.x - (titleBox.x + titleBox.width)

    if (sameRow) {
      expect(
        gap,
        `description and Add to cart are only ${Math.round(gap)}px apart on the ` +
          `same row — the gallery should be between them`
      ).toBeGreaterThan(400)
    }
  })
})
