import {
  buildQuoteView,
  pickLineImage,
  buyerChangedInputs,
  composeQuoteMoney,
  frozenMoney,
  pickFreightOption,
} from "../lib/build-quote-view"

/**
 * The one builder. Three callers — public page, email, and mint (where this
 * same output is frozen) — so if these tests pass, the page and the email
 * cannot disagree about a number.
 *
 * The assertion that matters most is the QueryContext one. `calculated_price`
 * is the QUANTITY-1 price on every `/store/*` route because only the cart sets
 * `context.quantity`; a tiered "price at 500" rendered without it is silently
 * the price at 1. That is not a detail to preserve on refactor — it is the
 * feature.
 */

const VARIANTS = [
  {
    id: "var_a",
    title: "Plain / Natural",
    weight: 105,
    // Deliberately out of rank order, and the product carries a DIFFERENT
    // thumbnail — so "took the variant image" and "took the first row" and
    // "fell back to the product" are three distinguishable outcomes.
    images: [
      { url: "https://cdn/var-a-2.jpg", rank: 1 },
      { url: "https://cdn/var-a-1.jpg", rank: 0 },
    ],
    product: {
      id: "prod_a",
      title: "Pashmina Plain",
      handle: "pashmina-plain",
      weight: 115,
      thumbnail: "https://cdn/prod-a.jpg",
    },
  },
  {
    id: "var_b",
    title: "Striped / Indigo",
    weight: null,
    images: [],
    product: {
      id: "prod_b",
      title: "Pashmina Striped",
      handle: "pashmina-striped",
      weight: 200,
      thumbnail: "https://cdn/prod-b.jpg",
    },
  },
]

type Captured = { contexts: any[]; rateWeights: number[] }

const scopeWith = (
  captured: Captured,
  over: {
    manual?: any[]
    noOriginPostalCode?: boolean
    partner?: any
    profile?: any
    artisanDetail?: any
  } = {}
) => {
  const manualOptions = over.manual ?? []
  return {
    resolve: (key: string) => {
      if (String(key) === "partner_onboarding_profile") {
        return { findByPartner: async () => over.profile ?? null }
      }
      if (String(key).includes("cach")) {
        return { get: async () => null, set: async () => {} }
      }
      if (String(key).includes("logger")) {
        return { warn: () => {} }
      }
      return {
        graph: async (args: any) => {
          if (args.entity === "variant" && args.fields.includes("calculated_price.*")) {
            captured.contexts.push(args.context)
            const id = args.filters.id
            // A deliberately quantity-sensitive price, so a lost quantity shows
            // up as a wrong number rather than as an equal one.
            const quantity =
              JSON.parse(JSON.stringify(args.context)).calculated_price?.quantity ?? 1
            return {
              data: [
                {
                  id,
                  calculated_price: {
                    calculated_amount: quantity >= 100 ? 800 : 1000,
                  },
                },
              ],
            }
          }
          if (args.entity === "variant") {
            const ids = Array.isArray(args.filters.id) ? args.filters.id : [args.filters.id]
            return { data: VARIANTS.filter((v) => ids.includes(v.id)) }
          }
          if (args.entity === "partners") {
            return { data: over.partner ? [over.partner] : [] }
          }
          if (args.entity === "product") {
            return {
              data: over.artisanDetail
                ? [{ id: "prod_a", artisan_product_detail: over.artisanDetail }]
                : [],
            }
          }
          if (args.entity === "stock_locations") {
            if (args.fields.some((f: string) => f.includes("fulfillment_sets"))) {
              return {
                data: [
                  {
                    id: "loc_1",
                    fulfillment_sets: [
                      {
                        service_zones: [
                          {
                            // A zone with no geo zones covers NOTHING (#1424),
                            // so a manual fixture has to declare its lane.
                            geo_zones: manualOptions.length
                              ? [{ country_code: "in" }]
                              : [],
                            shipping_options: manualOptions,
                          },
                        ],
                      },
                    ],
                  },
                ],
              }
            }
            return {
              data: [
                {
                  id: "loc_1",
                  address: {
                    postal_code: over.noOriginPostalCode ? "" : "110001",
                  },
                },
              ],
            }
          }
          return { data: [] }
        },
      }
    },
  }
}

// The shipping provider is resolved through the module registry, so it is
// stubbed at the module boundary rather than through the container.
jest.mock("../../shipping-providers/resolver", () => ({
  resolveShippingProvider: async () => ({
    getRates: async (args: any) => {
      ;(global as any).__rateWeights = [
        ...((global as any).__rateWeights || []),
        args.weight_grams,
      ]
      return [
        { courier_id: "c1", courier_name: "Delhivery", amount: 4200, currency_code: "inr", estimated_days: 4 },
        { courier_id: "c2", courier_name: "Blue Dart", amount: 3900, currency_code: "inr", estimated_days: 3 },
      ]
    },
  }),
}))

const baseInput = (over: any = {}) => ({
  lines: [{ variant_id: "var_a", quantity: 500 }],
  destination_country_code: "in",
  destination_postal_code: "560001",
  currency_code: "inr",
  region_id: "reg_in",
  store: { id: "store_1", default_location_id: "loc_1" },
  now: new Date("2026-08-21T00:00:00Z"),
  ...over,
})

beforeEach(() => {
  ;(global as any).__rateWeights = []
})

describe("buildQuoteView — pricing", () => {
  it("prices EVERY line with an explicit quantity in the QueryContext", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
      })
    )

    expect(captured.contexts).toHaveLength(2)
    const quantities = captured.contexts.map(
      (c) => JSON.parse(JSON.stringify(c)).calculated_price.quantity
    )
    // Per line, never blended: 500 and 20 are two different tiers.
    expect(quantities).toEqual([500, 20])
  })

  it("carries region and currency into the pricing context", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    await buildQuoteView(scopeWith(captured) as any, baseInput())

    const ctx = JSON.parse(JSON.stringify(captured.contexts[0])).calculated_price
    expect(ctx.region_id).toBe("reg_in")
    expect(ctx.currency_code).toBe("inr")
  })

  it("lands a tiered price, not the qty-1 price", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(scopeWith(captured) as any, baseInput())

    // 800 is the >=100 tier in the stub. 1000 would mean the quantity was lost.
    expect(view.lines[0].live_unit_amount).toBe(800)
    expect(view.lines[0].live_subtotal).toBe(400_000)
  })
})

describe("buildQuoteView — freight", () => {
  it("quotes ONE consignment on the summed weight, not one per line", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
      })
    )

    // 500 × 105 g + 20 × 200 g (product fallback) = 56,500 g → bucketed 56,500.
    expect(view.total_weight_grams).toBe(56_500)
    // ONE carrier call. Per-line freight would bill several deliveries the
    // buyer is not getting.
    expect((global as any).__rateWeights).toHaveLength(1)
    expect(view.freight.chosen?.amount).toBe(3900)
  })

  it("records the weight source per line, because a basket can mix them", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
      })
    )

    expect(view.lines.find((l) => l.variant_id === "var_a")?.weight_source).toBe("variant")
    // var_b has no weight of its own — the product's 200 g is an over-quote,
    // and saying so is the whole point of the column.
    expect(view.lines.find((l) => l.variant_id === "var_b")?.weight_source).toBe("product")
  })

  it("has no live half at all when freight cannot be quoted, and says why", async () => {
    // A landed total with no freight in it is a wrong number wearing a
    // confident label. The quoted half — what the partner actually told this
    // buyer — is still worth showing.
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { noOriginPostalCode: true }) as any,
      baseInput({
        quote: {
          status: "active",
          quoted_subtotal: 400_000,
          quoted_freight: 3900,
          quoted_landed_total: 403_900,
          lines: [{ variant_id: "var_a", quantity: 500 }],
        },
      })
    )

    expect(view.live).toBeNull()
    expect(view.live_error).toMatch(/postal code/i)
    expect(view.quoted?.landed_total).toBe(403_900)
    expect(view.compare.show_quoted).toBe(true)
  })
})

describe("buildQuoteView — the free-shipping row that quoted every bulk consignment at zero", () => {
  /**
   * Found on the FIRST live prod B2B quote: ₹36,00,000, 21 kg to Mumbai,
   * `quoted_freight: 0`.
   *
   * `create-store-with-defaults` gives every Indian store a second price row of
   * 0 INR gated on `item_total >= 2999` — retail free shipping. The estimate
   * read `prices[]` and pushed every row as its own option WITHOUT looking at
   * `price_rules`, so the 0 was always on the lane and always the cheapest.
   *
   * This is the third blindness on the same picker: zone, currency (both
   * #1424), and now rule.
   */
  const FREE_OVER_2999 = {
    id: "so_flat",
    name: "Domestic Shipping",
    price_type: "flat",
    prices: [
      { amount: 99, currency_code: "inr", price_rules: [] },
      {
        amount: 0,
        currency_code: "inr",
        price_rules: [
          { attribute: "item_total", operator: "gte", value: "2999" },
        ],
      },
    ],
  }

  it("does not take a rule-bound 0 as the cheapest option", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { manual: [FREE_OVER_2999] }) as any,
      baseInput()
    )

    /**
     * 🔴 UPDATED: the carrier rate wins, not the flat 99.
     *
     * This assertion used to read `toBe(99)`, with a comment calling 99 "the
     * honest answer" because it was "genuinely cheaper than the 3900 carrier
     * rate". It was not honest — it was a **₹3801 undercharge per
     * consignment**, and the test pinned it as correct for months.
     *
     * A flat tier does not move with weight, so it is not a cheaper offer for
     * this parcel; it is a placeholder standing where a real rate exists. The
     * picker no longer races the two.
     *
     * What this test is actually FOR is unchanged and still asserted: a
     * rule-bound 0 must never reach the options list, because the estimate has
     * no cart and cannot evaluate `item_total >= 2999` (#1430).
     */
    expect(view.freight.chosen?.amount).toBe(3900)
    expect(view.live?.freight).toBe(3900)
    expect(view.freight.options.map((o) => o.amount)).not.toContain(0)
  })

  it("drops the conditional row even when it is the ONLY price", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, {
        manual: [{ ...FREE_OVER_2999, prices: [FREE_OVER_2999.prices[1]] }],
      }) as any,
      baseInput()
    )

    // The estimate has no cart and must not guess: with nothing unconditional
    // on the lane, the carrier rate stands rather than a free ride.
    expect(view.freight.chosen?.amount).toBe(3900)
  })

  it("asks NO carrier when the quote is priced manually (#1447)", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    ;(global as any).__rateWeights = []

    const view = await buildQuoteView(
      scopeWith(captured, {
        manual: [{ ...FREE_OVER_2999, prices: [FREE_OVER_2999.prices[0]] }],
      }) as any,
      baseInput({ carrier: "manual" })
    )

    // 🔑 Distinct from a carrier that FAILED: nothing is retried, nothing is
    // logged as an error, and the page must not tell the buyer the figure is an
    // indicative fallback. Someone chose to price this lane by hand.
    expect((global as any).__rateWeights).toHaveLength(0)
    expect(view.freight.options.map((o) => o.source)).not.toContain("calculated")
    expect(view.freight.chosen?.amount).toBe(99)
    expect(view.freight.error).toBeNull()
  })

  it("still keeps an ordinary unconditional flat price on the lane", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, {
        manual: [{ ...FREE_OVER_2999, prices: [FREE_OVER_2999.prices[0]] }],
      }) as any,
      baseInput()
    )

    // The unconditional flat is still COLLECTED — it is the lane's fallback and
    // the donor of a `shipping_option_id` for acceptance (#1498). It simply no
    // longer outranks a live rate.
    expect(view.freight.options.map((o) => o.amount)).toContain(99)
    expect(view.freight.chosen?.amount).toBe(3900)
  })
})

/**
 * 🔴 THE QUOTE-ONLY WEIGHT TIER, END TO END.
 *
 * The store's retail flat row and the B2B tier are two different offers on the
 * same lane. The retail row (`enabled_in_store: "true"`) is priced for a
 * shopper buying one or two pieces; using it for a 22 kg consignment is what
 * produced a ₹99 freight figure, and raising it to suit B2B would raise it for
 * every shopper too.
 *
 * This walks the whole builder rather than the pure resolver, because the part
 * that has actually broken before is the WIRING: an option marked quote-only
 * carries `enabled_in_store: "false"`, which the estimate refuses on entirely
 * correct reasoning. Get the interaction wrong and the option is provisioned,
 * priced, and never once used — with nothing failing.
 */
describe("buildQuoteView — the quote-only weight tier", () => {
  const QUOTE_TIER = {
    id: "so_quote_tier",
    name: "Quote Freight — tiered",
    price_type: "flat",
    // Priced from `data`, never from these rows.
    prices: [{ amount: 59, currency_code: "inr", price_rules: [] }],
    data: {
      quote_weight_tiers: [
        { max_weight_grams: 5000, amounts: { inr: 5400 } },
        { max_weight_grams: null, amounts: { inr: 9200 } },
      ],
    },
    rules: [
      { attribute: "enabled_in_store", value: "false", operator: "eq" },
      { attribute: "quote_only", value: "true", operator: "eq" },
    ],
  }

  const RETAIL_FLAT = {
    id: "so_retail",
    name: "Domestic Shipping",
    price_type: "flat",
    prices: [{ amount: 99, currency_code: "inr", price_rules: [] }],
    rules: [{ attribute: "enabled_in_store", value: "true", operator: "eq" }],
  }

  it("🔴 is collected despite enabled_in_store being false", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { manual: [QUOTE_TIER] }) as any,
      baseInput()
    )

    // 500 × 105 g = 52.5 kg → the open-ended tier.
    expect(view.freight.options.map((o) => o.amount)).toContain(9200)
  })

  it("prices by CONSIGNMENT WEIGHT, not from its price rows", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { manual: [QUOTE_TIER] }) as any,
      // 10 × 105 g = 1050 g → the light tier.
      baseInput({ lines: [{ variant_id: "var_a", quantity: 10 }] })
    )

    const tier = view.freight.options.find((o) => o.name?.includes("Quote Freight"))
    expect(tier?.amount).toBe(5400)
    // 59 is the row price and must never surface — it exists only because an
    // option needs one to be created at all.
    expect(view.freight.options.map((o) => o.amount)).not.toContain(59)
  })

  /**
   * 🔑 It is the FALLBACK, not the price. A live carrier rate still wins — the
   * tier is what stands behind the carrier, not what competes with it.
   */
  it("🔑 still loses to a live carrier rate", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { manual: [QUOTE_TIER, RETAIL_FLAT] }) as any,
      baseInput()
    )

    // 3900 is the cheaper of the two stubbed carrier rates.
    expect(view.freight.chosen?.amount).toBe(3900)
  })

  /**
   * 🔴 And when it does stand in, it must beat the RETAIL row rather than the
   * other way round — otherwise the whole exercise changes nothing and a 52 kg
   * consignment still ships at the shopper's ₹99.
   */
  it("🔴 outranks the retail flat when no carrier rated the lane", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { manual: [QUOTE_TIER, RETAIL_FLAT] }) as any,
      // "manual" asks NO carrier (#1447), so the manual pool is the whole
      // answer — exactly the state a carrier outage produces.
      baseInput({ carrier: "manual" })
    )

    expect(view.freight.chosen?.amount).toBe(9200)
    expect(view.freight.chosen?.name).toContain("Quote Freight")
  })

  it("provides a lane for acceptance to borrow", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { manual: [QUOTE_TIER] }) as any,
      baseInput()
    )

    // A carrier rate carries no option id of its own; without a donor the quote
    // mints and cannot be bought (#1497). The tier supplies the lane.
    expect(view.freight.chosen?.source).toBe("calculated")
    expect(view.freight.chosen?.shipping_option_id).toBe("so_quote_tier")
  })
})

describe("buildQuoteView — the missing pickup location that read every tenant", () => {
  /**
   * Found on the SECOND live prod mint. The public `/store/b2b/quotes/:token`
   * route passed `store: { id }` and no `default_location_id`, and
   * `filters: { id: undefined }` is NOT "no location" — it is NO FILTER.
   *
   * The buyer's page therefore collected manual shipping options from EVERY
   * stock location on the platform. A Mumbai consignment was offered another
   * partner's "European Shipping", "Private" and "In Person Pickup", while this
   * store's own domestic option was missing — so the page's freight disagreed
   * with the freight the mint had frozen minutes earlier.
   *
   * A cross-tenant read on a public, unauthenticated route: the #1397 shape.
   * A missing origin cannot produce a right answer, so it must not produce a
   * confident wrong one.
   */
  it("refuses to price at all when no pickup location was given", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({ store: { id: "store_1" } })
    )

    // No live half, and it says why — rather than a landed total built from
    // somebody else's shipping options.
    expect(view.live).toBeNull()
    expect(view.live_error).toMatch(/pickup location/i)
    expect(view.live_error).toMatch(/every location on the platform/i)
  })

  it("still prices normally once the location is given", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(scopeWith(captured) as any, baseInput())

    expect(view.live).not.toBeNull()
  })
})

describe("buildQuoteView — an INR carrier rate on a EUR quote", () => {
  /**
   * Found on the FIRST live international quote: Srinagar → Berlin, 3 kg, EUR.
   *
   * Carriers answer in their OWN currency. Shiprocket returned ₹3,788 /
   * ₹5,232.50 / ₹14,436 alongside a €35 manual flat, and €35 won ONLY because
   * 35 is the smallest raw number. Take the flat away and `composeQuoteMoney`
   * adds 3788 straight onto a EUR subtotal: €4,718 becomes €8,506, rendered
   * with a € sign.
   *
   * #1424 put this guard on the MANUAL branch and stopped there. The stub here
   * quotes in INR, so an EUR quote must see no calculated option at all.
   */
  const EUR_FLAT = {
    id: "so_intl",
    name: "International Shipping",
    price_type: "flat",
    prices: [{ amount: 35, currency_code: "eur", price_rules: [] }],
  }

  it("never lets an INR carrier rate into a EUR total", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, { manual: [EUR_FLAT] }) as any,
      baseInput({ currency_code: "eur", lines: [{ variant_id: "var_a", quantity: 29 }] })
    )

    // The INR stub rates (3900 / 4200) are cheaper as raw numbers than nothing,
    // and 3900 would have been ADDED to a EUR subtotal.
    expect(view.freight.options.every((o) => o.currency_code === "eur")).toBe(true)
    expect(view.freight.chosen?.amount).toBe(35)
    expect(view.freight.chosen?.currency_code).toBe("eur")
  })

  it("has no live half at all when only foreign-currency rates exist", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({ currency_code: "eur" })
    )

    // No EUR option on the lane. Refusing is the point — a landed total built
    // from an INR number would look perfectly ordinary.
    expect(view.live).toBeNull()
    expect(view.live_error).toMatch(/freight/i)
  })

  it("still keeps INR rates on an INR quote", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(scopeWith(captured) as any, baseInput())

    // The guard must not over-correct into dropping the domestic case.
    expect(view.freight.chosen?.amount).toBe(3900)
    expect(view.freight.chosen?.currency_code).toBe("inr")
  })
})

describe("buildQuoteView — lifecycle", () => {
  it("never re-prices a revoked link", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({ quote: { status: "revoked", lines: [{ variant_id: "var_a", quantity: 500 }] } })
    )

    expect(view.live).toBeNull()
    expect(captured.contexts).toHaveLength(0)
    expect(view.compare.state).toBe("dead_link")
  })

  /**
   * 🔴 The lifecycle verdict must be READABLE off the view (#1705).
   *
   * It was not, and the buyer route reached for `live_error` instead — a
   * PRICING failure — to decide whether to print "this quote is no longer
   * open". An open quote whose freight could not be rated was told it was
   * closed. The route now reads this field, so a view that stops carrying it
   * would silently stop refusing revoked quotes: a missing key is a confident
   * null.
   */
  it("names the lifecycle verdict on the view, separately from live_error", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }

    const revoked = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({ quote: { status: "revoked", lines: [{ variant_id: "var_a", quantity: 500 }] } })
    )
    expect(revoked.unusable_reason).toBe("revoked")

    const expired = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        quote: {
          status: "active",
          expires_at: "2026-08-01T00:00:00Z",
          lines: [{ variant_id: "var_a", quantity: 500 }],
        },
      })
    )
    expect(expired.unusable_reason).toBe("expired")

    const open = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({ quote: { status: "active", lines: [{ variant_id: "var_a", quantity: 500 }] } })
    )
    // The one that mattered: open, and whatever happened to the live half is
    // NOT allowed to appear here.
    expect(open.unusable_reason).toBeNull()
  })

  it("never re-prices an expired link, but still names what was quoted", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        quote: {
          status: "active",
          expires_at: "2026-08-01T00:00:00Z",
          lines: [{ variant_id: "var_a", quantity: 500 }],
        },
      })
    )

    expect(view.live).toBeNull()
    expect(captured.contexts).toHaveLength(0)
    expect(view.lines[0].product_title).toBe("Pashmina Plain")
  })

  it("refuses an empty basket rather than quoting nothing", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    await expect(
      buildQuoteView(scopeWith(captured) as any, baseInput({ lines: [] }))
    ).rejects.toThrow(/at least one line/)
  })
})

describe("pure helpers", () => {
  it("picks the cheapest option, not the carrier's recommendation", () => {
    const chosen = pickFreightOption({
      calculated: [
        { amount: 4200, currency_code: "inr", source: "calculated", is_recommended: true },
        { amount: 3900, currency_code: "inr", source: "calculated" },
      ] as any,
      manual: [{ amount: 5000, currency_code: "inr", source: "manual" }] as any,
    })

    expect(chosen?.amount).toBe(3900)
  })

  it("returns null when the lane has no quotable option", () => {
    expect(pickFreightOption({ calculated: [], manual: [] })).toBeNull()
  })

  it("sums line subtotals and adds ONE freight leg", () => {
    const money = composeQuoteMoney([400_000, 20_000], 520, 3900)

    expect(money.subtotal).toBe(420_000)
    expect(money.freight).toBe(3900)
    expect(money.landed_total).toBe(423_900)
    // The basket's blended per-unit figure, for the summary row only.
    expect(money.unit_amount).toBeCloseTo(807.69, 2)
  })

  it("reports no frozen half before the first freeze", () => {
    expect(frozenMoney(null)).toBeNull()
    expect(frozenMoney({ quoted_landed_total: null })).toBeNull()
  })

  it("reads the frozen totals back", () => {
    const money = frozenMoney({
      quoted_subtotal: 420_000,
      quoted_freight: 3900,
      quoted_landed_total: 423_900,
      lines: [{ variant_id: "var_a", quantity: 520 }],
    })

    expect(money?.landed_total).toBe(423_900)
    expect(money?.unit_amount).toBeCloseTo(807.69, 2)
  })
})

describe("the line image (#1428)", () => {
  it("prefers the variant's own image over the product thumbnail", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
      })
    )

    const a = view.lines.find((l) => l.variant_id === "var_a")
    // Rank 0, not the first row of the array — the merchandiser's ordering
    // decides which photo the buyer sees.
    expect(a?.thumbnail).toBe("https://cdn/var-a-1.jpg")
    expect(a?.image_source).toBe("variant")
    // prod_a also has a thumbnail; taking it would have been the bug.
    expect(a?.thumbnail).not.toBe("https://cdn/prod-a.jpg")

    const b = view.lines.find((l) => l.variant_id === "var_b")
    expect(b?.thumbnail).toBe("https://cdn/prod-b.jpg")
    expect(b?.image_source).toBe("product")
  })

  it("says nothing when neither level has an image", () => {
    // A plausible WRONG image on a quote is worse than an empty cell — the
    // buyer is agreeing to *that* item.
    expect(pickLineImage({ images: [], product: {} })).toEqual({
      thumbnail: null,
      image_source: null,
    })
    expect(pickLineImage(undefined)).toEqual({
      thumbnail: null,
      image_source: null,
    })
  })

  it("ignores image rows that carry no url", () => {
    expect(
      pickLineImage({
        images: [{ url: null, rank: 0 }],
        product: { thumbnail: "https://cdn/p.jpg" },
      })
    ).toEqual({ thumbnail: "https://cdn/p.jpg", image_source: "product" })
  })
})

describe("buyerChangedInputs", () => {
  const quote = {
    destination_postal_code: "560001",
    lines: [
      { variant_id: "var_a", quantity: 500 },
      { variant_id: "var_b", quantity: 20 },
    ],
  }

  it("is false at mint, when there is nothing to have changed from", () => {
    expect(buyerChangedInputs(null, { lines: [{ variant_id: "var_a", quantity: 1 }] })).toBe(false)
  })

  it("is false when the basket and destination match what was quoted", () => {
    expect(
      buyerChangedInputs(quote, {
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
        destination_postal_code: "560001",
      })
    ).toBe(false)
  })

  it("notices a nudged quantity", () => {
    expect(
      buyerChangedInputs(quote, {
        lines: [
          { variant_id: "var_a", quantity: 600 },
          { variant_id: "var_b", quantity: 20 },
        ],
        destination_postal_code: "560001",
      })
    ).toBe(true)
  })

  it("notices a line removed, not just a quantity changed", () => {
    expect(
      buyerChangedInputs(quote, {
        lines: [{ variant_id: "var_a", quantity: 500 }],
        destination_postal_code: "560001",
      })
    ).toBe(true)
  })

  it("notices a swapped variant even at the same line count and quantity", () => {
    expect(
      buyerChangedInputs(quote, {
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_c", quantity: 20 },
        ],
        destination_postal_code: "560001",
      })
    ).toBe(true)
  })

  it("notices a new destination", () => {
    expect(
      buyerChangedInputs(quote, {
        lines: [
          { variant_id: "var_a", quantity: 500 },
          { variant_id: "var_b", quantity: 20 },
        ],
        destination_postal_code: "400001",
      })
    ).toBe(true)
  })
})

/**
 * #1439 S9 — the maker section. The shaper and its resolver have their own
 * suites; what matters HERE is only that the view carries the section and that
 * a partner we cannot resolve costs a credit line rather than the whole page.
 */
describe("buildQuoteView — provenance", () => {
  it("carries the maker section for a quote with a partner", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured, {
        partner: {
          id: "part_1",
          name: "Unique Pashmina",
          country_code: "IN",
          is_verified: true,
          status: "active",
        },
        profile: { person_type: "artisan", does_weaving: true },
        artisanDetail: { maker_story: "Woven on pit looms.", lead_time_days: 21 },
      }) as any,
      baseInput({ partner_id: "part_1" })
    )

    expect(view.provenance?.maker_name).toBe("Unique Pashmina")
    expect(view.provenance?.maker_story).toBe("Woven on pit looms.")
    expect(view.provenance?.rows.map((r) => r.key)).toContain("weaving")
  })

  it("prices the quote regardless of whether provenance resolves", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({ partner_id: "part_missing" })
    )

    // Null is "say nothing", and the money is untouched by it.
    expect(view.provenance).toBeNull()
    expect(view.live?.landed_total).toBeGreaterThan(0)
  })
})

/**
 * The manual customs duty (#1447).
 *
 * 🔴 The defect these exist to keep dead: `duties_prepaid` told the buyer
 * "import duty is included and paid by us" while `composeQuoteMoney` was
 * `subtotal + freight (+ tax)`. The promise added nothing to the price, so the
 * duty came out of margin by an amount nobody had computed and nothing
 * downstream ever learned a figure was owed.
 */
describe("prepaid duty (#1447)", () => {
  it("adds the duty to what the buyer pays, and never to landed_total", () => {
    const money = composeQuoteMoney([100_000], 100, 5_000, { total: 0, inclusive: false }, {
      duty: 8_400,
      import_tax: 22_764,
      fee: 1_982,
    })

    // `landed_total` keeps the meaning every frozen row on disk already has.
    expect(money.landed_total).toBe(105_000)
    expect(money.duty_total).toBe(8_400)
    // 🔴 The import tax is the big one — funding only the duty would leave
    // three quarters of this promise on our margin.
    expect(money.import_tax_total).toBe(22_764)
    expect(money.ddp_fee_total).toBe(1_982)
    expect(money.gross_total).toBe(138_146)
  })

  it("adds the duty on tax-INCLUSIVE prices too", () => {
    // Tax is already inside the prices; duty is a destination-border charge the
    // line prices know nothing about, so the two are not symmetrical.
    const money = composeQuoteMoney([100_000], 100, 5_000, { total: 16_017, inclusive: true }, {
      duty: 8_400,
      import_tax: 22_764,
      fee: 1_982,
    })

    expect(money.tax_total).toBe(16_017)
    expect(money.gross_total).toBe(138_146)
  })

  it("carries no duty figure when none was given — null, not zero", () => {
    const money = composeQuoteMoney([100_000], 100, 5_000, { total: 0, inclusive: false })

    // Null is "not a DDP quote"; 0 would be "duty applies to this lane and is
    // nil", which is a claim about AI-ECTA we have not made here.
    expect(money.duty_total).toBeNull()
    expect(money.import_tax_total).toBeNull()
    expect(money.gross_total).toBe(105_000)
  })

  it("keeps a nil duty distinguishable from no duty", () => {
    const money = composeQuoteMoney([100_000], 100, 5_000, { total: 0, inclusive: false }, {
      duty: 0,
      import_tax: 0,
      fee: 0,
    })

    expect(money.duty_total).toBe(0)
    expect(money.import_tax_total).toBe(0)
    expect(money.gross_total).toBe(105_000)
  })

  it("reads the frozen duty back onto the quoted half", () => {
    const money = frozenMoney({
      quoted_subtotal: 100_000,
      quoted_freight: 5_000,
      quoted_landed_total: 105_000,
      quoted_tax_total: 0,
      quoted_tax_inclusive: false,
      quoted_duty_total: 8_400,
      quoted_import_tax_total: 22_764,
      quoted_ddp_fee_total: 1_982,
      lines: [{ variant_id: "var_a", quantity: 100 }],
    })

    expect(money?.duty_total).toBe(8_400)
    expect(money?.import_tax_total).toBe(22_764)
    expect(money?.gross_total).toBe(138_146)
  })

  it("reports no duty figure for a quote minted before the column existed", () => {
    const money = frozenMoney({
      quoted_subtotal: 100_000,
      quoted_freight: 5_000,
      quoted_landed_total: 105_000,
      quoted_tax_total: 0,
      quoted_tax_inclusive: false,
      lines: [{ variant_id: "var_a", quantity: 100 }],
    })

    expect(money?.duty_total).toBeNull()
    expect(money?.import_tax_total).toBeNull()
    // Unchanged for every quote already on disk.
    expect(money?.gross_total).toBe(105_000)
  })

  it("surfaces the undertaking, the amount and the basis at mint", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        duties_prepaid: true,
        duty_rate_percent: 8,
        import_tax_rate_percent: 21,
        ddp_fee_total: 1_981.57,
        duty_basis: "EU: 8% duty, 21% NL VAT, HS 6304.92",
      })
    )

    // 🔴 Computed against the basket that was actually priced — 500 units at
    // the qty-tier price of 800, plus the freight the lane really quoted. A
    // wizard cannot know either before the mint runs, so a client-side figure
    // would be an estimate frozen as a commitment.
    const dutiable = (view.live?.subtotal ?? 0) + (view.live?.freight ?? 0)
    expect(view.duty.prepaid).toBe(true)
    expect(view.duty.total).toBeCloseTo(dutiable * 0.08, 2)
    expect(view.duty.import_tax).toBeCloseTo(
      (dutiable + (view.duty.total ?? 0)) * 0.21,
      2
    )
    expect(view.duty.carrier_fee).toBe(1_981.57)
    expect(view.duty.combined_total).toBeCloseTo(
      (view.duty.total ?? 0) + (view.duty.import_tax ?? 0) + 1_981.57,
      2
    )
    expect(view.duty.duty_rate_percent).toBe(8)
    expect(view.duty.import_tax_rate_percent).toBe(21)
    expect(view.duty.basis).toBe("EU: 8% duty, 21% NL VAT, HS 6304.92")
    expect(view.live?.import_tax_total).toBe(view.duty.import_tax)
  })

  it("refuses to carry a duty amount on a quote that is NOT DDP", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      // The API refuses this pairing, but the builder is reached by the admin
      // twin and the freeze as well. A stray amount here would be added to a
      // total whose buyer was told duty is theirs to pay on arrival.
      baseInput({
        duties_prepaid: false,
        duty_rate_percent: 8,
        import_tax_rate_percent: 21,
        duty_basis: "typo",
      })
    )

    expect(view.duty.prepaid).toBe(false)
    expect(view.duty.total).toBeNull()
    expect(view.duty.import_tax).toBeNull()
    expect(view.duty.combined_total).toBeNull()
    expect(view.duty.basis).toBeNull()
    expect(view.live?.duty_total).toBeNull()
    expect(view.live?.import_tax_total).toBeNull()
  })

  it("still states the undertaking on a DEAD link", async () => {
    const captured: Captured = { contexts: [], rateWeights: [] }
    const view = await buildQuoteView(
      scopeWith(captured) as any,
      baseInput({
        quote: {
          status: "revoked",
          duties_prepaid: true,
          quoted_duty_total: 6_143.36,
          quoted_import_tax_total: 17_416.43,
          quoted_ddp_fee_total: 1_981.57,
          quoted_duty_rate: 8,
          quoted_import_tax_rate: 21,
          quoted_duty_basis: "EU: 8% duty, 21% NL VAT, HS 6304.92",
          quoted_subtotal: 100_000,
          quoted_freight: 5_000,
          quoted_landed_total: 105_000,
          quoted_tax_total: 0,
          quoted_tax_inclusive: false,
          lines: [{ variant_id: "var_a", quantity: 100 }],
        },
      })
    )

    // The live half is skipped entirely on a dead link — the same path that
    // silently dropped the whole tax block until `frozenTaxFallback`. A revoked
    // quote is the RECORD of what was promised, so the promise has to survive it.
    expect(view.live).toBeNull()
    expect(view.duty.prepaid).toBe(true)
    expect(view.duty.total).toBe(6_143.36)
    expect(view.duty.import_tax).toBe(17_416.43)
    expect(view.duty.carrier_fee).toBe(1_981.57)
    expect(view.duty.basis).toBe("EU: 8% duty, 21% NL VAT, HS 6304.92")
    expect(view.quoted?.duty_total).toBe(6_143.36)
    // 105,000 + 6,143.36 + 17,416.43 + 1,981.57
    expect(view.quoted?.gross_total).toBeCloseTo(130_541.36, 2)
  })
})
