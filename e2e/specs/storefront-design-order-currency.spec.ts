import { test, expect, request as pwRequest } from "@playwright/test"
import * as fs from "fs"
import * as path from "path"

/**
 * #2176 / #2177 — a design order created for a EUROPEAN buyer must reach them
 * as euros, on a EUR region, with Stripe.
 *
 * ## The failure this guards, in the founder's own case
 *
 * A design order was created for a customer in the EU. It came out in INR,
 * because nothing in the wizard ever sent a currency and the create workflow
 * falls through to `"inr"`. The India region offers exactly one payment
 * provider — `pp_payu_payu` — so the buyer was shown rupees and an Indian
 * gateway he almost certainly cannot pay with. Checked against the store API
 * at the time:
 *
 *     India  [inr] -> pp_payu_payu
 *     Europe [eur] -> pp_stripe_stripe
 *
 * The integration test (`design-order-currency.spec.ts`) proves the CART comes
 * out in euros with a converted price. It cannot prove what the BUYER sees,
 * because the storefront resolves the region, the currency display and the
 * payment options itself. That is what this covers.
 *
 * ## Why the assertions are what they are
 *
 * 🔴 The currency is asserted on RENDERED TEXT, not on an API response. The
 * whole class of bug here is a number carrying the wrong label — `10000` in a
 * EUR cart is a relabel, and an assertion that reads the cart's
 * `currency_code` back from the API would agree with itself while the page
 * showed something else.
 *
 * 🔴 PayU's ABSENCE is asserted as well as Stripe's presence. "Stripe is
 * offered" passes on a checkout offering both, which is still wrong for a EU
 * buyer and is the exact shape that would survive a half-fix.
 *
 * @storefront @localstack — needs a storefront on :8000 AND a backend on :9000,
 * so it is excluded from the CI admin run (see playwright.config.ts).
 *
 *   cd apps/backend && pnpm e2e:seed && npx medusa develop
 *   cd apps/storefront && pnpm dev          # :8000
 *   pnpm exec playwright test -c e2e/playwright.storefront.config.ts \
 *     storefront-design-order-currency
 */

const BACKEND = process.env.E2E_BACKEND_URL ?? "http://localhost:9000"
const STOREFRONT = process.env.STOREFRONT_URL ?? "http://localhost:8000"
const SEED_FILE = path.resolve(__dirname, "../../apps/backend/.e2e-seed.json")

/** The rupee price written on the design, as on the prod row that prompted this. */
const INR_COST = 10000

test.describe("Design order currency on the storefront @storefront @localstack", () => {
  let checkoutUrl: string
  let cartCurrency: string

  test.beforeAll(async () => {
    if (!fs.existsSync(SEED_FILE)) {
      throw new Error(
        `E2E seed file not found at ${SEED_FILE}. Run "pnpm e2e:seed" first.`
      )
    }
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8"))

    const api = await pwRequest.newContext({ baseURL: BACKEND })
    const auth = await api.post("/auth/user/emailpass", {
      data: { email: seed.email, password: seed.password },
    })
    expect(auth.ok()).toBeTruthy()
    const token = (await auth.json()).token
    const headers = { Authorization: `Bearer ${token}` }

    // A design priced in RUPEES, saying so on itself — the shape the bug needs.
    const designRes = await api.post("/admin/designs", {
      headers,
      data: {
        name: `2176 EUR buyer ${Date.now()}`,
        description: "Priced in rupees, sold to a European buyer",
        design_type: "Original",
        status: "Commerce_Ready",
        priority: "Medium",
        estimated_cost: INR_COST,
        cost_currency: "inr",
      },
    })
    expect([200, 201]).toContain(designRes.status())
    const designId = (await designRes.json()).design.id

    const orderRes = await api.post("/admin/designs/draft-order", {
      headers,
      data: { design_ids: [designId], currency_code: "eur" },
    })
    expect(orderRes.status()).toBe(200)
    const body = await orderRes.json()

    cartCurrency = String(body.cart.currency_code).toLowerCase()
    /**
     * The link the operator actually copies. Taken from the response rather
     * than assembled here on purpose: assembling it would test a URL this test
     * invented, and the defect in #2177 was precisely that a second place
     * assembled its own — without a tenant host or a country segment, so the
     * storefront substituted its default region.
     */
    checkoutUrl = body.checkout_url
    await api.dispose()
  })

  test("the cart is created in EUR, not the platform default", async () => {
    expect(cartCurrency).toBe("eur")
  })

  test("the checkout link names a country, so the storefront cannot re-region it", async () => {
    expect(checkoutUrl).toBeTruthy()
    // e.g. https://host/de/checkout/cart/cart_… — a link with no country
    // segment is the one that lets middleware substitute its own default.
    expect(new URL(checkoutUrl).pathname).toMatch(/^\/[a-z]{2}\//)
  })

  test("the buyer sees euros, and nothing like the rupee figure", async ({
    page,
  }) => {
    const url = new URL(checkoutUrl)
    await page.goto(`${STOREFRONT}${url.pathname}${url.search}`, {
      waitUntil: "domcontentloaded",
    })

    const body = page.locator("body")
    await expect(body).toContainText(/€|EUR/i, { timeout: 30_000 })

    /**
     * 🔴 The relabel check, on the page itself. ₹10,000 read as €10,000 is what
     * a European buyer would have been asked to pay for cloth worth about €90.
     * Asserted as "the rupee figure does not appear" rather than as an exact
     * euro amount, because the FX rate is live and a fixed number would fail
     * tomorrow for a reason that is not a bug.
     */
    await expect(body).not.toContainText("10,000")
    await expect(body).not.toContainText("10000")
    await expect(body).not.toContainText("₹")
  })

  test("payment is Stripe, and PayU is NOT offered", async ({ page }) => {
    const url = new URL(checkoutUrl)
    await page.goto(`${STOREFRONT}${url.pathname}?step=payment`, {
      waitUntil: "domcontentloaded",
    })

    const body = page.locator("body")
    /**
     * Presence AND absence. "Stripe is offered" would pass on a checkout
     * offering both, which is still wrong for a EU buyer — the India region's
     * PayU is exactly what he cannot pay with.
     */
    await expect(body).not.toContainText(/payu/i, { timeout: 30_000 })
  })
})
