import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  setupQuoteFixture,
  mintBody,
  type QuoteFixture,
  FLAT_FREIGHT_AMOUNT,
  PROVISIONED_RETURN_FREIGHT_INR,
  PROVISIONED_STANDARD_FREIGHT_INR,
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

      const priceListId = quote.price_list_id
      const customerGroupId = quote.customer_group_id
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

      const priceList = await readPriceList(res.data.quote.price_list_id)
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
      const priceList = await readPriceList(quote.price_list_id)
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
      // Freight is quoted ONCE for the consignment, not per line — and it is
      // the cheapest GENUINE offer on the lane, which is the store's
      // provisioned standard rate rather than the fixture's own flat option.
      expect(Number(quote.quoted_freight)).toBe(PROVISIONED_STANDARD_FREIGHT_INR)

      // 🔴 And explicitly NOT the return-pickup rate. `create-store-with-defaults`
      // prices "Return Shipping" below the outbound base and marks it with an
      // option-level rule `is_return = true`; the estimate read price rules and
      // never option rules, so it was offered as ordinary freight and won every
      // domestic Indian lane by being the cheapest number in the list. This is
      // the FOURTH blindness on that picker — zone, currency, price-rule, and
      // now the kind of option it is.
      expect(Number(quote.quoted_freight)).not.toBe(PROVISIONED_RETURN_FREIGHT_INR)
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
      expect(second.data.quote.customer_group_id).toBe(
        first.data.quote.customer_group_id
      )
      expect(second.data.quote.customer_id).toBe(
        first.data.quote.customer_id
      )
      expect(second.data.quote.price_list_id).not.toBe(
        first.data.quote.price_list_id
      )

      /**
       * 🔴 THE ASSERTION THIS TEST WAS MISSING (#1435).
       *
       * Everything above was already here, and it verified that two DISTINCT
       * price lists exist — which is the bug, not the fix. The test's own name
       * claimed "replaces prices instead of stacking a second list" while its
       * body confirmed the stacking and stopped. Both lists were active on one
       * group, both with `rules_count: 1`, and core tie-breaks on `amount ASC`,
       * so a re-quote at a HIGHER price handed the buyer the old cheaper one.
       *
       * The prior list must now be expired, and the prior quote marked
       * superseded.
       */
      const priorList = await readPriceList(first.data.quote.price_list_id)
      expect(priorList).toBeTruthy()
      expect(new Date(priorList.ends_at).getTime()).toBeLessThanOrEqual(
        Date.now()
      )

      const currentList = await readPriceList(second.data.quote.price_list_id)
      expect(new Date(currentList.ends_at).getTime()).toBeGreaterThan(Date.now())

      // And the buyer's older link says so, rather than silently repricing.
      const priorQuote = await loud("read-prior", () =>
        api.get(`/partners/quotes/${first.data.quote.id}`, {
          headers: seed.headers,
        })
      )
      expect(priorQuote.data.quote.status).toBe("superseded")

      const currentQuote = await loud("read-current", () =>
        api.get(`/partners/quotes/${second.data.quote.id}`, {
          headers: seed.headers,
        })
      )
      expect(currentQuote.data.quote.status).toBe("active")
    })

    describe("the readiness preflight (#1445)", () => {
      it("passes a basket that can actually be quoted, and previews the freight", async () => {
        const { api } = getSharedTestEnv()
        const body = mintBody(seed)
        const res = await loud("readiness-ok", () =>
          api.post(
            "/partners/quotes/readiness",
            {
              lines: body.lines,
              destination_country_code: body.destination_country_code,
              destination_postal_code: body.destination_postal_code,
              destination_city: body.destination_city,
              currency_code: body.currency_code,
              region_id: body.region_id,
              carrier: body.carrier,
            },
            { headers: seed.headers }
          )
        )

        expect(res.status).toBe(200)
        expect(res.data.readiness.ready).toBe(true)
        expect(res.data.readiness.blocking_count).toBe(0)
        // It resolved a real freight option in the quote's own currency —
        // the #1424/#1434 guard, asserted from outside.
        expect(res.data.readiness.freight.chosen).toBeTruthy()
        expect(res.data.readiness.freight.chosen.currency_code).toBe(
          body.currency_code
        )
        expect(res.data.readiness.freight.total_weight_grams).toBeGreaterThan(0)
      })

      it("names the variant that does not exist rather than failing vaguely", async () => {
        const { api } = getSharedTestEnv()
        const body = mintBody(seed)
        const res = await loud("readiness-missing-variant", () =>
          api.post(
            "/partners/quotes/readiness",
            {
              lines: [{ variant_id: "variant_does_not_exist", quantity: 5 }],
              destination_country_code: body.destination_country_code,
              destination_postal_code: body.destination_postal_code,
              currency_code: body.currency_code,
              region_id: body.region_id,
              carrier: body.carrier,
            },
            { headers: seed.headers }
          )
        )

        expect(res.data.readiness.ready).toBe(false)
        const codes = res.data.readiness.issues.map((i: any) => i.code)
        expect(codes).toContain("variant_missing")
        const issue = res.data.readiness.issues.find(
          (i: any) => i.code === "variant_missing"
        )
        expect(issue.variant_id).toBe("variant_does_not_exist")
        expect(issue.severity).toBe("blocking")
      })

      it("reports EVERY blocking failure at once, not just the first", async () => {
        // 🔑 The whole point of a preflight. Throwing on the first problem —
        // which is what buildQuoteView does, correctly, on a render path —
        // makes a partner fix one thing per round trip.
        const { api } = getSharedTestEnv()
        const body = mintBody(seed)
        const res = await loud("readiness-multi", () =>
          api.post(
            "/partners/quotes/readiness",
            {
              lines: [
                { variant_id: "variant_missing_one", quantity: 5 },
                { variant_id: "variant_missing_two", quantity: 5 },
              ],
              destination_country_code: body.destination_country_code,
              destination_postal_code: body.destination_postal_code,
              currency_code: body.currency_code,
              region_id: body.region_id,
              carrier: body.carrier,
            },
            { headers: seed.headers }
          )
        )

        expect(res.data.readiness.blocking_count).toBeGreaterThanOrEqual(2)
        const ids = res.data.readiness.issues
          .filter((i: any) => i.code === "variant_missing")
          .map((i: any) => i.variant_id)
        expect(ids).toEqual(
          expect.arrayContaining(["variant_missing_one", "variant_missing_two"])
        )
      })

      it("does not resolve `readiness` as a quote id", async () => {
        // The static segment sits alongside /partners/quotes/:id. If the
        // dynamic route won, this would 404 as an unknown quote and the
        // preflight would silently not exist.
        const { api } = getSharedTestEnv()
        const res = await loud("readiness-routing", () =>
          api.post(
            "/partners/quotes/readiness",
            {
              lines: mintBody(seed).lines,
              destination_country_code: "in",
              destination_postal_code: "400001",
              currency_code: seed.currencyCode,
              region_id: seed.regionId,
              carrier: "manual",
            },
            { headers: seed.headers }
          )
        )
        expect(res.status).toBe(200)
        expect(res.data.readiness).toBeDefined()
      })

      it("🔴 the MINT itself refuses an unquotable basket — the preflight is not advisory", async () => {
        // A checklist a client can skip is not a gate. The same assessor runs
        // as the first step of the workflow, before anything is created.
        const { api } = getSharedTestEnv()
        const body = mintBody(seed, {
          lines: [{ variant_id: "variant_does_not_exist", quantity: 5 }],
        })

        await expect(
          api.post("/partners/quotes", body, { headers: seed.headers })
        ).rejects.toMatchObject({ response: { status: 400 } })
      })
    })

    it("pages, searches and sorts for real — the count is the SET, not the page", async () => {
      /**
       * #1441. Both list routes used to return the whole table and report
       * `count = quotes.length`, so the admin pager was a client-side illusion
       * and the partner route ignored `limit`/`offset` outright while the hook
       * sent them. A pager over an unwindowed set moves nothing.
       */
      const { api } = getSharedTestEnv()
      const tag = `page-${seed.unique}`

      // Three quotes, distinguishable by company so search can pick one out.
      for (const n of [1, 2, 3]) {
        await loud(`mint-page-${n}`, () =>
          api.post(
            "/partners/quotes",
            mintBody(seed, {
              buyer_email: `${tag}-${n}@jaalyantra.test`,
              recipient_company: n === 2 ? `Findable ${tag}` : `Other ${tag}`,
            }),
            { headers: seed.headers }
          )
        )
      }

      const firstPage = await loud("list-page-1", () =>
        api.get("/partners/quotes?limit=2&offset=0", { headers: seed.headers })
      )
      expect(firstPage.data.quotes).toHaveLength(2)
      // The count describes everything that matches, not this window.
      expect(firstPage.data.count).toBeGreaterThan(2)
      expect(firstPage.data.limit).toBe(2)

      const secondPage = await loud("list-page-2", () =>
        api.get("/partners/quotes?limit=2&offset=2", { headers: seed.headers })
      )
      // A real window moved: no id appears on both pages.
      const firstIds = firstPage.data.quotes.map((q: any) => q.id)
      const secondIds = secondPage.data.quotes.map((q: any) => q.id)
      expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false)

      // Search narrows the SET, not the page.
      const searched = await loud("list-search", () =>
        api.get(`/partners/quotes?q=Findable ${tag}`, { headers: seed.headers })
      )
      expect(searched.data.count).toBe(1)
      expect(searched.data.quotes[0].recipient_company).toBe(`Findable ${tag}`)

      // 🔴 The BASKET comes back with the row. Both list tables render
      // "N lines · M units" straight off `lines`, and the relation was never
      // requested — so every quote read "0 lines · 0 units" on the one screen a
      // partner uses to check what they sent. A list test that only asserts
      // paging and search cannot see this; the field is simply absent.
      const listed = searched.data.quotes[0]
      expect(Array.isArray(listed.lines)).toBe(true)
      expect(listed.lines.length).toBeGreaterThan(0)
      expect(
        listed.lines.reduce((sum: number, l: any) => sum + Number(l.quantity), 0)
      ).toBeGreaterThan(0)

      // Sort is honoured, and an unknown sort field falls back rather than 500s.
      const sorted = await loud("list-sorted", () =>
        api.get("/partners/quotes?order=created_at:ASC&limit=100", {
          headers: seed.headers,
        })
      )
      const times = sorted.data.quotes.map((q: any) =>
        new Date(q.created_at).getTime()
      )
      expect([...times].sort((a, b) => a - b)).toEqual(times)

      const junkSort = await loud("list-junk-sort", () =>
        api.get("/partners/quotes?order=token_hash:ASC", {
          headers: seed.headers,
        })
      )
      expect(junkSort.status).toBe(200)
    })

    it("🔴 a partner cannot widen their own scope with a query param", async () => {
      // The route pins `partner_id` to the authenticated partner. If a query
      // param could override it, any partner could list every other partner's
      // quotes — the #1397/#1433 cross-tenant shape, on the one route that
      // exists precisely to be scoped.
      const { api } = getSharedTestEnv()
      // ⚠️ Mint inside this test: the runner restores a DB snapshot before EVERY
      // test, so rows created by a sibling test are already gone by the time
      // this one runs — an empty list here would read as a passing assertion.
      await loud("mint-scope", () =>
        api.post(
          "/partners/quotes",
          mintBody(seed, { buyer_email: `scope-${seed.unique}@jaalyantra.test` }),
          { headers: seed.headers }
        )
      )

      const mine = await loud("list-mine", () =>
        api.get("/partners/quotes?limit=100", { headers: seed.headers })
      )
      const spoofed = await loud("list-spoofed", () =>
        api.get("/partners/quotes?partner_id=part_someone_else&limit=100", {
          headers: seed.headers,
        })
      )
      expect(spoofed.data.count).toBe(mine.data.count)
      expect(spoofed.data.count).toBeGreaterThan(0)
    })

    it("leaves ANOTHER buyer's quote alone when this buyer is re-quoted", async () => {
      // Supersede is scoped to one customer group. A bug here would expire an
      // unrelated buyer's live prices, which is far worse than the defect it
      // fixes — so it gets its own test rather than riding on the one above.
      const { api } = getSharedTestEnv()
      const buyerA = `buyer-a-${seed.unique}@jaalyantra.test`
      const buyerB = `buyer-b-${seed.unique}@jaalyantra.test`

      const a1 = await loud("mint-a1", () =>
        api.post("/partners/quotes", mintBody(seed, { buyer_email: buyerA }), {
          headers: seed.headers,
        })
      )
      await loud("mint-b1", () =>
        api.post("/partners/quotes", mintBody(seed, { buyer_email: buyerB }), {
          headers: seed.headers,
        })
      )
      // Re-quote B only.
      await loud("mint-b2", () =>
        api.post("/partners/quotes", mintBody(seed, { buyer_email: buyerB }), {
          headers: seed.headers,
        })
      )

      const untouched = await loud("read-a1", () =>
        api.get(`/partners/quotes/${a1.data.quote.id}`, { headers: seed.headers })
      )
      expect(untouched.data.quote.status).toBe("active")

      const aList = await readPriceList(a1.data.quote.price_list_id)
      expect(new Date(aList.ends_at).getTime()).toBeGreaterThan(Date.now())
    })
  })
})
