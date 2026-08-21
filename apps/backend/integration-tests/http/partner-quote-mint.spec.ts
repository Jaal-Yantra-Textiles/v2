import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  setupQuoteFixture,
  mintBody,
  type QuoteFixture,
  FLAT_FREIGHT_AMOUNT,
  VARIANT_A_PRICE,
  VARIANT_A_TIER_PRICE,
  VARIANT_A_WEIGHT,
  VARIANT_B_PRICE,
  VARIANT_B_WEIGHT,
} from "../helpers/setup-quote-fixture"

jest.setTimeout(240 * 1000)

/**
 * The mint, against a database (#1389 S3).
 *
 * ## Why this file exists
 *
 * The mint shipped broken twice and failed 100% of the time in production,
 * while `plan-quote-prices.unit.spec.ts` stayed green through both bugs:
 *
 * 1. every line was frozen at a **null** amount, because at mint time
 *    `buildQuoteView` is called with `quote: null` and `quoted_unit_amount` is
 *    null on every line **by construction**;
 * 2. `now` arrived at `mintPriceListStep` as an ISO **string**, because a
 *    step's input is serialized on the way in, and `.toISOString()` threw.
 *
 * 🔑 Neither is visible to tsc — the declared step types describe the workflow
 * GRAPH, not the runtime payload — and neither is visible to a unit test that
 * feeds the pure function fabricated lines with the field already set. Both
 * live in the **wiring**, so only a run against a real container can see them.
 *
 * ## The one assertion that matters most
 *
 * `rules_count === 1`. A price list with `rules_count = 0` is not an error to
 * core — it is a price for EVERY customer on the platform. The workflow
 * re-reads and deletes such a list rather than returning it, and this suite
 * asserts the re-read from the outside.
 *
 * ## Carrier
 *
 * `carrier: "manual"` is deliberate: it is not a supported carrier, so the
 * resolver throws immediately, `calculated_error` is set, and freight comes
 * from the store's own flat-priced shipping options. That keeps the suite off
 * the network — a test whose result depends on Shiprocket answering is not a
 * test. The freight assertion below pins that the manual half really is what
 * priced the consignment.
 */

/** Surfaces the response body on failure — 4xx bodies are otherwise swallowed. */
const loud = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (e: any) {
    console.log(`[${label}] ${e.response?.status}`, JSON.stringify(e.response?.data))
    throw e
  }
}

setupSharedTestSuite(() => {
  describe("POST /partners/quotes — the mint, against a database (#1389 S3)", () => {
    let seed: QuoteFixture

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      seed = await setupQuoteFixture(api, getContainer)
    })

    /** The price list core actually wrote, re-read rather than assumed. */
    const readPriceList = async (priceListId: string) => {
      const container = getSharedTestEnv().getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "price_list",
        fields: [
          "id",
          "status",
          "type",
          "starts_at",
          "ends_at",
          "rules_count",
          "price_list_rules.*",
          "prices.*",
        ],
        filters: { id: priceListId },
      })
      return (data ?? [])[0]
    }

    it("mints a quote that carries real prices, and scopes them to exactly one customer group", async () => {
      const { api } = getSharedTestEnv()
      const body = mintBody(seed)

      const res = await loud("mint", () =>
        api.post("/partners/quotes", body, { headers: seed.headers })
      )

      expect(res.status).toBe(201)
      const quote = res.data.quote
      expect(quote?.id).toBeTruthy()

      // The raw token leaves the API exactly once, and only its hash is stored.
      expect(typeof res.data.token).toBe("string")
      expect(res.data.token.length).toBeGreaterThan(20)
      expect(quote.token_hash).toBeTruthy()
      expect(quote.token_hash).not.toBe(res.data.token)

      const priceListId = quote.metadata?.price_list_id
      const customerGroupId = quote.metadata?.customer_group_id
      expect(priceListId).toBeTruthy()
      expect(customerGroupId).toBeTruthy()

      const priceList = await readPriceList(priceListId)
      expect(priceList).toBeTruthy()

      // 🔴 THE assertion. rules_count = 0 is not an error to core — it is a
      // price for every customer on the platform.
      expect(Number(priceList.rules_count)).toBe(1)
      const rule = (priceList.price_list_rules ?? [])[0]
      expect(rule).toBeTruthy()
      expect(JSON.stringify(rule)).toContain(customerGroupId)

      expect(priceList.status).toBe("active")
      expect(priceList.type).toBe("override")
    })

    it("freezes the LIVE amount on every line — the null-price bug that failed the mint 100% of the time", async () => {
      const { api } = getSharedTestEnv()
      const body = mintBody(seed, {
        buyer_email: `buyer-live-${seed.unique}@jaalyantra.test`,
      })

      const res = await loud("mint", () =>
        api.post("/partners/quotes", body, { headers: seed.headers })
      )
      expect(res.status).toBe(201)

      const priceList = await readPriceList(res.data.quote.metadata.price_list_id)
      const prices: any[] = priceList.prices ?? []

      // One price per quoted line. The bug dropped every line, because
      // `planQuotePrices` correctly refuses a null amount and every line
      // carried one.
      expect(prices.length).toBe(body.lines.length)

      for (const price of prices) {
        expect(Number.isFinite(Number(price.amount))).toBe(true)
        // 🔴 Never zero. Had the mint defaulted a missing amount to 0 instead
        // of dropping it, this would have published an ACTIVE price of zero
        // that a live cart would have charged.
        expect(Number(price.amount)).toBeGreaterThan(0)
        expect(String(price.currency_code).toLowerCase()).toBe(seed.currencyCode)
      }

      // 🔴 The tier price, not the list price. `calculated_price` is the
      // QUANTITY-1 price on every /store/* route because only a cart sets
      // `context.quantity` — so a quote built from an ordinary product payload
      // would have frozen VARIANT_A_PRICE (the walk-up price) for a buyer who
      // asked for 25. Freezing the tier is the feature; this asserts it.
      const amounts = prices.map((p) => Number(p.amount)).sort((a, b) => a - b)
      expect(amounts).toEqual([VARIANT_A_TIER_PRICE, VARIANT_B_PRICE])
      expect(amounts).not.toContain(VARIANT_A_PRICE)

      // And the same amounts are frozen on the quote's own lines.
      const { getContainer } = getSharedTestEnv()
      const query: any = getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const { data: lines } = await query.graph({
        entity: "partner_quote_line",
        fields: ["id", "variant_id", "quantity", "quoted_unit_amount", "quoted_subtotal"],
        filters: { quote_id: res.data.quote.id },
      })
      expect(lines.length).toBe(body.lines.length)
      for (const line of lines) {
        expect(line.quoted_unit_amount).not.toBeNull()
        expect(Number(line.quoted_unit_amount)).toBeGreaterThan(0)
      }
    })

    it("carries ONE mint timestamp across the serialization boundary — the `now` that arrived as a string", async () => {
      const { api } = getSharedTestEnv()
      const ttlDays = 3
      const before = Date.now()

      const res = await loud("mint", () => api.post(
        "/partners/quotes",
        mintBody(seed, {
          buyer_email: `buyer-timing-${seed.unique}@jaalyantra.test`,
          ttl_days: ttlDays,
        }),
        { headers: seed.headers }
      ))
      const after = Date.now()
      expect(res.status).toBe(201)

      const quote = res.data.quote
      const quotedAt = new Date(quote.quoted_at).getTime()
      const expiresAt = new Date(quote.expires_at).getTime()

      expect(Number.isFinite(quotedAt)).toBe(true)
      expect(quotedAt).toBeGreaterThanOrEqual(before - 60_000)
      expect(quotedAt).toBeLessThanOrEqual(after + 60_000)

      // The expiry is derived from the SAME timestamp, not a second `new Date()`.
      expect(expiresAt - quotedAt).toBe(ttlDays * 24 * 60 * 60 * 1000)

      // 🔑 And the price list's window is that same pair — this is the step
      // that threw `input.now.toISOString is not a function`, so a green
      // assertion here is the regression test for a Date arriving as a string.
      const priceList = await readPriceList(quote.metadata.price_list_id)
      expect(new Date(priceList.starts_at).getTime()).toBe(quotedAt)
      expect(new Date(priceList.ends_at).getTime()).toBe(expiresAt)
    })

    it("prices freight once for the whole consignment and puts it in the landed total", async () => {
      const { api } = getSharedTestEnv()
      const res = await loud("mint", () => api.post(
        "/partners/quotes",
        mintBody(seed, {
          buyer_email: `buyer-freight-${seed.unique}@jaalyantra.test`,
        }),
        { headers: seed.headers }
      ))
      expect(res.status).toBe(201)

      const quote = res.data.quote
      // 25 × 400g + 4 × 450g = 11800g, one consignment.
      expect(Number(quote.quoted_weight_grams)).toBe(
        25 * VARIANT_A_WEIGHT + 4 * VARIANT_B_WEIGHT
      )
      expect(Number(quote.quoted_subtotal)).toBe(
        25 * VARIANT_A_TIER_PRICE + 4 * VARIANT_B_PRICE
      )
      expect(Number(quote.quoted_landed_total)).toBe(
        Number(quote.quoted_subtotal) + Number(quote.quoted_freight)
      )
      // The fixture's one flat option — freight is quoted ONCE for the
      // consignment, not per line.
      expect(Number(quote.quoted_freight)).toBe(FLAT_FREIGHT_AMOUNT)
    })

    it("writes NOTHING when the lines cannot be priced — every step reverses", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

      const buyerEmail = `buyer-unpriced-${seed.unique}@jaalyantra.test`
      const groupName = `Quote buyer — ${buyerEmail}`

      // `eur` has no price on these variants, so the live half cannot be built
      // and the mint must refuse rather than write a quote it cannot stand
      // behind.
      let status: number | undefined
      try {
        await api.post(
          "/partners/quotes",
          mintBody(seed, { buyer_email: buyerEmail, currency_code: "eur", region_id: null }),
          { headers: seed.headers }
        )
      } catch (e: any) {
        status = e.response?.status
      }
      expect(status).toBeGreaterThanOrEqual(400)

      // No quote row.
      const { data: quotes } = await query.graph({
        entity: "partner_quote",
        fields: ["id", "email_sent_to"],
        filters: { email_sent_to: buyerEmail },
      })
      expect(quotes.length).toBe(0)

      // No customer group, and therefore no orphan price scope. This is the
      // residue check that made testing the mint on production safe.
      const { data: groups } = await query.graph({
        entity: "customer_group",
        fields: ["id", "name"],
        filters: { name: groupName },
      })
      expect(groups.length).toBe(0)

      const { data: customers } = await query.graph({
        entity: "customer",
        fields: ["id", "email"],
        filters: { email: buyerEmail },
      })
      expect(customers.length).toBe(0)
    })

    it("reuses one customer group per buyer, so a repeat quote replaces prices instead of stacking a second list", async () => {
      const { api } = getSharedTestEnv()
      const buyerEmail = `buyer-repeat-${seed.unique}@jaalyantra.test`

      const first = await loud("mint-1", () =>
        api.post("/partners/quotes", mintBody(seed, { buyer_email: buyerEmail }), {
          headers: seed.headers,
        })
      )
      const second = await loud("mint-2", () =>
        api.post("/partners/quotes", mintBody(seed, { buyer_email: buyerEmail }), {
          headers: seed.headers,
        })
      )

      expect(first.status).toBe(201)
      expect(second.status).toBe(201)

      // 🔑 One identity, two quotes. A second group would have core tie-break
      // the two lists against each other on `amount ASC`.
      expect(second.data.quote.metadata.customer_group_id).toBe(
        first.data.quote.metadata.customer_group_id
      )
      expect(second.data.quote.metadata.customer_id).toBe(
        first.data.quote.metadata.customer_id
      )
      expect(second.data.quote.metadata.price_list_id).not.toBe(
        first.data.quote.metadata.price_list_id
      )
    })
  })
})
