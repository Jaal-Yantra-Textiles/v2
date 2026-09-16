import { test, expect, type Page } from "@playwright/test"

/**
 * The four LIVE products #2078 was really about (#1970).
 *
 * ## Why this file exists
 *
 * #2075 made an unanswered required spec group hold the buy button. Right when
 * the choices are on the page; wrong when they are not. Past two groups the
 * choices move to `/products/:handle/customise`, the product page shows a
 * summary and a "Customise this piece →" link, and its button becomes the
 * BUY-IT-AS-IS path. The gate disabled that button, labelled it "Choose a
 * dyeing method", and left no control on the page to answer with.
 *
 * It was already in `main`, and it hit exactly four selling products. #2078
 * fixed it — and the sibling spec, `storefront-design-made-to-spec`, cannot
 * catch a regression here: it seeds a design with ONE group, so it only ever
 * exercises the inline path. The second-step path had never been clicked
 * through on a real product at all.
 *
 * So this file is deliberately not a seeded simulation. It runs against the
 * real catalogue, because the thing that broke was a shape only the real
 * catalogue has: 1 colour + 7 option groups, two of them required.
 *
 * ## Running it
 *
 * Point a storefront at a backend that HAS these products and run:
 *
 *   pnpm exec playwright test -c e2e/playwright.storefront.config.ts \
 *     storefront-live-required-choices
 *
 * Against production data, with the storefront built from `main`:
 *
 *   cd apps/storefront && rm -rf .next && \
 *     MEDUSA_BACKEND_URL=https://v3.jaalyantra.com \
 *     NEXT_PUBLIC_MEDUSA_BACKEND_URL=https://v3.jaalyantra.com \
 *     NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=<the gof-asia publishable key> \
 *     NEXT_PUBLIC_BASE_URL=http://localhost:8000 \
 *     NEXT_PUBLIC_DEFAULT_REGION=in \
 *     npx next dev -p 8000
 *
 * ⚠️ `STOREFRONT_CART_WRITES=1` opts the last test in. It creates a REAL guest
 * cart on whatever backend the storefront is pointed at. Left off by default so
 * the render-and-gate checks are safe to run against production; turn it on
 * deliberately, and clean the cart up afterwards.
 *
 * @storefront @localstack — `@storefront` alone does not keep this out of the
 * CI admin run; `@localstack` is what excludes it. It can never be a CI gate
 * anyway: it asserts against live catalogue data that CI has no copy of.
 */

const BASE = process.env.STOREFRONT_URL ?? "http://localhost:8000/in"

/** The four products the #2075 regression took down, by handle. */
const PRODUCTS = [
  { handle: "handspun-muslin", title: "Traditional Muslin" },
  { handle: "kala-cotton", title: "Kala Cotton" },
  { handle: "bengal-jamdani", title: "Bengal Jamdani" },
  { handle: "handwoven-linen", title: "HandWoven Linen" },
]

/** Both required on all four. Keys, because the testid is built from the key. */
const REQUIRED = [
  { key: "dyeing_method", label: "Dyeing Method" },
  { key: "dye_color", label: "Dye Color" },
]

const choiceGroup = (page: Page, key: string) =>
  page.getByTestId(`spec-choice-${key}`)

/**
 * The buttons inside one choice group.
 *
 * Scoped to the group and read as a LIST rather than by name. Playwright's
 * `name` is a case-insensitive substring match, which on this page resolves
 * "Black" against "Black" and "Natural White" against the colour swatch above
 * it — the trap that made every assertion in `storefront-design-made-to-spec`
 * a guess until it was first run.
 */
const choices = (page: Page, key: string) =>
  choiceGroup(page, key).getByRole("button")

/**
 * Click a choice and confirm it took.
 *
 * The buttons are server-rendered but only respond once React has hydrated, so
 * a bare click can land on markup with no handler and vanish silently — the
 * page still looks right and the wrong value reaches the cart.
 */
const choose = async (page: Page, key: string, index = 0) => {
  const button = choices(page, key).nth(index)
  await expect(async () => {
    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "true")
  }).toPass({ timeout: 20_000 })
  // ⚠️ FIRST LINE only. A choice button renders the value's `note` under its
  // label — "Hand-dyed with Indigo" carries "Traditional natural dye" — and the
  // cart prints the label alone. Returning the whole button text made the cart
  // assertion fail on a line that was in fact perfectly correct.
  return (await button.innerText()).trim().split("\n")[0].trim()
}

/**
 * Get the product page onto a variant that is actually BUYABLE.
 *
 * Walks the cartesian product of the option axes and stops at the first
 * combination whose button is neither "Select variant" nor "Out of stock".
 *
 * Both exclusions were learned the hard way on these four products:
 *
 *  - first-of-each-axis is not enough. The muslin carries two axes, "Mill Spun
 *    Handwoven" and "Hand Spun Handwoven", with a `-` sentinel meaning "not
 *    this family". First-of-each gives ST + 100S, a combination no variant has,
 *    and the page sits on "Select variant" forever.
 *
 *  - "Out of stock" has to be skipped too, and this is the subtle one. It
 *    OUTRANKS "Choose a …" in the button's label ternary and disables the
 *    button for a legitimate reason — so on an out-of-stock variant this test
 *    cannot tell the #2078 fix from the bug it repairs. Both look identical.
 *    Landing there would have made the muslin case permanently uninformative
 *    while looking like a real failure.
 *
 * Selection itself is unassertable: `option-button` carries no `aria-pressed`,
 * only a CSS class (`option-select.tsx`), which is as invisible to a screen
 * reader as it is to this test. So the signal is the button's own text.
 */
const selectAnyVariant = async (
  page: Page,
  buy: ReturnType<Page["getByTestId"]>
) => {
  const pickers = page.getByTestId("product-options")
  const axes = await pickers.count()
  if (axes === 0) return

  const valueCounts: number[] = []
  for (let i = 0; i < axes; i++) {
    valueCounts.push(await pickers.nth(i).getByTestId("option-button").count())
  }

  const total = valueCounts.reduce((a, b) => a * b, 1)
  for (let n = 0; n < total; n++) {
    let rest = n
    for (let i = axes - 1; i >= 0; i--) {
      const v = rest % valueCounts[i]
      rest = Math.floor(rest / valueCounts[i])
      await pickers.nth(i).getByTestId("option-button").nth(v).click()
    }
    // The buttons only respond once React has hydrated; a click on unhydrated
    // markup vanishes silently. Give the label a moment to catch up before
    // judging the combination.
    await page.waitForTimeout(200)
    const label = (await buy.innerText()).trim()
    if (!/select variant|out of stock/i.test(label)) return
  }

  throw new Error(
    `no combination of this product's ${axes} option axes produced a buyable ` +
      `variant — the button never left "Select variant"/"Out of stock"`
  )
}

/**
 * Pick a real colour swatch.
 *
 * ⚠️ Not `choices(page, "colour").first()`. The colour row opens with a "none"
 * button so a first tap is reversible — without it, looking at a swatch would
 * lock the customer into a made-to-order purchase. That button is index 0 and
 * is `aria-pressed` on load, so taking the first would "choose" not-choosing.
 */
const chooseColour = async (page: Page) => {
  const group = choiceGroup(page, "colour")
  const swatch = group
    .getByRole("button")
    .and(page.locator(':not([data-testid="spec-choice-colour-none"])'))
    .first()
  await expect(async () => {
    await swatch.click()
    await expect(swatch).toHaveAttribute("aria-pressed", "true")
  }).toPass({ timeout: 20_000 })
  return (await swatch.innerText()).trim().split("\n")[0].trim()
}

const open = async (page: Page, url: string) => {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" })
  // A 404 here means the handle moved or the product left the storefront's
  // sales channel. Failing loudly beats a skip that reads as a pass.
  expect(response?.status(), `${url} did not load`).toBeLessThan(400)
}

for (const product of PRODUCTS) {
  test.describe(`${product.title} @storefront @localstack`, () => {
    const productUrl = `${BASE}/products/${product.handle}`
    const customiseUrl = `${productUrl}/customise`

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
    })

    test("🔴 the product page does NOT hold a question it never asks", async ({
      page,
    }) => {
      /*
       * The regression itself. With 7 groups these products are past the
       * second-step threshold, so the product page links out instead of
       * asking — and its button must stay the buy-it-as-is path. #2075 left it
       * disabled and labelled "Choose a dyeing method", with no control on the
       * page to answer with.
       *
       * 🔑 Picking the variant FIRST is not housekeeping, it is the test. The
       * first version of this assertion checked only the label, and a mutation
       * run — #2078's fix reverted on purpose — caught 1 of these 4 products,
       * not 4. On the other three the button reads "Select variant", which
       * takes precedence in the label ternary and HID the broken state
       * completely. A green test for three products that were in fact dead.
       *
       * It also says something about the live fault: on a multi-variant fabric
       * the customer meets the dead end only after choosing a variant, one
       * click deeper than anybody looking at the page would notice.
       */
      await open(page, productUrl)

      // Proves this product really is on the second-step path. Without it the
      // assertion below would pass for the boring reason.
      await expect(page.getByTestId("customise-link")).toBeVisible()

      const buy = page.getByTestId("add-product-button")
      await expect(buy).toBeVisible()

      /*
       * Answer the variant axes, so that whatever is left holding the button
       * can only be the spec gate.
       *
       * ⚠️ Confirmed by the BUTTON, not by the option's own state. Unlike the
       * spec choices, `option-button` carries no `aria-pressed` — selection is
       * signalled by a CSS class alone (`option-select.tsx`), which is both
       * untestable and unreadable to a screen reader. So the assertion is the
       * observable consequence: the button stops saying "Select variant".
       *
       * ⚠️ The click is RETRIED, not fired once. These buttons are
       * server-rendered and only respond after React hydrates, so a single
       * click can land on markup with no handler and vanish silently.
       *
       * ⚠️ And the combination is SEARCHED, not assumed. Taking the first
       * value on each axis looks obviously right and is wrong on the muslin:
       * it carries two axes, "Mill Spun Handwoven" and "Hand Spun Handwoven",
       * with a `-` sentinel meaning "not this family". First-of-each gives
       * ST + 100S, which no variant has, and the page sits on "Select variant"
       * forever. That is live catalogue shape, not a fault in the fix — but a
       * test that cannot pick a variant cannot say anything about the button.
       */
      await selectAnyVariant(page, buy)

      await expect(buy).toBeVisible()
      await expect(buy).not.toHaveText(/^Choose a /)
      // The label is not enough on its own — "Out of stock" also outranks
      // "Choose a …", and a disabled button is a dead end whatever it says.
      await expect(buy).toBeEnabled()
    })

    test("the customise page asks both required questions", async ({
      page,
    }) => {
      await open(page, customiseUrl)
      await expect(page.getByTestId("customise-container")).toBeVisible()

      for (const group of REQUIRED) {
        await expect(
          choiceGroup(page, group.key),
          `${group.label} is missing from ${customiseUrl}`
        ).toBeVisible()
      }
    })

    test("🔴 pre-picks nothing — the customer answers", async ({ page }) => {
      /*
       * Preselecting and then not counting the preselection is what threw the
       * customer's answer away in the first place. There is no "usual" dye
       * colour; defaulting one ships whatever happened to be first to someone
       * who never looked at the control.
       */
      await open(page, customiseUrl)

      for (const group of REQUIRED) {
        const buttons = choices(page, group.key)
        const count = await buttons.count()
        expect(count, `${group.label} rendered no choices`).toBeGreaterThan(0)
        for (let i = 0; i < count; i++) {
          await expect(buttons.nth(i)).toHaveAttribute("aria-pressed", "false")
        }
      }
    })

    test("holds its own button until every question is answered", async ({
      page,
    }) => {
      await open(page, customiseUrl)

      const add = page.getByTestId("customise-add-button")
      await expect(add).toBeDisabled()
      // Name the question, not the state — and this page DID ask it.
      await expect(add).toHaveText(/^Choose /)

      await choose(page, "dyeing_method")
      // Still held: the second required group is unanswered.
      await expect(add).toBeDisabled()

      await choose(page, "dye_color")
      /*
       * 🔴 STILL held, on the COLOUR — and this is the assertion that was
       * missing until these pages were clicked through for real.
       *
       * Colour is required by `made-to-spec/lib.ts` whenever the palette is
       * non-empty, but it lives in `spec.colors` while the gate only ever read
       * `spec.options`. Before the fix the button went enabled and said "Add to
       * cart" right here, and every click on all four of these products came
       * back "Choose a colour. Available colours: Natural White."
       */
      await expect(add).toBeDisabled()
      await expect(add).toHaveText(/^Choose colour/i)

      await chooseColour(page)
      await expect(add).toBeEnabled()
      await expect(add).toHaveText(/Add to cart/i)
    })
  })
}

/**
 * The half the render checks cannot prove: that the answer SURVIVES.
 *
 * A correct-looking form that discards the choice is precisely the defect
 * #2078's sibling fixed — the page preselected every required group and then
 * discounted it as "our prefill", so a customer picking L got an ordinary cart
 * line with no size on it. Reading it back on the cart, not on the form's own
 * confirmation, is the only assertion that says anything.
 *
 * Opt-in: this writes a real guest cart.
 */
test.describe("the chosen answers reach the cart @storefront @localstack", () => {
  test.skip(
    process.env.STOREFRONT_CART_WRITES !== "1",
    "writes a real cart — set STOREFRONT_CART_WRITES=1"
  )

  test("carries dyeing method and dye colour onto the line", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, `${BASE}/products/handspun-muslin/customise`)

    const method = await choose(page, "dyeing_method")
    const dyeColour = await choose(page, "dye_color")
    // Required by the backend on every one of these products; invisible to the
    // gate until this spec was first run against a real one.
    await chooseColour(page)

    const add = page.getByTestId("customise-add-button")
    await expect(add).toBeEnabled()
    await add.click()

    // Wait for the CART COUNT, not a timer: add-to-cart sets its cookie in its
    // own response, so navigating straight after the click races it and /cart
    // renders "cart does not exist".
    await expect(page.getByTestId("nav-cart-link")).toContainText("Cart (1)", {
      timeout: 30_000,
    })

    await open(page, `${BASE}/cart`)

    const line = page.getByTestId("line-item-made-to-spec").first()
    await expect(line).toBeVisible({ timeout: 30_000 })

    // Label AND value. The value alone would not say which question it
    // answered, and on an order that is the difference between a record and a
    // riddle.
    await expect(line).toContainText(`Dyeing Method: ${method}`)
    await expect(line).toContainText(`Dye Color: ${dyeColour}`)
  })
})
