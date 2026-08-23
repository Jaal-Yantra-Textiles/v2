import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PARTNER_QUOTE_MODULE } from "../../src/modules/partner-quote"
import {
  setupQuoteFixture,
  mintBody,
  type QuoteFixture,
  VARIANT_A_TIER_PRICE,
  VARIANT_B_PRICE,
} from "../helpers/setup-quote-fixture"

jest.setTimeout(240 * 1000)

/**
 * The B2B per-line trade price, against a database (#1439 S7).
 *
 * A B2B buyer does not pay retail, and until this slice a quote's
 * `quoted_unit_amount` simply WAS the live catalog price at that quantity.
 *
 * ## What only a container run can check
 *
 * That the override reaches the PRICE LIST — the rows core will actually
 * charge — and not merely the frozen columns. Those are two different writes,
 * and a discount that lands on one but not the other is the worst outcome
 * available: a quote page showing a trade price and a cart charging retail.
 * The unit suite cannot see it; it is entirely in the wiring.
 *
 * The fixture is same-currency (INR store, INR quote), so no rate is fetched
 * and the suite stays off the network. The FX arithmetic is pinned in
 * `line-override.unit.spec.ts`, and `needsExchangeRate` is what keeps the
 * common path from ever calling out.
 */

const loud = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (e: any) {
    console.log(`[${label}] ${e.response?.status}`, JSON.stringify(e.response?.data))
    throw e
  }
}

setupSharedTestSuite(() => {
  describe("POST /partners/quotes — per-line override (#1446)", () => {
    let seed: QuoteFixture

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      seed = await setupQuoteFixture(api, getContainer)
    })

    const readPriceRows = async (priceListId: string) => {
      const container = getSharedTestEnv().getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "price_list",
        // ⚠️ No `variant_id` on a price-list price through the graph — a price
        // belongs to a price SET, and the variant sits behind it. The quoted
        // quantity is the usable key, and it is unique per line here.
        fields: ["id", "prices.*"],
        filters: { id: priceListId },
      })
      return ((data ?? [])[0]?.prices ?? []) as any[]
    }

    const readLines = async (quoteId: string) => {
      const container = getSharedTestEnv().getContainer()
      const service: any = container.resolve(PARTNER_QUOTE_MODULE)
      return await service.listPartnerQuoteLines({ quote_id: quoteId })
    }

    it("quotes the catalog price when no override is given", async () => {
      const { api } = getSharedTestEnv()
      const res = await loud("mint-plain", () =>
        api.post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `buyer-plain-${seed.unique}@jaalyantra.test`,
            lines: [{ variant_id: seed.variantA.id, quantity: 25 }],
          }),
          { headers: seed.headers }
        )
      )

      const lines = await readLines(res.data.quote.id)
      expect(Number(lines[0].quoted_unit_amount)).toBe(VARIANT_A_TIER_PRICE)
      // Null, not zero and not a rate of 1: no decision was made, so none is
      // recorded.
      expect(lines[0].override_kind).toBeNull()
      expect(lines[0].override_fx_rate).toBeNull()
    })

    it("applies a percentage to the PRICE LIST, not just the frozen row", async () => {
      const { api } = getSharedTestEnv()
      const res = await loud("mint-pct", () =>
        api.post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `buyer-pct-${seed.unique}@jaalyantra.test`,
            lines: [
              { variant_id: seed.variantA.id, quantity: 25, discount_percent: 20 },
            ],
          }),
          { headers: seed.headers }
        )
      )

      const expected = Math.round(VARIANT_A_TIER_PRICE * 0.8 * 100) / 100
      const quote = res.data.quote

      const lines = await readLines(quote.id)
      expect(Number(lines[0].quoted_unit_amount)).toBe(expected)
      expect(lines[0].override_kind).toBe("discount_percent")
      expect(Number(lines[0].override_input_amount)).toBe(20)
      // A percentage has no currency, and its rate is 1 by definition.
      expect(lines[0].override_input_currency_code).toBeNull()
      expect(Number(lines[0].override_fx_rate)).toBe(1)

      // 🔴 THE assertion. The price list is what the cart charges; a discount
      // that reached only the frozen row would show a trade price on the page
      // and charge retail at checkout.
      const rows = await readPriceRows(quote.price_list_id)
      expect(rows).toHaveLength(1)
      expect(Number(rows[0].amount)).toBe(expected)
      expect(Number(rows[0].min_quantity)).toBe(25)
      // And it is NOT the catalog price — the assertion that would still pass
      // if the override had been dropped on the way to the price list.
      expect(Number(rows[0].amount)).not.toBe(VARIANT_A_TIER_PRICE)

      // And the basket totals follow the trade price, rather than the page
      // and the price list disagreeing about the same quote.
      expect(Number(quote.quoted_subtotal)).toBe(expected * 25)
    })

    it("applies a flat override, and leaves an un-overridden line alone", async () => {
      const { api } = getSharedTestEnv()
      const OVERRIDE = 19000
      const res = await loud("mint-flat", () =>
        api.post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `buyer-flat-${seed.unique}@jaalyantra.test`,
            lines: [
              {
                variant_id: seed.variantA.id,
                quantity: 25,
                override_unit_amount: OVERRIDE,
              },
              { variant_id: seed.variantB.id, quantity: 4 },
            ],
          }),
          { headers: seed.headers }
        )
      )

      const quote = res.data.quote
      const lines = await readLines(quote.id)
      const a = lines.find((l: any) => l.variant_id === seed.variantA.id)
      const b = lines.find((l: any) => l.variant_id === seed.variantB.id)

      expect(Number(a.quoted_unit_amount)).toBe(OVERRIDE)
      expect(a.override_kind).toBe("override_unit_amount")
      // Same currency, so the rate is 1 — but it is RECORDED as 1 rather than
      // left null, because a conversion did happen, at parity.
      expect(Number(a.override_fx_rate)).toBe(1)
      expect(a.override_input_currency_code).toBe(seed.currencyCode)

      // The other line is untouched: an override is per line, not per basket.
      expect(Number(b.quoted_unit_amount)).toBe(VARIANT_B_PRICE)
      expect(b.override_kind).toBeNull()

      // Keyed on the quoted quantity, which is what distinguishes the two
      // lines in the price list.
      const rows = await readPriceRows(quote.price_list_id)
      expect(Number(rows.find((r) => Number(r.min_quantity) === 25)?.amount)).toBe(
        OVERRIDE
      )
      expect(Number(rows.find((r) => Number(r.min_quantity) === 4)?.amount)).toBe(
        VARIANT_B_PRICE
      )
    })

    it("🔴 refuses an override that would mint a price of zero, and writes NOTHING", async () => {
      const { api } = getSharedTestEnv()
      const container = getSharedTestEnv().getContainer()
      const service: any = container.resolve(PARTNER_QUOTE_MODULE)
      const before = (await service.listPartnerQuotes({})).length

      await expect(
        api.post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `buyer-zero-${seed.unique}@jaalyantra.test`,
            lines: [
              { variant_id: seed.variantA.id, quantity: 25, discount_percent: 100 },
            ],
          }),
          { headers: seed.headers }
        )
      ).rejects.toMatchObject({ response: { status: 400 } })

      // An ACTIVE price of zero is one the cart cheerfully charges, so the
      // refusal has to be total — no quote, no price list, no half-written row.
      const after = (await service.listPartnerQuotes({})).length
      expect(after).toBe(before)
    })

    it("refuses both override forms on one line", async () => {
      const { api } = getSharedTestEnv()
      await expect(
        api.post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `buyer-both-${seed.unique}@jaalyantra.test`,
            lines: [
              {
                variant_id: seed.variantA.id,
                quantity: 25,
                discount_percent: 10,
                override_unit_amount: 19000,
              },
            ],
          }),
          { headers: seed.headers }
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })
  })
})
