import { createAdminUser } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  VARIANT_A_TIER_PRICE,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(240 * 1000)

/**
 * The LIVE half of the buyer page re-prices through the buyer's own price list.
 *
 * ## The defect this exists for
 *
 * 🔴 `buildQuoteView` priced the live column with `region_id`, `currency_code`
 * and `quantity` — and no customer group. The price list minted for the quote
 * is scoped to that buyer's group (`customer.groups.id`), so `calculated_price`
 * never saw it and answered with the CATALOGUE price.
 *
 * On a quote priced at catalogue, live and quoted agree by coincidence and
 * everything looks right. On a quote with a NEGOTIATED trade price — the entire
 * point of this epic — the page rendered:
 *
 *   quoted  ₹28   ·   live ₹2,500   ·   "Your quote, and what it costs today"
 *   "Pricing or freight has moved since this quote was sent."   delta ₹2,472
 *
 * …minutes after minting, with nothing having moved, while the cart would
 * charge ₹33. Found by minting a real quote against a real database and
 * reading the page, not by reading the code.
 *
 * ## Why an override is the fixture
 *
 * A catalogue-priced quote CANNOT fail this test. The assertion only has teeth
 * where quoted and live are supposed to differ from the anonymous price, which
 * is exactly the case the unit tests fabricate away.
 */

setupSharedTestSuite(() => {
  describe("GET /store/b2b/quotes/:token — the live column (#1389)", () => {
    let seed: QuoteFixture
    let storeHeaders: Record<string, string>

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      seed = await setupQuoteFixture(api, getContainer)
      storeHeaders = { "x-publishable-api-key": seed.publishableKey }
    })

    const mintAndView = async (overrides: Record<string, any> = {}) => {
      const { api } = getSharedTestEnv()
      const mint = await api.post("/partners/quotes", mintBody(seed, overrides), {
        headers: seed.headers,
      })
      const view = await api.get(`/store/b2b/quotes/${mint.data.token}`, {
        headers: storeHeaders,
      })
      return { quote: view.data.quote, minted: mint.data.quote }
    }

    it("🔴 a NEGOTIATED price reads the same live as it was quoted", async () => {
      const NEGOTIATED = 900
      const { quote } = await mintAndView({
        buyer_email: `reprice-${seed.unique}@jaalyantra.test`,
        lines: [
          {
            variant_id: seed.variantA.id,
            quantity: 25,
            override_unit_amount: NEGOTIATED,
          },
        ],
      })

      expect(quote.quoted.unit_amount).toBe(NEGOTIATED)
      // THE assertion. Without the buyer's group in the pricing context this is
      // the catalogue tier price, and every number below it is wrong.
      expect(quote.live.unit_amount).toBe(NEGOTIATED)
      expect(quote.live.subtotal).toBe(quote.quoted.subtotal)
      expect(quote.live.landed_total).toBe(quote.quoted.landed_total)

      // And the page must not tell the buyer their price has moved.
      expect(quote.compare.landed_delta).toBe(0)
      expect(quote.compare.state).toBe("quoted_only")

      expect(quote.lines[0].live_unit_amount).toBe(NEGOTIATED)
    })

    it("still re-prices a catalogue line at its own tier, not at qty 1", async () => {
      // The control: the group in the context must not break the tier lookup
      // that `calculated_price` only performs when a quantity is passed.
      const { quote } = await mintAndView({
        buyer_email: `tier-${seed.unique}@jaalyantra.test`,
        lines: [{ variant_id: seed.variantA.id, quantity: 25 }],
      })

      expect(quote.live.unit_amount).toBe(VARIANT_A_TIER_PRICE)
      expect(quote.quoted.unit_amount).toBe(VARIANT_A_TIER_PRICE)
      expect(quote.compare.landed_delta).toBe(0)
    })
  })
})
