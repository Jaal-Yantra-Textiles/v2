import { test, expect } from "@playwright/test"

/**
 * Delivery options at checkout, when there are several.
 *
 * ## What this guards
 *
 * A country covered by two overlapping service zones is offered every option
 * from BOTH. Italy matched a zone misleadingly named "Global" (5 options,
 * including an Indian domestic courier and a "European Shipping" flat rate) and
 * an International one — six rows, two of them sharing a name.
 *
 * The overlap itself was config and is fixed. These assertions are about the
 * checkout NOT depending on the catalogue being tidy: a partner can add a sixth
 * rate to a zone any day, and the page must stay usable when they do.
 *
 * ## The three defects behind each assertion
 *
 * 🔴 A calculated rate of ZERO rendered as "-". `calculatedPricesMap[id] ?` is
 * a truthiness check and `0` is falsy, so free shipping read as "we could not
 * price this" — while `isDisabled` beside it used `typeof … !== "number"` and
 * correctly treated 0 as a price. The option was enabled and priceless-looking
 * at once.
 *
 * 🔴 `hover:shadow-brders-none` — "borders" misspelt. Tailwind emits nothing
 * for an unknown class, so a disabled option kept its interactive hover and
 * looked clickable.
 *
 * ⚠️ The list was unbounded, so six rows pushed Continue below the fold and the
 * page read as broken.
 *
 * ## Why the Continue assertion is geometric
 *
 * 🔑 Asserting the button EXISTS passes on a page where it sits 400px below the
 * viewport — which is precisely the complaint. `isVisible()` is not enough
 * either: Playwright counts an off-screen-but-rendered element as visible. The
 * only assertion that matches what a buyer experiences is that the button is
 * inside the viewport without scrolling.
 *
 * @storefront @localstack — needs a storefront on :8000 and a cart that reaches
 * the delivery step, so it is excluded from the CI admin run.
 *
 *   cd apps/backend && pnpm e2e:seed && npx medusa develop
 *   cd apps/storefront && pnpm dev            # :8000
 *   STOREFRONT_CHECKOUT_URL=http://localhost:8000/in/checkout?step=delivery \
 *     pnpm exec playwright test -c e2e/playwright.storefront.config.ts \
 *     storefront-delivery-options
 */

const CHECKOUT_URL =
  process.env.STOREFRONT_CHECKOUT_URL ??
  "http://localhost:8000/in/checkout?step=delivery"

test.describe("Delivery options at checkout @storefront @localstack", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(CHECKOUT_URL, { waitUntil: "domcontentloaded" })
    await page
      .getByTestId("delivery-option-radio")
      .first()
      .waitFor({ timeout: 30_000 })
  })

  test("no option shows a bare dash where a price belongs", async ({ page }) => {
    const options = page.getByTestId("delivery-option-radio")
    const count = await options.count()
    expect(count).toBeGreaterThan(0)

    for (let i = 0; i < count; i++) {
      const row = options.nth(i)
      // A row still resolving its rate shows a loader, which is honest. A row
      // that has SETTLED on "-" is either an unpriceable option (and must be
      // disabled) or the zero-is-falsy bug showing free shipping as unknown.
      const text = (await row.innerText()).trim()
      if (/(^|\s)-(\s|$)/.test(text)) {
        await expect(
          row,
          `"${text}" shows a dash for its price but is not disabled — a free ` +
            `(zero) rate reading as unpriceable is the falsy-check bug`
        ).toBeDisabled()
      }
    }
  })

  test("two options never share a name with nothing to tell them apart", async ({
    page,
  }) => {
    const options = page.getByTestId("delivery-option-radio")
    const count = await options.count()

    const labels: string[] = []
    for (let i = 0; i < count; i++) {
      labels.push((await options.nth(i).innerText()).replace(/\s+/g, " ").trim())
    }

    // Compared on the WHOLE row, not the option name: the fix works by adding
    // the service zone underneath a duplicated name, so identical names are
    // fine as long as the rows differ.
    expect(new Set(labels).size).toBe(labels.length)
  })

  test("the Continue button stays on screen however many options there are", async ({
    page,
  }) => {
    const optionCount = await page.getByTestId("delivery-option-radio").count()
    const cta = page.getByTestId("submit-delivery-option-button")
    await expect(cta).toBeVisible()

    const box = await cta.boundingBox()
    const viewport = page.viewportSize()
    expect(box).toBeTruthy()
    expect(viewport).toBeTruthy()

    /**
     * 🔴 Geometric, not existential. The button existed throughout the bug —
     * it was simply below the fold, under an unbounded list of options, and
     * the buyer scrolled looking for it.
     */
    expect(
      box!.y + box!.height,
      `Continue sits ${Math.round(box!.y)}px down with ${optionCount} delivery ` +
        `options and a ${viewport!.height}px viewport — below the fold`
    ).toBeLessThanOrEqual(viewport!.height)
  })

  test("a long list scrolls inside itself rather than growing the page", async ({
    page,
  }) => {
    const options = page.getByTestId("delivery-option-radio")
    const count = await options.count()
    test.skip(count <= 4, "The cap only applies past four options")

    // The container carries the cap, so the LIST scrolls while the page does
    // not — which is what keeps Continue where the buyer can reach it.
    const group = options.first().locator("xpath=..")
    const scrollable = await group.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1
    )
    expect(scrollable).toBe(true)
  })
})
